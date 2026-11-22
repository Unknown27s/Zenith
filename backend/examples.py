"""Read-only allowlist of licensed, packaged video examples."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def examples():
    folder = ROOT / 'public' / 'examples'
    if not (folder / 'manifest.json').is_file():
        folder = ROOT / 'dist' / 'examples'
    manifest = folder / 'manifest.json'
    if not manifest.is_file():
        return folder, []
    return folder, json.loads(manifest.read_text())
