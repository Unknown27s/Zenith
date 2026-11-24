"""Smoke-test the describe-to-proposal engine against the packaged examples.

Run from the repository root:

    .venv/bin/python scripts/smoke_proposal.py

The script exercises the detector/motion proposal path only. A hosted vision
proposal is not tested because it needs a configured provider, explicit consent,
and network access.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import cv2  # noqa: E402

from backend import proposal  # noqa: E402

EXAMPLES = ROOT / 'public' / 'examples'

CASES = (
    ('people-zone.webm', 'Alert when someone stays in the loading bay for more than 10 seconds.',
     'zone', 10, 3, 12),
    ('traffic-counting.webm', 'Count vehicles crossing the road.', 'traffic', 2, 2, 2),
    ('equipment-activity.webm', 'Tell me when the machine is running.',
     'machine_activity', 2, 3, 12),
)


def duration(path: Path) -> float:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise SystemExit(f'Cannot open {path}')
    try:
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(capture.get(cv2.CAP_PROP_FPS))
    finally:
        capture.release()
    if fps <= 0 or frames <= 0:
        raise SystemExit(f'Cannot read duration from {path}')
    return frames / fps


def check(result: dict, capability: str, dwell: float, minimum: int, maximum: int) -> list[str]:
    failures = []
    if result.get('capability') != capability:
        failures.append(f"capability {result.get('capability')!r} != {capability!r}")
    if abs(float(result.get('dwell_seconds', -1)) - dwell) > 1e-6:
        failures.append(f"dwell {result.get('dwell_seconds')!r} != {dwell!r}")
    points = result.get('points') or []
    if not minimum <= len(points) <= maximum:
        failures.append(f'points {len(points)} outside {minimum}..{maximum}')
    for point in points:
        if not (isinstance(point, (list, tuple)) and len(point) == 2
                and all(isinstance(value, (int, float)) and 0 <= value <= 1 for value in point)):
            failures.append(f'point {point!r} is not a normalized pair')
            break
    for forbidden in ('confirmed', 'recipients', 'recipient'):
        if forbidden in result:
            failures.append(f'proposal leaked {forbidden!r}')
    if not result.get('rationale'):
        failures.append('missing rationale')
    if not result.get('warnings'):
        failures.append('missing limitations')
    return failures


def main() -> int:
    failures = []
    for filename, instruction, capability, dwell, minimum, maximum in CASES:
        path = EXAMPLES / filename
        if not path.is_file():
            failures.append(f'{filename}: missing example')
            continue
        payload = {'file': str(path), 'duration': duration(path)}
        result = proposal.build(payload, instruction, capability, dwell)
        problems = check(result, capability, dwell, minimum, maximum)
        failures.extend(f'{filename}: {problem}' for problem in problems)
        print(json.dumps({
            'file': filename,
            'capability': result.get('capability'),
            'points': result.get('points'),
            'dwell_seconds': result.get('dwell_seconds'),
            'model': result.get('model'),
            'parser': result.get('parser'),
            'rationale': result.get('rationale'),
            'uncertainties': result.get('uncertainties'),
            'warnings': result.get('warnings'),
            'problems': problems,
        }, indent=2))

    action = proposal.build({}, 'Detect a fight.', 'action', 2)
    action_problems = check(action, 'action', 2, 0, 0)
    failures.extend(f'action: {problem}' for problem in action_problems)
    print(json.dumps({
        'file': '(no frames needed)',
        'capability': action.get('capability'),
        'points': action.get('points'),
        'model': action.get('model'),
        'problems': action_problems,
    }, indent=2))

    if failures:
        print('\nFAILED:', file=sys.stderr)
        for failure in failures:
            print(f'  - {failure}', file=sys.stderr)
        return 1
    print('\nAll proposal smoke checks passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
