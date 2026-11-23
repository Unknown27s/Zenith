"""Server-configured, permissioned YouTube live input; never accepts arbitrary sites."""
import json
import os
import re
import subprocess
import sys
from urllib.parse import parse_qs, urlsplit


def video_url(value):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value.strip())
        if url.scheme != 'https' or url.username or url.password or url.port or url.fragment:
            return None
        if url.hostname in {'youtube.com', 'www.youtube.com', 'm.youtube.com'}:
            if url.path == '/watch':
                video = parse_qs(url.query).get('v', [''])[0]
            elif url.path.startswith('/live/'):
                video = url.path.removeprefix('/live/').rstrip('/')
            else:
                video = ''
        elif url.hostname == 'youtu.be':
            video = url.path.lstrip('/').rstrip('/')
        else:
            return None
        if re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
            return f'https://www.youtube.com/watch?v={video}'
    except ValueError:
        pass
    return None


def resolve(value, cookies_path=None):
    canonical = video_url(value)
    if not canonical:
        raise ValueError('Configure an HTTPS YouTube watch/live link with a video ID')

    cmd = [
        sys.executable, '-m', 'yt_dlp',
        '--ignore-config',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout', '15',
        '--retries', '2',
        '-f', 'b[height<=720]/b',
        '--dump-single-json',
    ]

    # Optional: pass cookies file via argument or YOUTUBE_COOKIES_FILE env var if running on a cloud/server IP
    cookie_file = cookies_path or os.environ.get('YOUTUBE_COOKIES_FILE')
    if cookie_file and os.path.isfile(cookie_file):
        cmd.extend(['--cookies', cookie_file])

    cmd.extend(['--', canonical])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,
            check=True,
        )
        info = json.loads(result.stdout)
        if not isinstance(info, dict):
            raise ValueError('Invalid YouTube stream metadata')
        if info.get('is_live') is not True:
            raise ValueError('The configured YouTube video is not currently live; use a labelled local replay instead')

        # Live HLS streams may populate 'url' or 'manifest_url'
        stream = info.get('url') or info.get('manifest_url')
        if not isinstance(stream, str):
            raise ValueError('Invalid YouTube stream metadata')

        url = urlsplit(stream)
        host = url.hostname or ''
        if (url.scheme != 'https' or url.username or url.password
                or not any(host == domain or host.endswith('.' + domain)
                           for domain in ('googlevideo.com', 'youtube.com'))):
            raise ValueError('Unsupported YouTube stream host')

        return stream

    except ValueError:
        # Re-raise our clean validation errors as-is
        raise
    except (subprocess.SubprocessError, OSError, KeyError, TypeError, json.JSONDecodeError):
        # yt-dlp diagnostics can include signed stream URLs. Never expose them.
        raise ValueError('YouTube resolution failed; install/update yt-dlp and check live access privately') from None