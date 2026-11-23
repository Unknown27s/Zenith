"""Deterministic tracking regressions; isolated SQLite, synthetic frames, no model/API calls."""
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    temp_root = Path(os.getenv('ZENITH_TEST_TEMP', str(Path(tempfile.gettempdir()) / 'opencode')))
    temp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='zenith-tracking-', dir=temp_root) as directory:
        with patch.dict(os.environ, {'ZENITH_DATA': directory, 'DATABASE_URL': f'sqlite:///{directory}/test.db',
                                     'VISION_PROVIDER': 'off'}):
            import cv2
            import numpy as np
            import torch
            from backend import worker
            from backend.db import Incident, Run, Session, Source, engine, init_db
            from sqlalchemy import select

            init_db()
            assert worker.detection_classes({'capability': 'zone'}, {7: 'person', 0: 'helmet'}) == [7]
            assert worker.detection_classes({'capability': 'traffic', 'vehicle_classes': ['truck', 'car']},
                                            {0: 'truck', 1: 'car'}) == [0, 1]
            try:
                worker.detection_classes({'capability': 'zone'}, {0: 'helmet'})
            except ValueError as error:
                assert 'person' in str(error)
            else:
                raise AssertionError('Unsupported checkpoint silently accepted')

            class Capture:
                def __init__(self, times):
                    self.times, self.index = times, 0

                def read(self):
                    if self.index == len(self.times):
                        return False, None
                    self.index += 1
                    return True, np.zeros((100, 100, 3), dtype=np.uint8)

                def get(self, prop):
                    assert prop == cv2.CAP_PROP_POS_MSEC
                    return self.times[self.index - 1] * 1000

                def release(self):
                    pass

            class Detector:
                names = {7: 'person'}

                def track(self, frame, **kwargs):
                    assert kwargs['classes'] == [7]
                    boxes = SimpleNamespace(xyxy=torch.tensor([[40., 20., 60., 70.]]),
                                            id=torch.tensor([1]), cls=torch.tensor([7]))
                    return [SimpleNamespace(boxes=boxes, names=self.names)]

            for label, times, expected in [('continuous', [0, .25, .5, .75], 1),
                                            ('timestamp gap', [0, .25, 3, 3.25], 0)]:
                with Session() as session:
                    source = Source(owner='test', payload={'file': 'synthetic.mp4', 'fps': 4,
                                                          'duration': times[-1] + .25})
                    session.add(source)
                    session.flush()
                    run = Run(owner='test', payload={'source_id': source.id, 'source_name': label, 'rule': {
                        'capability': 'zone', 'name': label, 'points': [[0, 0], [1, 0], [1, 1], [0, 1]],
                        'dwell_seconds': .5, 'analysis_fps': 4}})
                    session.add(run)
                    session.commit()
                    run_id = run.id
                job = worker.claim()
                assert job and job[0] == run_id
                with patch.object(worker.cv2, 'VideoCapture', return_value=Capture(times)), \
                     patch('ultralytics.YOLO', return_value=Detector()):
                    worker.analyze(*job)
                with Session() as session:
                    events = list(session.scalars(select(Incident).where(Incident.run_id == run_id)))
                    saved = session.get(Run, run_id)
                    assert saved.status == 'completed'
                    assert len(events) == expected, (label, len(events), expected)
                    if expected == 0:
                        assert saved.payload['coverage'] == 'partial: source frame gaps'
                print(f'PASS: {label} → {expected} dwell incident(s)')
            engine.dispose()
            print('PASS: custom class IDs and missing-label rejection')


if __name__ == '__main__':
    main()
