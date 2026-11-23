"""Isolated camera API/capture tests. No YouTube, Telegram or hosted model is contacted."""
import os
import sys
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
temp_root = Path(os.getenv('LOCALAPPDATA', tempfile.gettempdir())) / 'Temp' / 'opencode'
temp_root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='zenith-cameras-', dir=temp_root) as directory:
    os.environ.update(ZENITH_DATA=directory, DATABASE_URL=f'sqlite:///{Path(directory).as_posix()}/test.db',
                      ZENITH_API_KEY='offline-camera-test-key-at-least-24-characters', VISION_PROVIDER='off',
                      TELEGRAM_BOT_TOKEN='', ZENITH_TELEGRAM_CHATS='')
    import cv2
    import numpy as np
    from fastapi.testclient import TestClient
    from sqlalchemy import event, select
    from backend import camera, live_preview, youtube
    from backend.config import DATA, TOKEN
    from backend.db import CameraInput, Run, Session, Source, engine
    from backend.main import app

    headers = {'Authorization': f'Bearer {TOKEN}'}
    assert youtube.video_url('https://www.youtube.com/live/dfVK7ld38Ys?si=oKrpNsv9AjDKYLAK') == 'https://www.youtube.com/watch?v=dfVK7ld38Ys'
    with TestClient(app) as client:
        assert client.get('/api/cameras').status_code == 401
        for url in ('https://youtube.com.evil.test/watch?v=abcdefghijk', 'http://127.0.0.1/private',
                    'rtsp://127.0.0.1:8554/private', 'https://youtube.com/watch?v=invalid'):
            assert client.post('/api/cameras', headers=headers, json={'name': 'Bad', 'url': url}).status_code == 400
        first = client.post('/api/cameras', headers=headers, json={
            'name': 'Entrance', 'url': 'https://youtu.be/abcdefghijk'}).json()
        second = client.post('/api/cameras', headers=headers, json={
            'name': 'Road', 'url': 'https://youtube.com/live/abcdefghijl'}).json()
        assert first['url'] == 'https://www.youtube.com/watch?v=abcdefghijk'
        assert first['health']['state'] == 'stopped'
        assert client.post('/api/cameras', headers=headers, json={
            'name': 'Duplicate', 'url': first['url']}).status_code == 409
        operator = client.post('/api/operators', headers=headers, json={'label': 'Other operator'}).json()
        other = {'Authorization': f"Bearer {operator['key']}"}
        assert client.get('/api/cameras', headers=other).json() == []
        for suffix in ('preview', 'live/frame'):
            assert client.get(f"/api/cameras/{first['id']}/{suffix}", headers=other).status_code == 404
        for suffix in ('start', 'stop', 'remove', 'live/start', 'live/stop'):
            body = {'rule': {'capability': 'zone', 'name': 'Test', 'points': [[.1,.1],[.9,.1],[.9,.9]], 'confirmed': True}}
            assert client.post(f"/api/cameras/{first['id']}/{suffix}", headers=other, json=body).status_code in (404, 409)
        (DATA / 'worker.heartbeat').touch()
        rule = {'capability': 'zone', 'name': 'Entrance watch', 'points': [[.1,.1],[.9,.1],[.9,.9]],
                'confirmed': True, 'recipients': []}
        fake_thread = lambda **kwargs: SimpleNamespace(start=lambda: None, is_alive=lambda: True)
        with patch.object(camera.threading, 'Thread', side_effect=fake_thread):
            started = client.post(f"/api/cameras/{first['id']}/start", headers=headers, json={'rule': rule})
            assert started.status_code == 202, started.text
            started = client.post(f"/api/cameras/{second['id']}/start", headers=headers, json={'rule': rule})
            assert started.status_code == 202, started.text
            assert len(camera._saved) == 2
            assert camera._saved[first['id']]['stop'] is not camera._saved[second['id']]['stop']
            client.post(f"/api/cameras/{first['id']}/stop", headers=headers)
            assert camera._saved[first['id']]['stop'].is_set()
            assert not camera._saved[second['id']]['stop'].is_set()
            assert client.post(f"/api/cameras/{second['id']}/remove", headers=headers).status_code == 409
        camera._saved.clear()
        saved = client.get('/api/cameras', headers=headers).json()
        assert len(saved) == 2 and saved[0]['last_rule']['name'] == 'Entrance watch'
        with patch.object(camera, 'snapshot', return_value=b'\xff\xd8test') as preview:
            assert client.get(f"/api/cameras/{first['id']}/preview", headers=headers).status_code == 200
            assert preview.call_args.kwargs['input_url'] == first['url']
        with patch.object(live_preview, 'start', return_value={'active': True, 'state': 'connecting'}) as start:
            assert client.post(f"/api/cameras/{first['id']}/live/start", headers=headers).status_code == 202
            assert start.call_args.args == (first['id'], first['url'])
        with patch.object(live_preview, 'frame', return_value=(b'\xff\xd8test', 100, 101)):
            frame = client.get(f"/api/cameras/{first['id']}/live/frame", headers=headers)
            assert frame.status_code == 200 and frame.headers['X-Captured-At'] == '100'
        assert client.get(f"/api/cameras/{second['id']}/live/frame", headers=headers).status_code == 503
        print('PASS: URL validation, persistence, ownership, distinct camera stop controls and preview endpoints')

        # Feed synthetic frames through the real bounded recorder and database enqueue.
        stop_event = threading.Event()
        runtime = {'stop': stop_event, 'state': {'state': 'connecting', 'last_clip_at': None, 'owner': 'a'*64}}
        cap = MagicMock()
        cap.isOpened.return_value = True
        cap.read.return_value = (True, np.zeros((320, 320, 3), dtype=np.uint8))
        clock = iter(index*.11 for index in range(1000))
        def committed(connection):
            stop_event.set()
        event.listen(engine, 'commit', committed)
        try:
            with patch.object(camera.youtube, 'resolve', return_value='https://example.googlevideo.com/test'), \
                    patch.object(cv2, 'VideoCapture', return_value=cap), \
                    patch.object(camera, 'clip_seconds', return_value=3), \
                    patch.object(camera.time, 'monotonic', side_effect=lambda: next(clock)):
                camera._capture('a'*64, rule, None, runtime, first['url'], first['id'], 'Entrance')
        finally:
            event.remove(engine, 'commit', committed)
        with Session() as session:
            source = session.scalar(select(Source).where(Source.owner == 'a'*64))
            run = session.scalar(select(Run).where(Run.owner == 'a'*64))
            assert source and run, runtime['state']
            assert source.payload['camera_id'] == first['id'] and 'Entrance' in source.payload['name']
            assert run.payload['camera_id'] == first['id'] and run.payload['rule']['name'] == 'Entrance watch'
        print('PASS: real bounded recording writes camera-tagged source and run')

        # Exercise actual local YOLO inference/annotation on a permitted bundled sample frame.
        cap = cv2.VideoCapture(str(ROOT / 'public' / 'examples' / 'traffic-counting.webm'))
        ok, image = cap.read()
        cap.release()
        assert ok
        preview_runtime = {'stop': threading.Event(), 'state': 'loading', 'requested_at': 0,
                           'raw': None, 'jpeg': None}
        import time
        preview_runtime['requested_at'] = time.monotonic()
        def decode(runtime, url):
            runtime['raw'] = (image, time.time())
        encode = cv2.imencode
        def encoded(*args, **kwargs):
            result = encode(*args, **kwargs)
            preview_runtime['stop'].set()
            return result
        with patch.object(live_preview, '_decode', side_effect=decode), \
                patch.object(live_preview, 'detector_checkpoint', return_value=str(ROOT / 'yolov8n.pt')), \
                patch.object(cv2, 'imencode', side_effect=encoded):
            live_preview._run(preview_runtime, first['url'])
        assert preview_runtime['jpeg'] and preview_runtime['predicted_at'] >= preview_runtime['captured_at']
        assert cv2.imdecode(np.frombuffer(preview_runtime['jpeg'], dtype=np.uint8), cv2.IMREAD_COLOR) is not None
        print('PASS: real local YOLO annotated JPEG;', preview_runtime['detections'], 'object(s) in sample frame')
        fake = {'thread': SimpleNamespace(is_alive=lambda: True), 'stop': threading.Event(),
                'jpeg': b'jpeg', 'captured_at': time.time()-30, 'predicted_at': time.time(),
                'requested_at': time.monotonic(), 'state': 'running'}
        with patch.dict(live_preview._sessions, {'preview-one': fake, 'preview-two': dict(fake)}, clear=True):
            try:
                live_preview.start('third', first['url'])
                raise AssertionError('Preview quota must reject a third active preview')
            except ValueError:
                pass
            try:
                live_preview.frame('preview-one')
                raise AssertionError('Stale decoded frames must not be returned as live')
            except ValueError:
                pass
        for index in range(4):
            assert client.post('/api/cameras', headers=headers, json={
                'name': f'Extra {index}', 'url': f'https://youtu.be/abcdefghij{index}'}).status_code == 201
        assert client.post('/api/cameras', headers=headers, json={
            'name': 'Over quota', 'url': 'https://youtu.be/abcdefghij9'}).status_code == 409
        assert client.post(f"/api/cameras/{first['id']}/remove", headers=headers).status_code == 200
        with Session() as session:
            assert session.get(CameraInput, first['id']) is None
            assert session.scalar(select(Source).where(Source.owner == 'a'*64))
        print('PASS: saved-input quota, preview concurrency cap, stale-frame rejection and retained clips after removal')
    engine.dispose()
