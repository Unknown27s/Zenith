import os
import re
import secrets
from pathlib import Path
from urllib.parse import quote, unquote

from dotenv import load_dotenv

load_dotenv()


def normalize_database_url(url: str) -> str:
    """Percent-encode a raw password so a literal @ or : does not corrupt the host.

    Passwords copied from a dashboard are often not URL-encoded. SQLAlchemy splits
    userinfo at the first @, which turns part of the password into the hostname.
    """
    if '://' not in url or '@' not in url:
        return url
    scheme, rest = url.split('://', 1)
    userinfo, hostpath = rest.rsplit('@', 1)
    if ':' not in userinfo:
        return url
    user, password = userinfo.split(':', 1)
    if re.search(r'%[0-9A-Fa-f]{2}', password) and unquote(password) != password:
        return url  # already encoded
    return f'{scheme}://{user}:{quote(password, safe="")}@{hostpath}'
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
DATABASE_URL = normalize_database_url(os.getenv('DATABASE_URL', f'sqlite:///{DATA / "zenith.db"}'))
RECIPIENTS = [x.strip() for x in os.getenv('ZENITH_RECIPIENTS', '').split(',') if x.strip()]
# Telegram alerts are server-side only. The bot token must never reach the browser.
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
TELEGRAM_CHAT_IDS = [x.strip() for x in os.getenv('ZENITH_TELEGRAM_CHATS', '').split(',') if x.strip()]
if TELEGRAM_BOT_TOKEN and not re.fullmatch(r'\d{5,20}:[A-Za-z0-9_-]{30,60}', TELEGRAM_BOT_TOKEN):
    raise RuntimeError('TELEGRAM_BOT_TOKEN is malformed; copy it exactly from @BotFather')
if any(not re.fullmatch(r'-?\d{1,20}', chat) for chat in TELEGRAM_CHAT_IDS):
    raise RuntimeError('ZENITH_TELEGRAM_CHATS must be numeric chat IDs, comma-separated')
if TELEGRAM_CHAT_IDS and not TELEGRAM_BOT_TOKEN:
    raise RuntimeError('ZENITH_TELEGRAM_CHATS is set but TELEGRAM_BOT_TOKEN is missing')
# A rule may only notify an allowlisted address or chat; the browser cannot add recipients.
ALL_RECIPIENTS = [*RECIPIENTS, *(f'telegram:{chat}' for chat in TELEGRAM_CHAT_IDS)]
# Evidence frames leave this machine only when explicitly enabled.
TELEGRAM_SEND_EVIDENCE = os.getenv('TELEGRAM_SEND_EVIDENCE', 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
MAX_UPLOAD = int(os.getenv('MAX_UPLOAD_MB', '100')) * 1024 * 1024
MAX_DURATION = int(os.getenv('MAX_VIDEO_SECONDS', '180'))
try:
    CLIP_SECONDS = float(os.getenv('ZENITH_CAMERA_CLIP_SECONDS', '5').strip() or 5)
except ValueError as error:
    raise RuntimeError('ZENITH_CAMERA_CLIP_SECONDS must be a number of seconds') from error
# Shorter clips reduce alert delay, but never below a useful minimum.
CLIP_SECONDS = max(2.0, min(float(MAX_DURATION), CLIP_SECONDS))
STORAGE_LIMIT = int(os.getenv('ZENITH_STORAGE_LIMIT_MB', '500')) * 1024 * 1024

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


def telegram_chat(recipient: str) -> str | None:
    """Return the allowlisted chat ID for a Telegram recipient, else None."""
    prefix = 'telegram:'
    if not recipient.startswith(prefix):
        return None
    chat = recipient[len(prefix):]
    return chat if chat in TELEGRAM_CHAT_IDS else None
