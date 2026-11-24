"""Offline regression check for the YouTube URL API and application status."""
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
temp_root = Path(os.environ['LOCALAPPDATA']) / 'Temp' / 'opencode'
with tempfile.TemporaryDirectory(prefix='zenith-status-', dir=temp_root) as directory:
    os.environ.update(
        ZENITH_DATA=directory,
        DATABASE_URL=f'sqlite:///{Path(directory).as_posix()}/test.db',
        ZENITH_API_KEY='offline-status-test-key-at-least-24-characters',
        TELEGRAM_BOT_TOKEN='',
        ZENITH_TELEGRAM_CHATS='',
        ZENITH_ALLOW_LOCAL_SESSION='1',
    )
    from fastapi.testclient import TestClient
    from backend import youtube
    from backend.config import TOKEN
    from backend.db import engine
    from backend.main import app
    from backend import main

    url = 'https://www.youtube.com/watch?v=dfVK7ld38Ys'
    assert youtube.video_url('https://youtu.be/dfVK7ld38Ys') == url
    assert youtube.video_url(url) == youtube.canonical_video_url(url)
    for value in (None, 'http://127.0.0.1/private',
                  'https://youtube.com.evil.test/watch?v=dfVK7ld38Ys'):
        assert youtube.video_url(value) is None
    with TestClient(app) as client:
        response = client.get('/api/status', headers={'Authorization': f'Bearer {TOKEN}'})
        assert response.status_code == 200, response.text
        assert client.get('/api/health').status_code == 200
        assert client.get('/api/notifications/status').status_code == 401
    with TestClient(app, base_url='http://127.0.0.1',
                    client=('127.0.0.1', 50000)) as client:
        response = client.post('/api/local-session', headers={'Origin': 'http://127.0.0.1'})
        assert response.status_code == 200, response.text
        with patch.object(main, 'TELEGRAM_BOT_TOKEN', 'offline-token'), \
                patch.object(main, 'TELEGRAM_CHAT_IDS', ['123']), \
                patch.object(main, 'telegram_probe', return_value=(True, 'Mock bot reachable')), \
                patch.object(main, 'telegram_send', return_value=(True, False, 'Mock accepted')) as send:
            assert client.get('/api/notifications/status').status_code == 200
            assert client.post('/api/notifications/test').status_code == 200
            send.assert_called_once()
        # Local convenience does not grant operator-management access.
        assert client.get('/api/operators').status_code == 403
        app.dependency_overrides[main.owner] = lambda: 'other-workspace'
        try:
            assert client.get('/api/notifications/status').status_code == 403
            assert client.post('/api/notifications/test').status_code == 403
        finally:
            app.dependency_overrides.clear()
    engine.dispose()
    print('PASS: YouTube compatibility, URL validation, /api/status and /api/health')
    print('PASS: local Telegram tests without key entry; unauthenticated and other workspaces denied')
