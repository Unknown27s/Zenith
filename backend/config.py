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
MAX_UPLOAD = int(os.getenv('MAX_UPLOAD_MB', '100')) * 1024 * 1024
MAX_DURATION = int(os.getenv('MAX_VIDEO_SECONDS', '180'))
