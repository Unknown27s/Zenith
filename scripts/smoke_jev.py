"""Offline integration checks. No real stream, Jev call or Telegram message is sent."""
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
temp_root = Path(os.getenv('LOCALAPPDATA', tempfile.gettempdir())) / 'Temp' / 'opencode'
temp_root.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix='zenith-jev-', dir=temp_root) as directory:
    os.environ.update(ZENITH_DATA=directory, DATABASE_URL=f'sqlite:///{Path(directory).as_posix()}/test.db',
                      ZENITH_API_KEY='offline-test-key-with-at-least-24-characters',
                      VISION_PROVIDER='typesafe', TYPESAFE_API_KEY='offline-test-only',
                      VISION_SEND_TO_THIRD_PARTY='false', TELEGRAM_BOT_TOKEN='',
                      ZENITH_TELEGRAM_CHATS='')
    import cv2
    import httpx
    import numpy as np
    from fastapi.testclient import TestClient
    from backend import camera, config, vision, youtube
    from backend.db import Incident, Notification, Run, Session, VisionReview, engine, init_db
    from backend.main import app
    from backend import main

    def rejected(call):
        try:
            call()
        except (vision.ReviewError, ValueError):
            return
        raise AssertionError('Expected rejection')

    assert not vision.provider_status()['available']
    rejected(lambda: vision.authorization('typesafe', True))
    config.VISION_SEND_TO_THIRD_PARTY = True
    rejected(lambda: vision.authorization('typesafe', False))
    approval = vision.authorization('typesafe', True)
    assert approval['model'] == 'jev-1.14.0'
    with patch.object(httpx, 'get', return_value=httpx.Response(200, json={'models': [{'name': config.TYPESAFE_MODEL}]})):
        assert vision.probe()['model_access']

    frame = np.zeros((100, 700, 3), dtype=np.uint8)
    cv2.imwrite(str(config.DATA / 'evidence' / 'test-during.jpg'), frame)
    event = SimpleNamespace(payload={'frames': ['test-during.jpg'], 'title': 'Possible person down'})
    content = vision.frame_content(event)
    valid = {'model': config.TYPESAFE_MODEL, 'answers': {'evidence': {
        'type': 'choice', 'choice': 'unclear', 'confidence': .8,
        'probabilities': {'visible': .1, 'contradicted': .1, 'unclear': .8}}}}

    def response(body, status=200):
        context = MagicMock()
        context.__enter__.return_value = httpx.Response(status, content=json.dumps(body).encode())
        return context

    with patch.object(httpx, 'stream', return_value=response(valid)) as request:
        result = vision.completion(content, event.payload['title'])
        assert result['decision'] == 'unclear' and result['frame_count'] == 1
        args, kwargs = request.call_args
        assert args[1] == 'https://api.typesafe.ai/v1/systemone'
        assert kwargs['headers']['TypeSafe-Danger-Zone-Images'] == 'true'
        body = kwargs['json']
        assert body['state']['candidate'] == 'Possible person down'
        assert body['questions']['evidence']['type'] == 'choice'
        for asset in body['assets'].values():
            decoded = cv2.imdecode(np.frombuffer(base64.b64decode(asset['data_base64']), dtype=np.uint8), cv2.IMREAD_COLOR)
            assert min(decoded.shape[:2]) >= 280 and max(decoded.shape[:2]) <= 1568

    for invalid in ({}, {**valid, 'answers': {'evidence': {**valid['answers']['evidence'], 'confidence': True}}},
                    {**valid, 'answers': {'evidence': {**valid['answers']['evidence'], 'choice': 'confirmed'}}},
                    {**valid, 'answers': {'evidence': {**valid['answers']['evidence'], 'probabilities': {'visible': 1}}}}):
        with patch.object(httpx, 'stream', return_value=response(invalid)):
            rejected(lambda: vision.completion(content))
    with patch.object(httpx, 'stream', return_value=response({}, 503)):
        rejected(lambda: vision.completion(content))
    with patch.object(httpx, 'stream', side_effect=httpx.ReadTimeout('offline')):
        rejected(lambda: vision.completion(content))

    init_db()
    with Session() as session:
        session.add(Run(id='run', owner='test', status='completed', payload={}))
        session.add(Incident(id='event', run_id='run', owner='test', payload=event.payload))
        session.add(VisionReview(id='event', run_id='run', owner='test', payload=approval))
        session.add(Notification(id='notice', owner='test', status='pending', payload={'incident_id': 'event'}))
        session.commit()
    with patch.object(httpx, 'stream', return_value=response({}, 503)):
        vision.process_one_review()
    with Session() as session:
        assert session.get(VisionReview, 'event').status == 'failed'
        assert session.get(Notification, 'notice').status == 'pending'
        assert session.get(Incident, 'event')
        review = session.get(VisionReview, 'event')
        review.status = 'queued'
        session.commit()
    with patch.object(httpx, 'stream', return_value=response(valid)):
        vision.process_one_review()
    with Session() as session:
        view = vision.review_view(session.get(VisionReview, 'event'))
        assert view['status'] == 'completed' and view['decision'] == 'unclear'
        assert session.get(Notification, 'notice').status == 'pending'

    canonical = 'https://www.youtube.com/watch?v=abcdefghijk'
    for url in (canonical, 'https://youtu.be/abcdefghijk', 'https://youtube.com/live/abcdefghijk'):
        assert youtube.video_url(url) == canonical
    for url in ('https://youtube.com.evil.test/watch?v=abcdefghijk',
                'http://youtube.com/watch?v=abcdefghijk', 'https://user@youtube.com/watch?v=abcdefghijk',
                'https://youtube.com/watch?v=invalid', 'https://127.0.0.1/live/abcdefghijk'):
        assert youtube.video_url(url) is None
    with patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps({
            'is_live': True, 'url': 'https://example.googlevideo.com/live.m3u8?secret=signed'}))) as resolver:
        assert youtube.resolve(canonical).startswith('https://example.googlevideo.com/')
        assert '--ignore-config' in resolver.call_args.args[0]
    for info in ({'is_live': False}, {'is_live': True, 'url': 'http://127.0.0.1/private'},
                 {'is_live': True, 'url': 'https://googlevideo.com.evil.test/private'}):
        with patch.object(subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(info))):
            rejected(lambda: youtube.resolve(canonical, use_cache=False))
    with patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired('secret', 30)):
        rejected(lambda: youtube.resolve(canonical, use_cache=False))
    with patch.dict(os.environ, {'ZENITH_YOUTUBE_URL': canonical}):
        assert camera.configured() and camera.status()['protocol'] == 'YouTube'

    # API carries explicit stream-session approval to bounded capture.
    with TestClient(app) as client:
        (config.DATA / 'worker.heartbeat').touch()
        headers = {'Authorization': f'Bearer {config.TOKEN}'}
        assert client.get('/api/notifications/status').status_code == 401
        with patch.object(main, 'TELEGRAM_BOT_TOKEN', 'private-test-token'), \
                patch.object(main, 'TELEGRAM_CHAT_IDS', ['123']), \
                patch.object(main, 'telegram_probe', return_value=(True, 'Bot @test reachable')), \
                patch.object(main, 'telegram_send') as send:
            check = client.get('/api/notifications/status', headers=headers)
            assert check.status_code == 200 and check.json()['reachable'] is True
            assert 'private-test-token' not in check.text
            send.assert_not_called()
            issued = client.post('/api/operators', headers=headers, json={'label': 'Health test operator'})
            assert issued.status_code == 201
            operator = {'Authorization': f"Bearer {issued.json()['key']}"}
            assert client.get('/api/notifications/status', headers=operator).status_code == 403
        payload = {'rule': {'capability': 'zone', 'name': 'Test zone',
                           'points': [[.1,.1], [.9,.1], [.9,.9]], 'confirmed': True},
                   'vision_provider': 'typesafe', 'vision_consent': False}
        with patch.object(camera, 'start', return_value={'state': 'connecting'}) as start:
            assert client.post('/api/cameras/rtsp/start', headers=headers, json=payload).status_code == 409
            start.assert_not_called()
            payload['vision_consent'] = True
            assert client.post('/api/cameras/rtsp/start', headers=headers, json=payload).status_code == 202
            assert start.call_args.args[2]['provider'] == 'typesafe'
    engine.dispose()
    print('PASS: Jev request/typed validation, image limits, consent, model probe, persisted review,')
    print('alert independence, YouTube validation/resolution/timeouts and stream API approval.')
