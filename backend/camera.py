"""Opt-in, single-process RTSP capture into short bounded analysis jobs."""
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import func, select

from .config import CLIP_SECONDS, DATA, MAX_DURATION, MAX_UPLOAD, STORAGE_LIMIT
from .db import Run, Session, Source

log = logging.getLogger('zenith.camera')
_lock = threading.Lock()
_stop = threading.Event()
_thread = None
_state = {'state': 'stopped', 'last_clip_at': None, 'owner': None}


def clip_seconds(rule):
    """Short clips cut delay, but a zone rule must see its full dwell plus a margin."""
    if rule.get('capability') == 'traffic':
        return CLIP_SECONDS
    return max(CLIP_SECONDS, min(float(MAX_DURATION), float(rule.get('dwell_seconds', 2)) + 2))


def source_url():
    return (os.getenv('ZENITH_CAMERA_URL') or os.getenv('ZENITH_RTSP_URL', '')).strip()


def configured():
    url = source_url()
    try:
        parsed = urlsplit(url)
        rtsp = parsed.scheme in ('rtsp', 'rtsps') and bool(parsed.hostname) and parsed.port is not None
        hls = (parsed.scheme == 'https' and bool(parsed.hostname) and parsed.path.lower().endswith('.m3u8')
               and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)
        valid = rtsp or hls
    except ValueError:
        valid = False
    return valid


def status(owner=None):
    with _lock:
        if owner is not None and _thread and _thread.is_alive() and _state['owner'] not in (None, owner):
            return {'configured': configured(), 'state': 'in use by another operator',
                    'last_clip_at': None, 'mode': 'bounded network clips; not real-time alerts'}
        return {'configured': configured(), 'state': _state['state'],
                'last_clip_at': _state['last_clip_at'], 'protocol': 'HLS' if source_url().startswith('https://') else 'RTSP',
                'clip_seconds': CLIP_SECONDS,
                'mode': 'bounded network clips; not real-time alerts'}


def start(owner, rule):
    global _thread
    if not configured():
        raise ValueError('Set a server-side RTSP URL (explicit port) or HTTPS HLS .m3u8 URL first')
    with _lock:
        if _thread and _thread.is_alive():
            raise ValueError('RTSP capture is already running')
        _stop.clear()
        _state['state'] = 'connecting'
        _state['owner'] = owner
        _thread = threading.Thread(target=_capture, args=(owner, rule), daemon=True, name='zenith-rtsp')
        _thread.start()
    return status(owner)


def stop(owner=None):
    with _lock:
        if owner is not None and _state['owner'] not in (None, owner) and _thread and _thread.is_alive():
            raise ValueError('Only the operator who started this camera may stop it')
        _stop.set()
        if _thread and _thread.is_alive():
            _state['state'] = 'stopping'
        else:
            _state['state'] = 'stopped'
            _state['owner'] = None
    return status(owner)


def _capture(owner, rule):
    import cv2

    url = source_url()
    protocol = 'HLS' if url.startswith('https://') else 'RTSP'
    seconds = clip_seconds(rule)
    try:
        while not _stop.is_set():
            with Session() as session:
                sources = list(session.scalars(select(Source).where(Source.owner == owner)))
                count = len(sources)
                remaining = STORAGE_LIMIT - sum(x.payload.get('bytes', 0) for x in sources)
                pending = session.scalar(select(func.count()).select_from(Run).where(
                    Run.owner == owner, Run.status.in_(['queued', 'processing'])))
            if count >= 30 or remaining < 2 * 1024 * 1024:
                with _lock:
                    _state['state'] = 'storage or source limit reached; archive clips before restarting'
                return
            if pending >= 3:
                with _lock:
                    _state['state'] = 'waiting for analysis capacity'
                _stop.wait(3)
                continue
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
            if not cap.isOpened():
                cap.release()
                with _lock:
                    _state['state'] = 'reconnecting'
                _stop.wait(5)
                continue
            with _lock:
                _state['state'] = 'capturing'
            source_id = str(uuid.uuid4())
            path = DATA / 'sources' / f'{source_id}.webm'
            preview = DATA / 'sources' / f'{source_id}.jpg'
            writer = None
            frames = 0
            start_at = time.monotonic()
            last_frame_at = start_at
            width = height = 0
            try:
                while not _stop.is_set() and time.monotonic() - start_at < seconds:
                    ok, frame = cap.read()
                    if not ok:
                        break
                    if writer is None:
                        height, width = frame.shape[:2]
                        if not 0 < width <= 3840 or not 0 < height <= 2160:
                            break
                        scale = min(1, 960 / max(width, height))
                        width, height = max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)
                        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'VP80'), 10, (width, height))
                        if not writer.isOpened():
                            break
                        cv2.imwrite(str(preview), cv2.resize(frame, (width, height)))
                    now = time.monotonic()
                    if now - last_frame_at < 0.1 and frames:
                        continue
                    writer.write(cv2.resize(frame, (width, height)))
                    frames += 1
                    last_frame_at = now
            finally:
                cap.release()
                if writer:
                    writer.release()
            if _stop.is_set() or frames < 10 or not path.is_file() or path.stat().st_size > min(MAX_UPLOAD, remaining) or not preview.is_file():
                path.unlink(missing_ok=True)
                preview.unlink(missing_ok=True)
                if not _stop.is_set():
                    with _lock:
                        _state['state'] = 'reconnecting'
                    _stop.wait(5)
                continue
            # The written file contains 10 frames per second; frame timestamps are relative to this clip.
            duration = frames / 10
            with Session() as session:
                session.add(Source(id=source_id, owner=owner, payload={
                    'name': f'{protocol} clip · {time.strftime("%Y-%m-%d %H:%M:%S")}',
                    'file': path.name, 'duration': duration, 'fps': 10, 'width': width,
                    'height': height, 'input_type': protocol.lower(), 'bytes': path.stat().st_size}))
                session.add(Run(owner=owner, payload={
                    'source_id': source_id, 'source_name': f'{protocol} clip · {source_id[:8]}',
                    'rule': rule, 'progress': 0, 'stage': 'Waiting for analysis worker',
                    'counts': {}, 'coverage': 'pending'}))
                session.commit()
            with _lock:
                _state['last_clip_at'] = time.time()
    except Exception:
        # Never log an exception/connection URL: it can include RTSP credentials.
        log.error('Network capture stopped unexpectedly; inspect configuration privately')
        with _lock:
            _state['state'] = 'capture failed'
        return
    with _lock:
        _state['state'] = 'stopped'
        _state['owner'] = None


def snapshot(owner=None):
    """One operator-requested still for checking geometry; never expose the stream URL."""
    import cv2

    if not configured():
        raise ValueError('Configure the network stream URL on the laptop backend')
    with _lock:
        if owner is not None and _thread and _thread.is_alive() and _state['owner'] not in (None, owner):
            raise ValueError('Camera is in use by another operator')
    cap = None
    try:
        cap = cv2.VideoCapture(source_url(), cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
        ok, frame = cap.read()
        if not ok:
            raise ValueError('Camera preview unavailable; check the stream privately')
        height, width = frame.shape[:2]
        if max(height, width) > 960:
            scale = 960 / max(height, width)
            frame = cv2.resize(frame, (round(width * scale), round(height * scale)))
        success, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not success:
            raise ValueError('Could not encode camera preview')
        return jpeg.tobytes()
    except cv2.error:
        raise ValueError('Camera preview failed; check the stream privately') from None
    finally:
        if cap:
            cap.release()
