"""Isolated real-clip API + worker smoke test. Does not touch the configured database."""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
temp_root = Path(os.getenv('ZENITH_TEST_TEMP', str(Path(tempfile.gettempdir()) / 'opencode')))
temp_root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='zenith-smoke-', dir=temp_root) as directory:
    os.environ['ZENITH_DATA'] = directory
    os.environ['DATABASE_URL'] = f"sqlite:///{(Path(directory) / 'test.db').as_posix()}"
    os.environ['VISION_PROVIDER'] = 'off'
    os.environ['ZENITH_TRAFFIC_MODEL'] = str(ROOT / 'yolo11n.pt')
    from fastapi.testclient import TestClient
    from backend.config import TOKEN
    from backend.db import engine
    from backend.main import app
    from backend.worker import analyze, claim

    headers = {'Authorization': f'Bearer {TOKEN}'}
    with TestClient(app) as client:
        source_response = client.post('/api/sources/sample/traffic-counting', headers=headers)
        source_response.raise_for_status()
        source = source_response.json()
        assert source['duration'] > 0 and source['width'] > 0
        queued = client.post('/api/runs', headers=headers, json={
            'source_id': source['id'], 'rule': {
                'capability': 'traffic', 'name': 'Smoke test · traffic', 'confirmed': True,
                'points': [[.18, .68], [.53, .68], [.03, .86], [.45, .86]],
                'segment_metres': 50, 'analysis_fps': 6, 'confidence': .25}})
        queued.raise_for_status()
        run_id = queued.json()['id']
        claimed = claim()
        assert claimed and claimed[0] == run_id
        analyze(*claimed)
        run_response = client.get(f'/api/runs/{run_id}', headers=headers)
        run_response.raise_for_status()
        run = run_response.json()
        events_response = client.get(f'/api/runs/{run_id}/events', headers=headers)
        events_response.raise_for_status()
        assert run['status'] == 'completed' and run['findings']['summary']
        assert run.get('crossings'), run
        track_id = run['crossings'][0]['track_id']
        reviewed = client.post(f'/api/runs/{run_id}/crossings/{track_id}/review', headers=headers,
                               json={'action':'false_positive','note':'Smoke test annotation, not a real correction'})
        assert reviewed.status_code == 200, reviewed.text
        after = client.get(f'/api/runs/{run_id}', headers=headers).json()
        assert after['counts'] == run['counts'] and after['crossing_reviews'][str(track_id)]['action'] == 'false_positive'
        vehicle_class = run['crossings'][0]['vehicle_class']
        estimate = client.post('/api/carbon/preview', headers=headers, json={
            'name':'Test traffic', 'kind':'traffic', 'quantity':0, 'run_id':run_id,
            'vehicle_class':vehicle_class, 'distance_km':1, 'factor':100,
            'factor_source':'Synthetic test factor; not for real estimates', 'basis':'Smoke test only'})
        assert estimate.status_code == 200, estimate.text
        values = estimate.json()
        assert values['quantity'] == run['counts'][vehicle_class] - 1
        assert values['distance_km'] == .05
        assert abs(values['kg'] - values['quantity'] * .005) < 1e-9
        pdf = client.get(f'/api/reports/pdf?run_id={run_id}', headers=headers)
        assert pdf.status_code == 200 and pdf.content.startswith(b'%PDF'), pdf.text[:200]
        csv = client.get(f'/api/reports/csv?run_id={run_id}', headers=headers)
        assert csv.status_code == 200 and 'Run summary:' in csv.text
        print('Result:', {'status': run['status'], 'source_seconds': run['source_seconds'],
                          'counts': run['counts'], 'crossings': len(run.get('crossings', [])),
                          'summary': run['findings']['summary'], 'events': len(events_response.json()),
                          'per_run_reports': 'PDF+CSV OK'})
    engine.dispose()
