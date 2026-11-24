#!/usr/bin/env python3
"""
Resolve a permissioned YouTube live link to its HLS stream URL (server-side).

- Accepts only HTTPS YouTube watch / live / youtu.be links with an 11-char video ID.
- Runs yt-dlp in a subprocess with a timeout, never through a shell.
- Gives specific, safe error codes (no signed URLs ever leak into errors or logs).
- Caches results briefly, because googlevideo URLs expire and resolving is slow.
- Falls back to Streamlink for resolver/format failures, not access restrictions.

Env vars (all optional):
    YOUTUBE_COOKIES_FILE   path to a Netscape cookies.txt (helps on cloud/server IPs)
    YT_DLP_TIMEOUT         seconds to wait for yt-dlp (default 45)
    STREAMLINK_TIMEOUT     seconds to wait for fallback (default 30)

Usage:
    python youtube_live.py "https://www.youtube.com/watch?v=VIDEO_ID"
    python youtube_live.py --doctor
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

log = logging.getLogger("youtube_live")

PAGE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com"}
STREAM_DOMAINS = ("googlevideo.com", "youtube.com")
VIDEO_ID_RE = re.compile(r"[A-Za-z0-9_-]{11}")
URL_RE = re.compile(r"https?://\S+")

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


def video_url(value) -> str | None:
    """Keep the URL-validation API used by camera and preview callers."""
    return canonical_video_url(value)


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


def resolve(value, cookies_path: str | None = None, *, use_cache: bool = True) -> str:
    canonical = canonical_video_url(value)
    if not canonical:
        raise LiveResolveError(
            "bad_url", "Configure an HTTPS YouTube watch/live link with a video ID.")
    if use_cache:
        with _cache_lock:
            hit = _cache.get(canonical)
            if hit and hit[0] > time.time():
                return hit[1]
    try:
        stream = _resolve_ytdlp(canonical, cookies_path)
    except LiveResolveError as primary:
        # Do not retry private, blocked, offline, ended or non-live content.
        if primary.code not in {"no_format", "no_ytdlp", "no_js_runtime",
                                "timeout", "unknown", "bad_metadata"}:
            raise
        log.warning("yt-dlp resolver failed (%s); trying Streamlink", primary.code)
        try:
            stream = _resolve_streamlink(canonical, cookies_path)
        except LiveResolveError as fallback:
            raise LiveResolveError(
                primary.code, f"{primary} Streamlink fallback: {fallback}") from None
    with _cache_lock:
        _cache[canonical] = (time.time() + CACHE_TTL, stream)
    return stream


def forget_cached(value) -> None:
    """Drop a cached stream URL so the next capture retry resolves a fresh one."""
    canonical = canonical_video_url(value)
    if canonical:
        with _cache_lock:
            _cache.pop(canonical, None)


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
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url", nargs="?", help="YouTube watch/live/youtu.be link")
    parser.add_argument("--cookies", help="path to cookies.txt")
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
