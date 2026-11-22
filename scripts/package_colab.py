"""Package application code only; excludes customer data, dependencies and secrets."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
destination = root / 'artifacts' / 'zenith-colab.zip'
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for file in sorted((root / 'backend').rglob('*.py')):
        archive.write(file, file.relative_to(root))
    for file in sorted((root / 'backend').glob('requirements*.txt')):
        archive.write(file, file.relative_to(root))
print(f'Created {destination}; upload this in the Colab notebook.')
