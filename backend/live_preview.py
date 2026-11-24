"""Opt-in sampled YOLO preview. Independent of clip rules, evidence and alert delivery."""
import logging
import threading
import time
from pathlib import Path

from . import streams
from .models import detector_checkpoint

log = logging.getLogger('zenith.live-preview')
_lock = threading.Lock()
_inference_lock = threading.Lock()
_sessions = {}
MAX_PREVIEWS = 2


def _active(runtime):
    return bool(runtime and (runtime['thread'].is_alive()
                            or (runtime.get('decoder') and runtime['decoder'].is_alive())))


def status(camera_id):
    with _lock:
        runtime = _sessions.get(camera_id)
        if not runtime:
            return {'state': 'stopped', 'active': False, 'captured_at': None, 'predicted_at': None}
        return {key: runtime.get(key) for key in ('state', 'captured_at', 'predicted_at', 'detections')} | {
            'active': _active(runtime), 'model': Path(detector_checkpoint('zone')).name,
            'max_fps': 2, 'detail': 'Sampled people/vehicle detections only; no alert rules run in this preview.'}


def start(camera_id, url):
    if not streams.canonical(url):
        raise ValueError('Only saved YouTube or HTTPS HLS inputs support this preview')
    with _lock:
        previous = _sessions.get(camera_id)
        if _active(previous):
            if previous['stop'].is_set():
                raise ValueError('Preview is stopping; wait before restarting')
            previous['requested_at'] = time.monotonic()
        else:
            if sum(_active(item) for item in _sessions.values()) >= MAX_PREVIEWS:
                raise ValueError('Two annotated previews are already active. Stop one before opening another.')
            runtime = {'stop': threading.Event(), 'state': 'loading model', 'raw': None,
                       'jpeg': None, 'captured_at': None, 'predicted_at': None,
                       'requested_at': time.monotonic(), 'detections': 0}
            runtime['thread'] = threading.Thread(target=_run, args=(runtime, url), daemon=True,
                                                 name=f'zenith-preview-{camera_id[:8]}')
            _sessions[camera_id] = runtime
            runtime['thread'].start()
    return status(camera_id)


def stop(camera_id):
    with _lock:
        runtime = _sessions.get(camera_id)
        if runtime:
            runtime['stop'].set()
            runtime['state'] = 'stopping' if _active(runtime) else 'stopped'
    return status(camera_id)


def forget(camera_id):
    with _lock:
        runtime = _sessions.get(camera_id)
        if _active(runtime):
            raise ValueError('Stop the annotated preview and wait before removing this camera')
        _sessions.pop(camera_id, None)


def stop_all():
    with _lock:
        for runtime in _sessions.values():
            runtime['stop'].set()


def frame(camera_id):
    with _lock:
        runtime = _sessions.get(camera_id)
        if not runtime:
            raise ValueError('Start the annotated preview first')
        runtime['requested_at'] = time.monotonic()
        if (not _active(runtime) or not runtime.get('predicted_at') or not runtime['jpeg']
                or time.time() - runtime['predicted_at'] > 15
                or time.time() - runtime['captured_at'] > 15):
            raise ValueError('No fresh annotated frame yet; check preview status')
        return runtime['jpeg'], runtime['captured_at'], runtime['predicted_at']


def _decode(runtime, url):
    import cv2
    stop_event = runtime['stop']
    delay = 5
    try:
        while not stop_event.is_set():
            cap = None
            opened = False
            try:
                stream = streams.resolve(url)
                cap = cv2.VideoCapture(stream, cv2.CAP_FFMPEG, [
                    cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
                if not cap.isOpened():
                    # A signed YouTube URL can expire before the cache TTL; resolve fresh next time.
                    streams.forget(url)
                    raise ValueError('Stream could not be opened')
                opened = True
                delay = 5
                while not stop_event.is_set():
                    ok, image = cap.read()
                    if not ok:
                        break
                    height, width = image.shape[:2]
                    if not 0 < width <= 3840 or not 0 < height <= 2160:
                        raise ValueError('Unsupported stream dimensions')
                    if max(height, width) > 960:
                        scale = 960 / max(height, width)
                        image = cv2.resize(image, (round(width*scale), round(height*scale)))
                    with _lock:
                        runtime['raw'] = (image, time.time())
                with _lock:
                    runtime['state'] = 'reconnecting'
            except Exception:
                # Never return provider diagnostics or signed stream URLs.
                with _lock:
                    runtime['state'] = 'stream unavailable; reconnecting'
            finally:
                if cap is not None:
                    cap.release()
            stop_event.wait(delay)
            if not opened:
                delay = min(60, delay * 2)
    finally:
        stop_event.set()


def _run(runtime, url):
    stop_event = runtime['stop']
    failed = False
    try:
        import cv2
        from ultralytics import YOLO

        # Serialize model loading/prediction to bound preview CPU/GPU pressure.
        with _inference_lock:
            model = YOLO(detector_checkpoint('zone'))
        if stop_event.is_set():
            return
        decoder = threading.Thread(target=_decode, args=(runtime, url), daemon=True)
        with _lock:
            runtime['decoder'] = decoder
            runtime['state'] = 'connecting'
        decoder.start()
        last_frame = None
        while not stop_event.is_set():
            with _lock:
                raw = runtime['raw']
                idle = time.monotonic() - runtime['requested_at'] > 90
            if idle:
                break
            if raw is None or raw[1] == last_frame or time.time() - raw[1] > 10:
                stop_event.wait(.25)
                continue
            image, captured_at = raw
            with _inference_lock:
                if stop_event.is_set():
                    break
                # Show all checkpoint categories; rule analysis still filters its required classes.
                result = model.predict(image, device='cpu', conf=.3, imgsz=416, verbose=False)[0]
                annotated = result.plot()
            ok, encoded = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ok:
                raise ValueError('Preview encoding failed')
            with _lock:
                runtime.update(jpeg=encoded.tobytes(), captured_at=captured_at, predicted_at=time.time(),
                               detections=len(result.boxes), state='running')
            last_frame = captured_at
            stop_event.wait(.5)
    except Exception:
        failed = True
        log.error('Annotated preview failed; inspect model installation and stream access privately')
        with _lock:
            runtime['state'] = 'preview failed; check model installation and stream access'
    finally:
        stop_event.set()
        with _lock:
            runtime['raw'] = None
            if not failed:
                runtime['state'] = 'stopped'
