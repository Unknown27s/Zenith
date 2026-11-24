"""Opt-in, single-process RTSP capture into short bounded analysis jobs."""
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import func, select, text

from .config import CLIP_SECONDS, DATA, MAX_DURATION, MAX_UPLOAD, STORAGE_LIMIT
from .db import Run, Session, Source
from . import youtube

log = logging.getLogger('zenith.camera')
_lock = threading.Lock()
_stop = threading.Event()
_thread = None
_state = {'state': 'stopped', 'last_clip_at': None, 'owner': None}
_saved = {}
MAX_ACTIVE_CAMERAS = 3


def saved_status(camera_id):
    with _lock:
        runtime = _saved.get(camera_id)
        state = runtime['state'] if runtime else {'state': 'stopped', 'last_clip_at': None}
        return {'configured': True, 'protocol': 'YouTube', 'state': state['state'],
                'last_clip_at': state['last_clip_at'], 'active': bool(runtime and runtime['thread'].is_alive()),
                'clip_seconds': CLIP_SECONDS, 'mode': 'bounded clips; shared analysis worker'}


def start_saved(owner, camera_id, name, url, rule, approval=None):
    """Each saved input has its own stop event, rule snapshot and capture thread."""
    canonical = youtube.video_url(url)
    if not canonical:
        raise ValueError('Use a valid HTTPS YouTube watch or live video link')
    with _lock:
        previous = _saved.get(camera_id)
        if previous and previous['thread'].is_alive():
            raise ValueError('This camera is already running or stopping')
        active = sum(runtime['thread'].is_alive() for runtime in _saved.values())
        if active + bool(_thread and _thread.is_alive()) >= MAX_ACTIVE_CAMERAS:
            raise ValueError('At most three demo inputs can capture at once; all share one analysis worker')
        runtime = {'stop': threading.Event(),
                   'state': {'state': 'connecting', 'last_clip_at': None, 'owner': owner}}
        runtime['thread'] = threading.Thread(target=_capture,
            args=(owner, rule, approval, runtime, canonical, camera_id, name),
            daemon=True, name=f'zenith-camera-{camera_id[:8]}')
        _saved[camera_id] = runtime
        runtime['thread'].start()
    return saved_status(camera_id)


def stop_saved(camera_id):
    with _lock:
        runtime = _saved.get(camera_id)
        if runtime:
            runtime['stop'].set()
            runtime['state']['state'] = 'stopping' if runtime['thread'].is_alive() else 'stopped'
    return saved_status(camera_id)


def forget_saved(camera_id):
    with _lock:
        runtime = _saved.get(camera_id)
        if runtime and runtime['thread'].is_alive():
            raise ValueError('Stop the camera and wait for it to finish before removing it')
        _saved.pop(camera_id, None)


def stop_all():
    stop()
    with _lock:
        for runtime in _saved.values():
            runtime['stop'].set()


def clip_seconds(rule):
    """Short clips cut delay, but a zone rule must see its full dwell plus a margin."""
    if rule.get('capability') == 'traffic':
        return CLIP_SECONDS
    return max(CLIP_SECONDS, min(float(MAX_DURATION), float(rule.get('dwell_seconds', 2)) + 2))


def source_url():
    return (os.getenv('ZENITH_YOUTUBE_URL') or os.getenv('ZENITH_CAMERA_URL') or os.getenv('ZENITH_RTSP_URL', '')).strip()


def protocol():
    return 'YouTube' if youtube.video_url(source_url()) else 'HLS' if source_url().startswith('https://') else 'RTSP'


def capture_url():
    value = source_url()
    return youtube.resolve(value) if youtube.video_url(value) else value


def configured():
    url = source_url()
    try:
        parsed = urlsplit(url)
        rtsp = parsed.scheme in ('rtsp', 'rtsps') and bool(parsed.hostname) and parsed.port is not None
        hls = (parsed.scheme == 'https' and bool(parsed.hostname) and parsed.path.lower().endswith('.m3u8')
               and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)
        valid = rtsp or hls or bool(youtube.video_url(url))
    except ValueError:
        valid = False
    return valid


def status(owner=None):
    with _lock:
        if owner is not None and _thread and _thread.is_alive() and _state['owner'] not in (None, owner):
            return {'configured': configured(), 'state': 'in use by another operator',
                    'last_clip_at': None, 'mode': 'bounded network clips; not real-time alerts'}
        return {'configured': configured(), 'state': _state['state'],
                'last_clip_at': _state['last_clip_at'], 'protocol': protocol(),
                'clip_seconds': CLIP_SECONDS,
                'mode': 'bounded network clips; not real-time alerts'}


def start(owner, rule, vision_authorization=None):
    global _thread
    if not configured():
        raise ValueError('Set a server-side RTSP, HTTPS HLS .m3u8, or YouTube live URL first')
    with _lock:
        if _thread and _thread.is_alive():
            raise ValueError('RTSP capture is already running')
        if sum(runtime['thread'].is_alive() for runtime in _saved.values()) >= MAX_ACTIVE_CAMERAS:
            raise ValueError('At most three demo inputs can capture at once')
        _stop.clear()
        _state['state'] = 'connecting'
        _state['owner'] = owner
        _thread = threading.Thread(target=_capture, args=(owner, rule, vision_authorization), daemon=True, name='zenith-rtsp')
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


def _capture(owner, rule, vision_authorization=None, runtime=None, input_url=None, camera_id=None, camera_name=None):
    import cv2

    state = runtime['state'] if runtime else _state
    stop_event = runtime['stop'] if runtime else _stop
    source_protocol = 'YouTube' if input_url else protocol()
    source_name = camera_name or source_protocol
    seconds = clip_seconds(rule)
    resolver_input = input_url or source_url()
    delay = 5
    try:
        while not stop_event.is_set():
            with Session() as session:
                sources = list(session.scalars(select(Source).where(Source.owner == owner)))
                count = len(sources)
                remaining = STORAGE_LIMIT - sum(x.payload.get('bytes', 0) for x in sources)
                pending = session.scalar(select(func.count()).select_from(Run).where(
                    Run.owner == owner, Run.status.in_(['queued', 'processing'])))
            if count >= 30 or remaining < 2 * 1024 * 1024:
                with _lock:
                    state['state'] = 'storage or source limit reached; archive clips before restarting'
                return
            if pending >= 3:
                with _lock:
                    state['state'] = 'waiting for analysis capacity'
                stop_event.wait(3)
                continue
            try:
                url = youtube.resolve(input_url) if input_url else capture_url()
            except ValueError:
                with _lock:
                    state['state'] = 'capture failed'
                return
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
            if not cap.isOpened():
                cap.release()
                youtube.forget_cached(resolver_input)
                with _lock:
                    state['state'] = 'reconnecting'
                stop_event.wait(delay)
                delay = min(60, delay * 2)
                continue
            with _lock:
                state['state'] = 'capturing'
            source_id = str(uuid.uuid4())
            path = DATA / 'sources' / f'{source_id}.webm'
            preview = DATA / 'sources' / f'{source_id}.jpg'
            writer = None
            frames = 0
            start_at = time.monotonic()
            last_frame_at = start_at
            width = height = 0
            try:
                while not stop_event.is_set() and time.monotonic() - start_at < seconds:
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
            if stop_event.is_set() or frames < 10 or not path.is_file() or path.stat().st_size > min(MAX_UPLOAD, remaining) or not preview.is_file():
                path.unlink(missing_ok=True)
                preview.unlink(missing_ok=True)
                if not stop_event.is_set():
                    if not frames:
                        youtube.forget_cached(resolver_input)
                    with _lock:
                        state['state'] = 'reconnecting'
                    stop_event.wait(delay)
                    delay = min(60, delay * 2)
                continue
            # The written file contains 10 frames per second; frame timestamps are relative to this clip.
            duration = frames / 10
            with Session() as session:
                # Serialize admission with /runs, including other camera capture threads.
                if session.bind.dialect.name == 'sqlite':
                    session.execute(text('BEGIN IMMEDIATE'))
                elif session.bind.dialect.name == 'postgresql':
                    session.execute(select(func.pg_advisory_xact_lock(int(owner[:15], 16))))
                pending = session.scalar(select(func.count()).select_from(Run).where(
                    Run.owner == owner, Run.status.in_(['queued', 'processing'])))
                existing = list(session.scalars(select(Source).where(Source.owner == owner)))
                used = sum(row.payload.get('bytes', 0) for row in existing)
                if (stop_event.is_set() or pending >= 3 or len(existing) >= 30
                        or used + path.stat().st_size > STORAGE_LIMIT):
                    path.unlink(missing_ok=True)
                    preview.unlink(missing_ok=True)
                    with _lock:
                        state['state'] = 'waiting for analysis capacity'
                    continue
                session.add(Source(id=source_id, owner=owner, payload={
                    'name': f'{source_name} clip · {time.strftime("%Y-%m-%d %H:%M:%S")}',
                    'file': path.name, 'duration': duration, 'fps': 10, 'width': width,
                    'height': height, 'input_type': source_protocol.lower(), 'bytes': path.stat().st_size,
                    'camera_id': camera_id, 'camera_name': camera_name}))
                session.add(Run(owner=owner, payload={
                    'source_id': source_id, 'source_name': f'{source_name} clip · {source_id[:8]}',
                    'camera_id': camera_id, 'camera_name': camera_name,
                    'rule': rule, 'progress': 0, 'stage': 'Waiting for analysis worker',
                    'counts': {}, 'coverage': 'pending',
                    **({'vision_authorization': vision_authorization} if vision_authorization else {})}))
                session.commit()
            with _lock:
                state['last_clip_at'] = time.time()
            delay = 5
    except Exception:
        # Never log an exception/connection URL: it can include RTSP credentials.
        log.error('Network capture stopped unexpectedly; inspect configuration privately')
        with _lock:
            state['state'] = 'capture failed'
        return
    with _lock:
        state['state'] = 'stopped'
        state['owner'] = None


def snapshot(owner=None, input_url=None):
    """One operator-requested still for checking geometry; never expose the stream URL."""
    import cv2

    if not input_url and not configured():
        raise ValueError('Configure the network stream URL on the laptop backend')
    with _lock:
        if not input_url and owner is not None and _thread and _thread.is_alive() and _state['owner'] not in (None, owner):
            raise ValueError('Camera is in use by another operator')
    cap = None
    try:
        cap = cv2.VideoCapture(youtube.resolve(input_url) if input_url else capture_url(), cv2.CAP_FFMPEG, [
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
