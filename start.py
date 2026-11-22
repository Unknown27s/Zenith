"""One-command laptop startup. Prerequisites: Python 3.12 or uv; Node 22 to build UI.

The portable archive already contains the UI build and does not need Node at runtime.
All Python installs stay inside this project's .venv; no system packages are changed.
"""
import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WINDOWS = os.name == 'nt'
VENV_PYTHON = ROOT / '.venv' / ('Scripts/python.exe' if WINDOWS else 'bin/python')


def run(command, **kwargs):
    print('+', ' '.join(str(part) for part in command), flush=True)
    subprocess.run([str(part) for part in command], cwd=ROOT, check=True, **kwargs)


def setup_python():
    uv = shutil.which('uv')
    if VENV_PYTHON.exists():
        result = subprocess.check_output([str(VENV_PYTHON), '-c', 'import sys; print(sys.version_info[:2])'], text=True).strip()
        if result not in {'(3, 11)', '(3, 12)', '(3, 13)'}:
            raise RuntimeError('Existing .venv uses an unsupported Python version. Preserve it and use a clean extracted project folder with Python 3.12 or uv.')
    elif uv:
        run([uv, 'venv', '--python', '3.12', str(ROOT / '.venv')])
    else:
        candidate = shutil.which('python3.12')
        if not candidate and sys.version_info[:2] in {(3, 11), (3, 12), (3, 13)}:
            candidate = sys.executable
        if not candidate:
            raise RuntimeError('Install Python 3.12 or uv first. The system Python 3.14 ML stack is not supported by this launcher.')
        run([candidate, '-m', 'venv', str(ROOT / '.venv')])
    fingerprint = hashlib.sha256()
    for file in sorted((ROOT / 'backend').glob('requirements*.txt')):
        fingerprint.update(file.read_bytes())
    fingerprint.update(str(VENV_PYTHON).encode())
    stamp = ROOT / '.venv' / '.zenith-dependencies'
    if stamp.exists() and stamp.read_text() == fingerprint.hexdigest():
        print('Python dependencies already prepared.', flush=True)
        return
    if uv:
        installer = [uv, 'pip', 'install', '--python', str(VENV_PYTHON), '--link-mode=copy']
    else:
        run([VENV_PYTHON, '-m', 'ensurepip', '--upgrade'])
        installer = [str(VENV_PYTHON), '-m', 'pip', 'install']
    torch_command = [*installer, 'torch', 'torchvision']
    if sys.platform != 'darwin':
        torch_command += ['--index-url', 'https://download.pytorch.org/whl/cpu']
    run(torch_command)
    run([*installer, '-r', str(ROOT / 'backend' / 'requirements.txt')])
    stamp.write_text(fingerprint.hexdigest())


def setup_frontend(force=False):
    if (ROOT / 'dist' / 'index.html').is_file() and not force:
        print('Using the included frontend build. Use --rebuild after editing frontend code.', flush=True)
        return
    npm = shutil.which('npm.cmd' if WINDOWS else 'npm')
    node = shutil.which('node')
    if not npm or not node:
        raise RuntimeError('Install Node.js 22+ to build the UI, or use the portable archive containing dist/.')
    version = subprocess.check_output([node, '--version'], text=True).strip()
    if int(version.lstrip('v').split('.')[0]) < 22:
        raise RuntimeError('Node.js 22 or newer is required for this source build.')
    run([npm, 'ci'])
    run([npm, 'run', 'build'])


def main():
    parser = argparse.ArgumentParser(description='Install local dependencies, then start Zenith with one command.')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--setup-only', action='store_true')
    parser.add_argument('--rebuild', action='store_true')
    parser.add_argument('--local', action='store_true', help='Use local SQLite without changing or using DATABASE_URL in .env')
    parser.add_argument('--require-key', action='store_true', help='Disable loopback-only automatic sessions; use the operator key (recommended before public tunnelling)')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Use a port between 1024 and 65535')
    os.chdir(ROOT)
    if not args.setup_only:
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', args.port)) == 0:
                raise RuntimeError(f'Port {args.port} is already in use. Stop that service or run: python start.py --port {args.port + 1}')
    setup_frontend(args.rebuild)
    setup_python()
    if args.setup_only:
        print('Setup complete. Run python start.py to launch.', flush=True)
        return
    env = {**os.environ, 'ZENITH_SERVE_FRONTEND': '1', 'ZENITH_ALLOW_LOCAL_SESSION': '0' if args.require_key else '1', 'PYTHONUNBUFFERED': '1'}
    if args.local:
        data = Path(env.get('ZENITH_DATA', ROOT / 'data')).resolve()
        data.mkdir(parents=True, exist_ok=True)
        env['DATABASE_URL'] = 'sqlite:///' + (data / 'zenith.db').as_posix()
    # Initialize once before child startup to avoid initial DDL/key-file races.
    run([VENV_PYTHON, '-c', 'from backend.db import init_db; init_db()'], env=env)
    processes = []

    def stop(*_):
        for process in reversed(processes):
            if process.poll() is None:
                if WINDOWS:
                    process.terminate()
                else:
                    os.killpg(process.pid, signal.SIGTERM)
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                if WINDOWS:
                    process.kill()
                else:
                    os.killpg(process.pid, signal.SIGKILL)

    def interrupted(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    url = f'http://127.0.0.1:{args.port}'
    try:
        for command in ([str(VENV_PYTHON), '-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', str(args.port)], [str(VENV_PYTHON), '-m', 'backend.worker']):
            processes.append(subprocess.Popen(command, cwd=ROOT, env=env, start_new_session=not WINDOWS))
        print(f'\nZenith: {url}/#settings\nAPI origin: leave blank (same-origin).\nOperator key: data/operator.key, unless ZENITH_API_KEY overrides it in .env.\nCtrl+C stops both services.\n', flush=True)
        deadline = time.monotonic() + 60
        while all(process.poll() is None for process in processes):
            try:
                with urllib.request.urlopen(url + '/api/health', timeout=1) as response:
                    if json.load(response).get('service') == 'zenith':
                        break
            except (OSError, ValueError):
                pass
            if time.monotonic() > deadline:
                raise RuntimeError('API did not become ready within 60 seconds; inspect startup output above.')
            time.sleep(0.5)
        if any(process.poll() is not None for process in processes):
            raise RuntimeError('A service failed during startup; inspect output above.')
        if not args.no_browser:
            webbrowser.open(url + '/#settings')
        while all(process.poll() is None for process in processes):
            time.sleep(1)
        raise RuntimeError('A service stopped unexpectedly; remaining services are being stopped.')
    except KeyboardInterrupt:
        print('\nStopping Zenith.', flush=True)
    finally:
        stop()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'\nStartup failed: {error}', file=sys.stderr)
        sys.exit(1)
