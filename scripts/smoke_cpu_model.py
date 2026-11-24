"""Exercise the configured local detector on bundled footage, using CPU only."""
import os
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    import cv2
    from ultralytics import YOLO
    from backend.models import detector_checkpoint
    from backend.worker import detection_classes

    # Defaults are tested independently of any operator checkpoint overrides.
    with patch.dict(os.environ):
        os.environ.pop('ZENITH_MODEL', None)
        os.environ.pop('ZENITH_TRAFFIC_MODEL', None)
        assert detector_checkpoint('zone') == 'yolo26n.pt'
        assert detector_checkpoint('traffic') == 'yolo26n.pt'
        os.environ['ZENITH_MODEL'] = 'custom.pt'
        assert detector_checkpoint('zone') == 'custom.pt'
        assert detector_checkpoint('traffic') == 'custom.pt'
        os.environ['ZENITH_TRAFFIC_MODEL'] = 'traffic.pt'
        assert detector_checkpoint('traffic') == 'traffic.pt'

    model = YOLO(detector_checkpoint('zone'))
    assert model.task == 'detect'
    capture = cv2.VideoCapture(str(ROOT / 'public/examples/traffic-counting.webm'))
    try:
        ok, frame = capture.read()
        assert ok, 'Cannot decode bundled traffic sample'
    finally:
        capture.release()
    # Match live preview: no class filter, all checkpoint categories available.
    result = model.predict(frame, device='cpu', conf=.3, imgsz=416, verbose=False)[0]
    assert result.plot().shape == frame.shape
    assert str(next(model.model.parameters()).device) == 'cpu'
    print(f'PASS: {detector_checkpoint("zone")} CPU preview; {len(model.names)} categories; '
          f'{len(result.boxes)} detections; inference {result.speed["inference"]:.1f} ms (single frame)')
    classes = detection_classes({'capability': 'traffic'}, model.names)
    for _ in range(2):
        result = model.track(frame, persist=True, tracker='bytetrack.yaml',
                             classes=classes, device='cpu', conf=.3, imgsz=640, verbose=False)[0]
    assert result.boxes.id is not None, 'Expected tracks on bundled traffic sample'
    print(f'PASS: CPU ByteTrack; {len(result.boxes)} tracked vehicles')


if __name__ == '__main__':
    main()
