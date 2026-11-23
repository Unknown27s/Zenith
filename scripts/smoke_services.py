"""Isolated local-access, factor, readiness and backup smoke test."""
import os
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
temp_root = Path(os.getenv('ZENITH_TEST_TEMP', str(Path(tempfile.gettempdir()) / 'opencode')))
temp_root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='zenith-services-', dir=temp_root) as directory:
    path = Path(directory)
    os.environ['ZENITH_DATA'] = directory
    os.environ['DATABASE_URL'] = f'sqlite:///{(path / "test.db").as_posix()}'
    os.environ['VISION_PROVIDER'] = 'off'
    from fastapi.testclient import TestClient
    from backend.config import TOKEN
    from backend.db import engine
    from backend.main import app
    import cv2

    admin = {'Authorization': f'Bearer {TOKEN}'}
    with TestClient(app) as client:
        assert client.get('/api/ready').status_code == 200
        real_capture = cv2.VideoCapture(str(ROOT / 'public' / 'examples' / 'traffic-counting.webm'))
        with patch.dict(os.environ, {'ZENITH_RTSP_URL':'rtsp://127.0.0.1:8554/test', 'ZENITH_YOUTUBE_URL':'', 'ZENITH_CAMERA_URL':''}), \
                patch.object(cv2, 'VideoCapture', return_value=real_capture):
            preview = client.get('/api/cameras/rtsp/preview', headers=admin)
            assert preview.status_code == 200 and preview.content.startswith(b'\xff\xd8')
        real_capture.release()
        print('Authenticated RTSP preview with a local video stand-in: OK')
        created = client.post('/api/operators', headers=admin, json={'label':'Test operator'})
        assert created.status_code == 201, created.text
        operator = {'Authorization': f"Bearer {created.json()['key']}"}
        assert client.get('/api/status', headers=operator).json()['is_admin'] is False
        assert client.get('/api/operators', headers=operator).status_code == 403
        factor = client.post('/api/carbon/factors', headers=operator, json={
            'name':'Test grid', 'kind':'electricity', 'factor':0.5,
            'source':'Test source; not a real emission factor', 'region':'Test site',
            'year':2025})
        assert factor.status_code == 201, factor.text
        assert not client.get('/api/carbon/factors', headers=admin).json()
        calculated = client.post('/api/carbon/preview', headers=operator, json={
            'name':'Test reading', 'kind':'electricity', 'quantity':1, 'metered_kwh':2,
            'factor':999, 'factor_id':factor.json()['id'],
            'factor_source':'Untrusted browser value', 'basis':'Test meter interval'})
        assert calculated.status_code == 200 and calculated.json()['kg'] == 1.0, calculated.text
        assert client.post(f"/api/operators/{created.json()['id']}/revoke", headers=admin).status_code == 200
        assert client.get('/api/status', headers=operator).status_code == 401
        print('Access isolation, revocation, saved-factor authority, and readiness: OK')
    engine.dispose()
    output = temp_root / f'{path.name}.zip'
    try:
        result = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'backup_local.py'), str(output)],
                                env=os.environ.copy(), capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        with zipfile.ZipFile(output) as archive:
            assert 'zenith-backup/database.sqlite' in archive.namelist()
            assert archive.testzip() is None
            restored = path / 'restored.sqlite'
            restored.write_bytes(archive.read('zenith-backup/database.sqlite'))
        with closing(sqlite3.connect(restored)) as snapshot:
            assert snapshot.execute('select count(*) from operator_keys').fetchone()[0] == 1
            assert snapshot.execute('select count(*) from emission_factors').fetchone()[0] == 1
        print('Offline SQLite backup/restore integrity: OK')
    finally:
        output.unlink(missing_ok=True)
