"""Canonical stream URLs accepted by saved camera inputs.

Saved cameras may point at a YouTube watch/live page or a direct HLS manifest.
Validation, host safety and playlist probing live in :mod:`backend.youtube` so
the API, capture threads and previews cannot drift apart: direct HLS hosts must
resolve to public addresses, redirects are re-checked, and the URL must return
an ``#EXTM3U`` playlist before OpenCV opens it.  YouTube pages go through the
yt-dlp resolver.
"""
from . import youtube


def hls_url(value):
    """Return the direct HLS URL accepted by the shared validator, or None."""
    return youtube.direct_hls_url(value)


def canonical(value):
    """Return the stored form for an accepted YouTube or HLS URL, else None."""
    return youtube.video_url(value)


def protocol(value):
    if youtube.canonical_video_url(value):
        return 'YouTube'
    if youtube.direct_hls_url(value):
        return 'HLS'
    return None


def resolve(value):
    """Resolve a saved input to a URL OpenCV can open (probes direct HLS)."""
    if not canonical(value):
        raise ValueError('Use an HTTPS HLS .m3u8 link or a YouTube watch/live link')
    return youtube.resolve(value)


def forget(value):
    """Drop a cached resolution after a stream fails to open."""
    youtube.forget_cached(value)
