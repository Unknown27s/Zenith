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
