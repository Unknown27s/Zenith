"""Build a same-origin Colab bundle with backend code and static dashboard assets."""
import os
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
subprocess.run(['npm', 'run', 'build'], cwd=root, check=True,
               env={**os.environ, 'VITE_API_BASE_URL': ''})
destination = root / 'artifacts' / 'zenith-colab.zip'
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    backend = root / 'backend'
    for file in sorted([*backend.rglob('*.py'), *backend.glob('requirements*.txt')]):
        archive.write(file, file.relative_to(root))
    for file in sorted((root / 'dist').rglob('*')):
        if file.is_file():
            archive.write(file, file.relative_to(root))
print(f'Created {destination}')
