"""Online prerecorded HLS demo -> bounded clip -> worker -> per-video report.

Not a physical camera test. Uses public Big Buck Bunny sample hosted by Mux.
"""
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
temp_root = Path(os.getenv('ZENITH_TEST_TEMP', str(Path(tempfile.gettempdir()) / 'opencode')))
temp_root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='zenith-stream-', dir=temp_root) as folder:
    os.environ['ZENITH_DATA'] = folder
    os.environ['DATABASE_URL'] = f"sqlite:///{(Path(folder) / 'test.db').as_posix()}"
    os.environ['ZENITH_YOUTUBE_URL'] = ''
    os.environ['ZENITH_RTSP_URL'] = ''
    os.environ['ZENITH_CAMERA_URL'] = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
    os.environ['VISION_PROVIDER'] = 'off'
    from fastapi.testclient import TestClient
    from backend.config import DATA, TOKEN
    from backend.db import engine
    from backend.main import app
    from backend.worker import analyze, claim

    headers = {'Authorization': f'Bearer {TOKEN}'}
    with TestClient(app) as client:
        (DATA / 'worker.heartbeat').touch()
        preview = client.get('/api/cameras/rtsp/preview', headers=headers)
        assert preview.status_code == 200 and preview.content.startswith(b'\xff\xd8'), preview.text[:200]
        started = client.post('/api/cameras/rtsp/start', headers=headers, json={
            'rule':{'capability':'machine_activity', 'name':'Online stream ingestion test',
                    'points':[[.05,.05],[.95,.05],[.95,.95],[.05,.95]], 'confirmed':True}})
        assert started.status_code == 202, started.text
        source = None
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                sources = client.get('/api/sources', headers=headers).json()
                if sources:
                    source = sources[0]
                    break
                state = client.get('/api/status', headers=headers).json()['camera']['state']
                if state in ('capture failed', 'storage or source limit reached; archive clips before restarting'):
                    raise RuntimeError(f'Stream stopped early: {state}')
                time.sleep(1)
        finally:
            client.post('/api/cameras/rtsp/stop', headers=headers)
        assert source, 'Online stream did not produce a bounded clip'
        job = claim()
        assert job
        analyze(*job)
        run = client.get(f'/api/runs/{job[0]}', headers=headers).json()
        pdf = client.get(f"/api/reports/pdf?run_id={job[0]}", headers=headers)
        assert run['status'] == 'completed' and run['findings']['summary'] and pdf.content.startswith(b'%PDF')
        print('Online HLS stream (prerecorded demo):', {'clip_seconds':source['duration'],
              'run_status':run['status'], 'summary':run['findings']['summary'], 'pdf':'OK'})
    engine.dispose()
