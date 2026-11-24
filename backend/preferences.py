"""Backend-wide operator preferences stored in the application database.

Environment variables remain the source for credentials and allowlists.  These
preferences are safe, runtime-editable switches that the worker reads while it
runs, so changing one does not require restarting the API or worker.
"""
from .db import Preference, Session

DEFAULTS = {
    'telegram_car_photos': False,
}
ROW_ID = 'backend-preferences'
OWNER = 'system'


def read():
    values = dict(DEFAULTS)
    with Session() as session:
        row = session.get(Preference, ROW_ID)
        if row is not None:
            for key in DEFAULTS:
                if key in row.payload:
                    values[key] = bool(row.payload[key])
    return values


def get(key):
    if key not in DEFAULTS:
        raise KeyError(key)
    return read()[key]


def write(**changes):
    unknown = set(changes) - set(DEFAULTS)
    if unknown:
        raise KeyError(', '.join(sorted(unknown)))
    with Session() as session:
        row = session.get(Preference, ROW_ID)
        if row is None:
            row = Preference(id=ROW_ID, owner=OWNER, payload=dict(DEFAULTS))
            session.add(row)
        payload = {**DEFAULTS, **row.payload}
        for key, value in changes.items():
            payload[key] = bool(value)
        row.payload = payload
        session.commit()
        return {key: payload[key] for key in DEFAULTS}
