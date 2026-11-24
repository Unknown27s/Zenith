#!/usr/bin/env python3
"""
Resolve a permissioned live link to a playable HLS stream URL (server-side).

Supported inputs:
  1. HTTPS YouTube watch / live / youtu.be links with an 11-char video ID
     (resolved with yt-dlp, Streamlink fallback).
  2. Direct HLS playlist URLs ending in .m3u8, e.g.
     https://kamere.amss.org.rs/horgos1/horgos1.m3u8
     (validated and probed, then returned as-is).

Safety:
- yt-dlp / Streamlink run in a subprocess with a timeout, never through a shell.
- Direct HLS hosts must resolve to public IPs only (no localhost / private /
  link-local / metadata addresses), redirects are re-validated on every hop.
- Specific, safe error codes (signed URLs never leak into errors or logs).
- Results cached briefly, because googlevideo URLs expire and resolving is slow.

Env vars (all optional):
    YOUTUBE_COOKIES_FILE   path to a Netscape cookies.txt (helps on cloud/server IPs)
    YT_DLP_TIMEOUT         seconds to wait for yt-dlp (default 45)
    STREAMLINK_TIMEOUT     seconds to wait for fallback (default 30)
    HLS_ALLOWED_HOSTS      comma-separated allowlist for direct HLS hosts
                           (e.g. "kamere.amss.org.rs"); empty = any public host
    HLS_ALLOW_HTTP         set to 1 to allow plain http:// direct HLS URLs
    HLS_PROBE_TIMEOUT      seconds for the playlist probe (default 10)

Usage:
    python youtube_live.py "https://www.youtube.com/watch?v=VIDEO_ID"
    python youtube_live.py "https://kamere.amss.org.rs/horgos1/horgos1.m3u8"
    python youtube_live.py --doctor
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urljoin, urlsplit

log = logging.getLogger("youtube_live")

PAGE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com"}
STREAM_DOMAINS = ("googlevideo.com", "youtube.com")
VIDEO_ID_RE = re.compile(r"[A-Za-z0-9_-]{11}")
URL_RE = re.compile(r"https?://\S+")

# Direct HLS settings
HLS_PORTS = {None, 80, 443, 8080, 8443}
HLS_MAX_REDIRECTS = 3

# YOLO needs video, not audio. YouTube may expose only separate video/audio tracks.
FORMAT = (
    "bestvideo[protocol^=m3u8][height<=720]/best[protocol^=m3u8][height<=720]"
    "/bestvideo[height<=720]/best[height<=720]/bestvideo/best"
)

CACHE_TTL = 15 * 60  # seconds; stream URLs expire after a few hours
_cache: dict[str, tuple[float, str]] = {}
_cache_lock = threading.Lock()


class LiveResolveError(ValueError):
    """Safe-to-show error with a machine-readable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# (regex on yt-dlp stderr, code, safe message)
_ERROR_PATTERNS = [
    (r"not a bot|sign in to confirm", "bot_check",
     "YouTube is asking for sign-in (bot check). Provide a valid cookies file."),
    (r"http error 429|too many requests", "rate_limited",
     "YouTube is rate limiting this server. Try again later or use cookies."),
    (r"javascript runtime|js runtime|no supported javascript", "no_js_runtime",
     "yt-dlp needs a JavaScript runtime (Deno or Node) on PATH."),
    (r"requested format is not available", "no_format",
     "No playable format found. Update yt-dlp and make sure Deno/Node is installed."),
    (r"will begin in|premieres in|live event will begin", "not_started",
     "The live stream has not started yet."),
    (r"live stream recording is not available|live event has ended|has ended",
     "ended", "The live stream has ended."),
    (r"private video|members-only|join this channel|sign in if you've been granted",
     "restricted", "The video is private or members-only; cookies for an allowed account are needed."),
    (r"video unavailable|has been removed|not available in your country",
     "unavailable", "The video is unavailable (removed or region-blocked)."),
]


# --------------------------------------------------------------------------
# URL validation
# --------------------------------------------------------------------------
def canonical_video_url(value) -> str | None:
    """Return https://www.youtube.com/watch?v=ID for an allowed link, else None."""
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value.strip())
        host = (url.hostname or "").lower()
        if (url.scheme != "https" or url.username or url.password
                or url.port or url.fragment):
            return None

        video = ""
        if host in PAGE_HOSTS:
            if url.path == "/watch":
                video = parse_qs(url.query).get("v", [""])[0]
            elif url.path.startswith("/live/"):
                video = url.path.removeprefix("/live/").strip("/")
        elif host == "youtu.be":
            video = url.path.strip("/")
        else:
            return None

        if VIDEO_ID_RE.fullmatch(video):
            return f"https://www.youtube.com/watch?v={video}"
    except ValueError:
        pass
    return None


def _allowed_hls_hosts() -> set[str]:
    raw = os.environ.get("HLS_ALLOWED_HOSTS", "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _allow_http() -> bool:
    return os.environ.get("HLS_ALLOW_HTTP", "").strip().lower() in {"1", "true", "yes"}


def direct_hls_url(value) -> str | None:
    """Return a normalized direct .m3u8 URL if it passes syntax checks, else None.

    Syntax only (no network). Host safety is checked separately in _check_hls_host.
    """
    if not isinstance(value, str):
        return None
    try:
        raw = value.strip()
        url = urlsplit(raw)
        host = (url.hostname or "").lower()
        schemes = {"https", "http"} if _allow_http() else {"https"}
        if (url.scheme not in schemes or not host or url.username or url.password
                or url.fragment or url.port not in HLS_PORTS):
            return None
        if host in PAGE_HOSTS or host == "youtu.be":
            return None  # YouTube pages are handled by the yt-dlp path
        if not url.path.lower().endswith(".m3u8"):
            return None
        if any(ch.isspace() or ord(ch) < 32 for ch in raw):
            return None
        return raw
    except ValueError:
        return None


def video_url(value) -> str | None:
    """URL-validation API used by camera and preview callers.

    Returns a canonical YouTube URL or a validated direct HLS URL, else None.
    """
    return canonical_video_url(value) or direct_hls_url(value)


def _cache_key(value) -> str | None:
    return canonical_video_url(value) or direct_hls_url(value)


# --------------------------------------------------------------------------
# Direct HLS: host safety + probe
# --------------------------------------------------------------------------
def _check_hls_host(url: str) -> None:
    """Raise unless the host is allowed and resolves only to public IPs."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()

    allowed = _allowed_hls_hosts()
    if allowed and host not in allowed and not any(host.endswith("." + a) for a in allowed):
        raise LiveResolveError("host_not_allowed", "This stream host is not in the allowed list.")

    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80),
                                   type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise LiveResolveError("hls_unreachable", "Could not resolve the stream host.") from None
    if not infos:
        raise LiveResolveError("hls_unreachable", "Could not resolve the stream host.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global:
            raise LiveResolveError(
                "private_host", "The stream host resolves to a non-public address.")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Surface redirects as HTTPError so each hop can be validated by us."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _probe_hls(url: str) -> None:
    """Confirm the URL is reachable and actually starts like an HLS playlist."""
    timeout = int(os.environ.get("HLS_PROBE_TIMEOUT", "10"))
    opener = urllib.request.build_opener(_NoRedirect)
    current = url

    for _ in range(HLS_MAX_REDIRECTS + 1):
        _check_hls_host(current)
        req = urllib.request.Request(current, headers={
            "User-Agent": "Mozilla/5.0 (compatible; hls-probe)",
            "Range": "bytes=0-2047",
            "Accept": "*/*",
        })
        try:
            with opener.open(req, timeout=timeout) as resp:
                head = resp.read(2048)
            break
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                location = e.headers.get("Location")
                if not location:
                    raise LiveResolveError("hls_http_error", "Bad redirect from stream server.") from None
                nxt = urljoin(current, location)
                if direct_hls_url(nxt) is None and urlsplit(nxt).scheme not in (
                        {"https", "http"} if _allow_http() else {"https"}):
                    raise LiveResolveError("hls_http_error", "Stream redirected to a disallowed URL.") from None
                current = nxt
                continue
            raise LiveResolveError("hls_http_error", f"Stream server returned HTTP {e.code}.") from None
        except (urllib.error.URLError, OSError, ValueError):
            raise LiveResolveError("hls_unreachable", "Could not reach the stream server.") from None
    else:
        raise LiveResolveError("hls_http_error", "Too many redirects from stream server.")

    if not head.lstrip(b"\xef\xbb\xbf \r\n\t").startswith(b"#EXTM3U"):
        raise LiveResolveError("hls_not_playlist", "The URL did not return a valid HLS playlist.")


def _resolve_direct_hls(url: str) -> str:
    _probe_hls(url)
    return url


# --------------------------------------------------------------------------
# YouTube resolvers (unchanged)
# --------------------------------------------------------------------------
def _sanitize(text: str, limit: int = 600) -> str:
    return URL_RE.sub("<url>", text or "")[-limit:]


def _classify(stderr: str) -> LiveResolveError:
    low = (stderr or "").lower()
    for pattern, code, message in _ERROR_PATTERNS:
        if re.search(pattern, low):
            return LiveResolveError(code, message)
    return LiveResolveError(
        "unknown", "YouTube resolution failed. Check server logs and update yt-dlp.")


def _valid_stream_url(stream) -> bool:
    if not isinstance(stream, str):
        return False
    try:
        url = urlsplit(stream)
        host = (url.hostname or "").lower()
    except ValueError:
        return False
    return (url.scheme == "https" and not url.username and not url.password
            and any(host == d or host.endswith("." + d) for d in STREAM_DOMAINS))


def _pick_stream(info: dict) -> str | None:
    candidates = [info.get("url")]
    for fmt in info.get("requested_formats") or []:
        if isinstance(fmt, dict):
            candidates.append(fmt.get("url"))
    candidates.append(info.get("manifest_url"))
    for c in candidates:
        if _valid_stream_url(c):
            return c
    return None


def _python_interpreter() -> str:
    """Find a Python interpreter that has yt-dlp and project dependencies."""
    project_root = Path(__file__).resolve().parent.parent
    venv_py = project_root / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if venv_py.is_file():
        return str(venv_py)
    prefix_py = Path(sys.prefix) / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if prefix_py.is_file():
        return str(prefix_py)
    return sys.executable


def _resolve_ytdlp(canonical, cookies_path=None):
    timeout = int(os.environ.get("YT_DLP_TIMEOUT", "45"))
    cmd = [
        _python_interpreter(), "-m", "yt_dlp",
        "--ignore-config", "--no-playlist", "--no-warnings",
        "--socket-timeout", "15", "--retries", "2",
        "-f", FORMAT,
        "--dump-single-json",
    ]

    cookie_file = cookies_path or os.environ.get("YOUTUBE_COOKIES_FILE")
    if cookie_file:
        if os.path.isfile(cookie_file):
            cmd += ["--cookies", cookie_file]
        else:
            log.warning("Cookies file not found: %s (continuing without it)", cookie_file)

    cmd += ["--", canonical]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise LiveResolveError("timeout", f"yt-dlp timed out after {timeout}s.") from None
    except OSError:
        raise LiveResolveError("no_ytdlp", "Could not start yt-dlp (is it installed?).") from None

    if proc.returncode != 0:
        log.error("yt-dlp failed (exit %s): %s", proc.returncode, _sanitize(proc.stderr))
        if "No module named yt_dlp" in (proc.stderr or ""):
            raise LiveResolveError("no_ytdlp", "yt-dlp is not installed: pip install -U yt-dlp")
        raise _classify(proc.stderr)

    try:
        info = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise LiveResolveError("bad_metadata", "Invalid YouTube stream metadata.") from None
    if not isinstance(info, dict):
        raise LiveResolveError("bad_metadata", "Invalid YouTube stream metadata.")

    if not (info.get("is_live") is True or info.get("live_status") == "is_live"):
        raise LiveResolveError(
            "not_live", "The configured YouTube video is not currently live.")

    stream = _pick_stream(info)
    if not stream:
        raise LiveResolveError("bad_stream", "No supported YouTube stream URL was returned.")

    return stream


def _resolve_streamlink(canonical, cookies_path=None):
    """Resolve only the validated YouTube URL, without launching a player."""
    timeout = int(os.environ.get("STREAMLINK_TIMEOUT", "30"))
    cmd = [
        _python_interpreter(), "-m", "streamlink", "--no-config",
        "--no-plugin-sideloading", "--no-plugin-cache", "--loglevel", "none",
        "--http-timeout", "10", "--stream-types", "hls",
        "--stream-url",
    ]
    cookie_file = cookies_path or os.environ.get("YOUTUBE_COOKIES_FILE")
    if cookie_file and os.path.isfile(cookie_file):
        cmd += ["--http-cookies-file", cookie_file]
    cmd += [canonical, "720p,480p,360p,240p,144p,best"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise LiveResolveError("streamlink_timeout", "Streamlink fallback timed out.") from None
    except OSError:
        raise LiveResolveError("no_streamlink", "Could not start Streamlink fallback.") from None
    if proc.returncode != 0:
        # Do not expose provider output, cookies or signed stream URLs.
        if "No module named streamlink" in (proc.stderr or ""):
            raise LiveResolveError("no_streamlink", "Streamlink fallback is not installed.")
        raise LiveResolveError("streamlink_failed", "Streamlink found no playable live HLS stream.")
    stream = proc.stdout.strip()
    if not _valid_stream_url(stream) or len(stream.splitlines()) != 1:
        raise LiveResolveError("bad_stream", "Streamlink returned an unsupported stream URL.")
    return stream


def _resolve_youtube(canonical, cookies_path=None) -> str:
    try:
        return _resolve_ytdlp(canonical, cookies_path)
    except LiveResolveError as primary:
        # Do not retry private, blocked, offline, ended or non-live content.
        if primary.code not in {"no_format", "no_ytdlp", "no_js_runtime",
                                "timeout", "unknown", "bad_metadata"}:
            raise
        log.warning("yt-dlp resolver failed (%s); trying Streamlink", primary.code)
        try:
            return _resolve_streamlink(canonical, cookies_path)
        except LiveResolveError as fallback:
            raise LiveResolveError(
                primary.code, f"{primary} Streamlink fallback: {fallback}") from None


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------
def resolve(value, cookies_path: str | None = None, *, use_cache: bool = True) -> str:
    """Return a playable stream URL for a YouTube live link or a direct .m3u8 URL."""
    youtube = canonical_video_url(value)
    direct = None if youtube else direct_hls_url(value)
    key = youtube or direct
    if not key:
        raise LiveResolveError(
            "bad_url",
            "Use an HTTPS YouTube watch/live link with a video ID, or a direct .m3u8 URL.")

    if use_cache:
        with _cache_lock:
            hit = _cache.get(key)
            if hit and hit[0] > time.time():
                return hit[1]

    stream = _resolve_youtube(youtube, cookies_path) if youtube else _resolve_direct_hls(direct)

    with _cache_lock:
        _cache[key] = (time.time() + CACHE_TTL, stream)
    return stream


def forget_cached(value) -> None:
    """Drop a cached stream URL so the next capture retry resolves a fresh one."""
    key = _cache_key(value)
    if key:
        with _cache_lock:
            _cache.pop(key, None)


def doctor() -> int:
    """Print an environment checklist."""
    ok = True

    def check(label: str, passed: bool, detail: str = ""):
        nonlocal ok
        ok &= passed
        print(f"[{'OK' if passed else 'FAIL'}] {label} {detail}".rstrip())

    check("Python >= 3.9", sys.version_info >= (3, 9), sys.version.split()[0])
    try:
        import yt_dlp  # noqa: F401
        from yt_dlp.version import __version__
        check("yt-dlp installed", True, __version__)
    except ImportError:
        check("yt-dlp installed", False, "-> pip install -U yt-dlp")
    try:
        from importlib.metadata import version, PackageNotFoundError
        check("Streamlink fallback installed", True, version("streamlink"))
    except PackageNotFoundError:
        check("Streamlink fallback installed", False, "-> pip install -r backend/requirements.txt")
    runtime = shutil.which("deno") or shutil.which("node")
    check("JS runtime (deno/node) on PATH", bool(runtime), runtime or "-> install Deno or Node")
    cf = os.environ.get("YOUTUBE_COOKIES_FILE")
    if cf:
        check("YOUTUBE_COOKIES_FILE exists", os.path.isfile(cf), cf)
    else:
        print("[--] YOUTUBE_COOKIES_FILE not set (optional; needed if you get bot checks)")
    hosts = _allowed_hls_hosts()
    print(f"[--] HLS_ALLOWED_HOSTS: {', '.join(sorted(hosts)) if hosts else 'not set (any public host allowed)'}")
    print(f"[--] HLS_ALLOW_HTTP: {'on' if _allow_http() else 'off (https only)'}")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", nargs="?",
                        help="YouTube watch/live/youtu.be link or direct .m3u8 URL")
    parser.add_argument("--cookies", help="path to cookies.txt (YouTube only)")
    parser.add_argument("--doctor", action="store_true", help="check the environment")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING,
                        format="%(levelname)s %(message)s")

    if args.doctor:
        return doctor()
    if not args.url:
        parser.error("url is required (or use --doctor)")

    try:
        print(resolve(args.url, args.cookies))
        return 0
    except LiveResolveError as e:
        print(f"error[{e.code}]: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())