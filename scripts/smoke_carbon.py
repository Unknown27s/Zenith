"""Offline regression check for published carbon reference factors."""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
temp_root = Path(os.getenv('LOCALAPPDATA', tempfile.gettempdir())) / 'Temp' / 'opencode'
with tempfile.TemporaryDirectory(prefix='zenith-carbon-', dir=temp_root) as directory:
    os.environ.update(
        ZENITH_DATA=directory,
        DATABASE_URL=f'sqlite:///{Path(directory).as_posix()}/test.db',
        ZENITH_API_KEY='offline-carbon-test-key-at-least-24-characters',
        TELEGRAM_BOT_TOKEN='',
        ZENITH_TELEGRAM_CHATS='',
    )
    from fastapi.testclient import TestClient
    from backend.config import TOKEN
    from backend.db import engine
    from backend.main import app

    headers = {'Authorization': f'Bearer {TOKEN}'}
    with TestClient(app) as client:
        assert client.get('/api/carbon/presets').status_code == 401
        presets = client.get('/api/carbon/presets', headers=headers)
        assert presets.status_code == 200, presets.text
        rows = presets.json()
        assert len(rows) >= 10
        assert len({row['id'] for row in rows}) == len(rows)
        assert {row['kind'] for row in rows} == {'electricity', 'fuel', 'traffic'}
        classes = set()
        for row in rows:
            assert row['source'].strip() and row['region'].strip() and row['note'].strip()
            assert 1900 <= row['year'] <= 2100
            assert 0 < row['factor'] <= 1e9
            if row['kind'] == 'traffic':
                assert row['vehicle_class'] in {'car', 'motorcycle', 'bus', 'truck'}
                classes.add(row['vehicle_class'])
            else:
                assert row['vehicle_class'] is None
        assert classes == {'car', 'motorcycle', 'bus', 'truck'}

        def preview(kind, row, **overrides):
            body = {
                'name': f'{kind} reference check',
                'kind': kind,
                'quantity': 10,
                'factor': row['factor'],
                'factor_source': f"{row['source']} · {row['region']} · {row['year']}",
                'basis': 'Regression check for a published reference factor.',
                **overrides,
            }
            response = client.post('/api/carbon/preview', headers=headers, json=body)
            assert response.status_code == 200, response.text
            return response.json()

        electricity = next(row for row in rows if row['id'] == 'electricity-india-cea-2023')
        result = preview('electricity', electricity, quantity=10, hours=2, load_fraction=0.5)
        assert abs(result['kg'] - 10 * 2 * 0.5 * electricity['factor']) < 1e-9
        assert result['label'] == 'CO2e estimate'
        assert electricity['source'] in result['factor_source']

        fuel = next(row for row in rows if row['id'] == 'fuel-diesel-ipcc-2006')
        result = preview('fuel', fuel, quantity=10)
        assert abs(result['kg'] - 10 * fuel['factor']) < 1e-9
        assert result['label'] == 'CO2e estimate'

        car = next(row for row in rows if row['id'] == 'traffic-car-defra-2023')
        result = preview('traffic', car, quantity=100, distance_km=1, vehicle_class='car')
        assert abs(result['kg'] - 100 * 1 * car['factor'] / 1000) < 1e-9
        assert result['label'] == 'CO2 estimate'

        # A reference ID is not a saved factor and must never be sent as factor_id.
        body = {
            'name': 'preset id misuse',
            'kind': 'electricity',
            'quantity': 1,
            'factor': electricity['factor'],
            'factor_source': electricity['source'],
            'factor_id': electricity['id'],
            'basis': 'Reference IDs are not saved-factor IDs.',
        }
        rejected = client.post('/api/carbon/preview', headers=headers, json=body)
        assert rejected.status_code == 404, rejected.text
    engine.dispose()
    print('PASS: carbon presets require auth and keep source, region, year and class')
    print('PASS: electricity, fuel and traffic preview math uses the published value')
    print('PASS: reference preset IDs are rejected as saved factor IDs')
