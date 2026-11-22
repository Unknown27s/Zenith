"""Launch the local application after installing dependencies. No public binding."""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
from backend.config import TOKEN_PATH  # noqa: E402
from backend.db import init_db  # noqa: E402

init_db()
children = []


def stop(*_):
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()
    raise SystemExit(0)


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
print(f'Operator key: {TOKEN_PATH} (or your ZENITH_API_KEY environment value). Keep it private.', flush=True)
try:
    for command in ([sys.executable, '-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], [sys.executable, '-m', 'backend.worker'], ['npm', 'run', 'dev']):
        children.append(subprocess.Popen(command))
    print('Open http://127.0.0.1:5173/#settings. Ctrl+C stops the application.', flush=True)
    while all(child.poll() is None for child in children):
        time.sleep(1)
    print('A service stopped; shutting down remaining processes.', flush=True)
finally:
    stop()
