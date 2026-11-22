"""Create a shareable archive after npm run build. No credentials, media or venv."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
if not (root / 'dist' / 'index.html').is_file():
    raise SystemExit('Run npm run build before creating the portable archive.')
destination = root / 'artifacts' / 'zenith-portable.zip'
destination.parent.mkdir(exist_ok=True)
files = [root / name for name in ['start.py', 'README.md', 'HOW_TO_RUN.md', '.env.example', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'vercel.json']]
for folder, patterns in [('backend', ['*.py', 'requirements*.txt']), ('scripts', ['*.py']), ('dist', ['*']), ('public', ['*']), ('src', ['*']), ('docs', ['*.md']), ('notebooks', ['*.ipynb'])]:
    for pattern in patterns:
        files.extend(file for file in (root / folder).rglob(pattern) if file.is_file() and '__pycache__' not in file.parts)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(set(files)):
        archive.write(file, Path('Zenith') / file.relative_to(root))
print(f'Portable archive: {destination}')
