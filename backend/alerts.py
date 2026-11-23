"""Outbound alert channels.

The bot token and chat allowlist stay on the backend; nothing here is exposed to the browser.
Kept free of OpenCV/ML imports so the API process can send a test alert without video dependencies.
"""
import httpx

from .config import TELEGRAM_BOT_TOKEN


def telegram_send(chat_id, text):
    """Send one Telegram message. Returns (delivered, retryable, detail) without exposing secrets."""
    try:
        response = httpx.post(f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage',
                              json={'chat_id': chat_id, 'text': text[:4096], 'disable_web_page_preview': True},
                              timeout=15)
    except httpx.HTTPError:
        return False, True, 'Telegram could not be reached'
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.is_success and body.get('ok') is True:
        return True, False, 'Telegram accepted the message; delivery not verified'
    if response.status_code == 429 or response.status_code >= 500:
        return False, True, f'Telegram temporarily unavailable ({response.status_code}); retrying'
    detail = body.get('description') if isinstance(body, dict) else None
    # Permanent rejections: bot blocked, chat missing, or malformed request.
    return False, False, str(detail or f'Telegram rejected the message ({response.status_code})')[:200]


def telegram_send_photo(chat_id, image_path, caption):
    """Send an evidence frame as a photo. Returns (delivered, retryable, detail)."""
    try:
        image = image_path.read_bytes()
    except OSError:
        return False, False, 'Evidence image could not be read'
    try:
        response = httpx.post(f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto',
                              data={'chat_id': chat_id, 'caption': caption[:1024]},
                              files={'photo': (image_path.name, image, 'image/jpeg')},
                              timeout=30)
    except httpx.HTTPError:
        return False, True, 'Telegram could not be reached'
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.is_success and body.get('ok') is True:
        return True, False, 'Telegram accepted the evidence photo; delivery not verified'
    if response.status_code == 429 or response.status_code >= 500:
        return False, True, f'Telegram temporarily unavailable ({response.status_code}); retrying'
    detail = body.get('description') if isinstance(body, dict) else None
    return False, False, str(detail or f'Telegram rejected the photo ({response.status_code})')[:200]


def telegram_probe():
    """Check the bot token without messaging anyone. Returns (ok, detail)."""
    try:
        response = httpx.get(f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getMe', timeout=10)
    except httpx.HTTPError:
        return False, 'Telegram could not be reached'
    try:
        body = response.json()
    except ValueError:
        return False, 'Telegram returned an unreadable response'
    if response.is_success and body.get('ok') is True:
        username = (body.get('result') or {}).get('username')
        return True, f'Bot @{username} reachable' if username else 'Bot reachable'
    return False, f'Bot token rejected ({response.status_code})'
