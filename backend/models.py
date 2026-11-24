"""Model configuration shared by the API and analysis worker."""
import os
from pathlib import Path

from .config import DATA

ACTION_UPLOAD = DATA / 'models' / 'zenith_cctv_action.pt'


def detector_checkpoint(capability):
    if capability == 'action':
        return os.getenv('ZENITH_POSE_MODEL') or 'yolo11n-pose.pt'
    if capability == 'traffic':
        return os.getenv('ZENITH_TRAFFIC_MODEL') or os.getenv('ZENITH_MODEL') or 'yolo26n.pt'
    return os.getenv('ZENITH_MODEL') or 'yolo26n.pt'


def action_checkpoint():
    configured = os.getenv('ZENITH_ACTION_MODEL')
    return Path(configured).expanduser() if configured else ACTION_UPLOAD


def model_status():
    checkpoint = action_checkpoint()
    return {
        'traffic': {'detector': Path(detector_checkpoint('traffic')).name, 'tracker': 'ByteTrack'},
        'action': {'detector': Path(detector_checkpoint('action')).name, 'classifier': checkpoint.name,
                   'checkpoint_present': checkpoint.is_file(),
                   'upload_enabled': not os.getenv('ZENITH_ACTION_MODEL')},
    }
