"""Create an offline, sensitive backup archive of Zenith records and local media.

Stop the API, worker, and RTSP capture first. Keep output on a protected local disk.
"""
import argparse
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import zipfile
from contextlib import closing
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
DATA = Path(os.getenv('ZENITH_DATA', 'data')).resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='Path for the sensitive .zip backup')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.suffix.lower() != '.zip' or output.is_relative_to(DATA) or output.exists():
        parser.error('Choose a new .zip path outside the data directory')
    heartbeat = DATA / 'worker.heartbeat'
    if heartbeat.exists() and time.time() - heartbeat.stat().st_mtime < 45:
        parser.error('Worker heartbeat is fresh. Stop API and worker before backing up.')
    url = make_url(os.getenv('DATABASE_URL', f'sqlite:///{DATA / "zenith.db"}'))
    temp_root = Path(os.getenv('ZENITH_TEST_TEMP', str(Path(tempfile.gettempdir()) / 'opencode')))
    temp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=temp_root) as folder:
        database = Path(folder) / ('database.dump' if url.get_backend_name() == 'postgresql' else 'database.sqlite')
        if url.get_backend_name() == 'sqlite':
            source = Path(url.database).resolve()
            if not source.is_file():
                parser.error('SQLite database does not exist')
            with closing(sqlite3.connect(source)) as existing, closing(sqlite3.connect(database)) as target:
                existing.backup(target)
        elif url.get_backend_name() == 'postgresql':
            program = shutil.which('pg_dump')
            if not program:
                parser.error('Install PostgreSQL pg_dump before backing up PostgreSQL records')
            schema = os.getenv('DATABASE_SCHEMA', 'zenith_private')
            env = {**os.environ, 'PGHOST': url.host or '', 'PGPORT': str(url.port or 5432),
                   'PGUSER': url.username or '', 'PGPASSWORD': url.password or '',
                   'PGDATABASE': url.database or '', 'PGSSLMODE': url.query.get('sslmode', 'require')}
            subprocess.run([program, '-Fc', '--no-owner', '--no-acl', f'--schema={schema}', '-f', str(database)],
                           env=env, check=True, capture_output=True)
        else:
            parser.error('Only SQLite and PostgreSQL backups are supported')
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(database, f'zenith-backup/{database.name}')
            for directory in ('sources', 'evidence'):
                for file in (DATA / directory).glob('*'):
                    if file.is_file():
                        archive.write(file, f'zenith-backup/{directory}/{file.name}')
            key = DATA / 'operator.key'
            if key.is_file():
                archive.write(key, 'zenith-backup/operator.key')
            archive.writestr('zenith-backup/README.txt',
                'SENSITIVE UNENCRYPTED BACKUP. Store offline. Stop services before restore. '
                'PostgreSQL: restore database.dump with pg_restore into a private schema. '
                'SQLite: restore database.sqlite. Keep operator.key with the database; '
                'if ZENITH_API_KEY was configured separately, back it up privately too. '
                'Restore sources/ and evidence/ under ZENITH_DATA. Never publish this archive.\n')
    print(f'Backup saved: {output} ({output.stat().st_size} bytes). Encrypt or protect it before sharing.')


if __name__ == '__main__':
    main()
