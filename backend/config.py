import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
DATA = Path(os.getenv('ZENITH_DATA', 'data')).resolve()
DATA.mkdir(parents=True, exist_ok=True)
for folder in ('sources', 'evidence'):
    (DATA / folder).mkdir(exist_ok=True)
TOKEN_PATH = DATA / 'operator.key'
TOKEN = os.getenv('ZENITH_API_KEY', '')
if not TOKEN:
    try:
        fd = os.open(TOKEN_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, 'w') as stream:
            stream.write(secrets.token_urlsafe(32))
    TOKEN = TOKEN_PATH.read_text().strip()
if len(TOKEN) < 24:
    raise RuntimeError('ZENITH_API_KEY must contain at least 24 characters')
DATABASE_URL = os.getenv('DATABASE_URL', f'sqlite:///{DATA / "zenith.db"}')
RECIPIENTS = [x.strip() for x in os.getenv('ZENITH_RECIPIENTS', '').split(',') if x.strip()]
MAX_UPLOAD = int(os.getenv('MAX_UPLOAD_MB', '100')) * 1024 * 1024
MAX_DURATION = int(os.getenv('MAX_VIDEO_SECONDS', '180'))

VISION_PROVIDER = os.getenv('VISION_PROVIDER', 'off').strip().lower()
NVIDIA_API_KEY = os.getenv('NVIDIA_API_KEY', '').strip()
NVIDIA_VISION_MODEL = os.getenv('NVIDIA_VISION_MODEL', 'nvidia/nemotron-nano-12b-v2-vl').strip()
LOCAL_VLM_BASE_URL = os.getenv('LOCAL_VLM_BASE_URL', 'http://127.0.0.1:11434/v1').strip().rstrip('/')
LOCAL_VLM_MODEL = os.getenv('LOCAL_VLM_MODEL', 'qwen2.5vl:3b').strip()
LOCAL_VLM_API_KEY = os.getenv('LOCAL_VLM_API_KEY', '').strip()
VISION_SEND_TO_THIRD_PARTY = os.getenv('VISION_SEND_TO_THIRD_PARTY', 'false').lower() == 'true'
VISION_TIMEOUT = int(os.getenv('VISION_TIMEOUT', '30'))
VISION_MAX_FRAMES = int(os.getenv('VISION_MAX_FRAMES', '1'))
VISION_AUTO_LIMIT = 3
