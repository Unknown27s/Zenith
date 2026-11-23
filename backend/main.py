import hashlib
import hmac
import io
import logging
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text

from .config import DATA, MAX_DURATION, MAX_UPLOAD, RECIPIENTS, TOKEN
from .db import Carbon, Equipment, Incident, Notification, Run, Session, Source, VisionReview, init_db, serialize
from .schemas import Action, CarbonRequest, EquipmentRequest, EquipmentStateRequest, ProposalRequest, RunRequest, VisionReviewRequest
from . import vision

log = logging.getLogger('zenith')
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(title='Zenith monitoring', version='0.1.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv('ZENITH_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(','), allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type', 'ngrok-skip-browser-warning'])
security = HTTPBearer(auto_error=False)


def local_browser(request: Request):
    return (os.getenv('ZENITH_ALLOW_LOCAL_SESSION') == '1'
            and request.client and request.client.host in {'127.0.0.1', '::1'}
            and request.url.hostname in {'localhost', '127.0.0.1', '::1'})


def owner(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    valid = credentials is not None and secrets.compare_digest(credentials.credentials.encode(), TOKEN.encode())
    if credentials is None and local_browser(request):
        cookie = request.cookies.get('zenith_local', '')
        try:
            expiry, nonce, signature = cookie.split('.')
            expected = hmac.new(TOKEN.encode(), f'{expiry}.{nonce}'.encode(), hashlib.sha256).hexdigest()
            valid = int(expiry) > time.time() and hmac.compare_digest(signature, expected)
        except (ValueError, TypeError):
            valid = False
    if not valid:
        log.warning('Rejected invalid operator credential')
        raise HTTPException(401, 'Connect the local session or enter a valid operator key in Settings')
    return hashlib.sha256(TOKEN.encode()).hexdigest()


@app.post('/api/local-session')
def local_session(request: Request, response: Response):
    # No permanent key is returned. Reject cross-site requests and DNS rebinding.
    from urllib.parse import urlsplit
    origin = request.headers.get('origin', '')
    approved = {str(request.base_url).rstrip('/'), *os.getenv('ZENITH_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(',')}
    if not local_browser(request) or origin not in approved or urlsplit(origin).hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise HTTPException(403, 'Automatic access is available only from the local laptop application; remote access requires the operator key')
    expiry, nonce = str(int(time.time()) + 8*3600), secrets.token_hex(16)
    signature = hmac.new(TOKEN.encode(), f'{expiry}.{nonce}'.encode(), hashlib.sha256).hexdigest()
    response.set_cookie('zenith_local', f'{expiry}.{nonce}.{signature}', max_age=8*3600,
                        httponly=True, samesite='strict', secure=request.url.scheme == 'https', path='/api')
    return {'status': 'connected', 'mode': 'local-only operator session'}


def owned(session, model, row_id, identity):
    row = session.get(model, row_id)
    if row is None or row.owner != identity:
        raise HTTPException(404, 'Record not found')
    return row


@app.middleware('http')
async def safety_headers(request, call_next):
    if request.method == 'POST':
        try:
            size = int(request.headers.get('content-length', '0'))
        except ValueError:
            return Response(status_code=400)
        if size > MAX_UPLOAD + 1024 * 1024:
            return Response('Upload too large', status_code=413)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.get('/api/health')
def health():
    return {'status': 'ok', 'service': 'zenith'}


@app.get('/api/status')
def status(identity=Depends(owner)):
    heartbeat = DATA / 'worker.heartbeat'
    age = time.time() - heartbeat.stat().st_mtime if heartbeat.exists() else None
    vision_status = vision.provider_status()
    return {'worker_online': age is not None and age < 45, 'worker_age_seconds': age,
            'email_mode': 'configured' if os.getenv('RESEND_API_KEY') and os.getenv('ZENITH_FROM_EMAIL') else 'preview',
            'ai_review': vision_status['provider'], 'vision': vision_status, 'recipients': RECIPIENTS, 'max_upload_mb': MAX_UPLOAD // (1024*1024),
            'max_video_seconds': MAX_DURATION, 'deployment': 'single-operator demo',
            'capabilities': ['zone', 'traffic', 'machine_activity']}


@app.get('/api/vision/status')
def vision_status(identity=Depends(owner)):
    return vision.probe()


@app.get('/api/sources')
def sources(identity=Depends(owner)):
    with Session() as session:
        return [serialize(x) for x in session.scalars(select(Source).where(Source.owner == identity).order_by(Source.created.desc()))]


@app.get('/api/samples')
def sample_list(identity=Depends(owner)):
    from .examples import examples
    folder, items = examples()
    return [{**item, 'available': (folder / item['file']).is_file()} for item in items]


@app.post('/api/sources/sample/{sample_id}', status_code=201)
async def import_sample(sample_id: str, identity=Depends(owner)):
    from .examples import examples
    folder, items = examples()
    sample = next((item for item in items if item['id'] == sample_id), None)
    if not sample:
        raise HTTPException(404, 'Unknown packaged example')
    path = (folder / sample['file']).resolve()
    if not path.is_relative_to(folder.resolve()) or not path.is_file():
        raise HTTPException(503, 'Example video is not installed in this backend package')
    # Reuse bounded video validation; no remote URLs or arbitrary server paths accepted.
    file = UploadFile(filename=sample['file'], file=path.open('rb'))
    try:
        result = await upload(file, identity)
    finally:
        await file.close()
    with Session() as session:
        row = owned(session, Source, result['id'], identity)
        row.payload = {**row.payload, 'name': f"Example · {sample['title']}", 'input_type': 'sample',
                       'example_id': sample['id'], 'recommended_capability': sample['capability'],
                       'credit': sample['credit'], 'license': sample['license'], 'original_source': sample['source']}
        session.commit()
        return serialize(row)


@app.post('/api/sources', status_code=201)
async def upload(file: UploadFile, identity=Depends(owner)):
    try:
        import cv2
    except ImportError:
        raise HTTPException(503, 'Video dependencies are not installed. Install backend/requirements.txt to enable uploads and inference.')
    suffix = Path(file.filename or '').suffix.lower()
    if suffix not in {'.mp4', '.mov', '.avi', '.mkv', '.webm'}:
        raise HTTPException(400, 'Use MP4, MOV, AVI, MKV or WebM')
    source_id = str(uuid.uuid4())
    path = DATA / 'sources' / f'{source_id}{suffix}'
    size = 0
    try:
        with Session() as session:
            if session.scalar(select(func.count()).select_from(Source).where(Source.owner == identity)) >= 30:
                raise HTTPException(429, 'This demo is limited to 30 source clips; archive data before adding more')
        with path.open('wb') as stream:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, 'Clip exceeds upload limit')
                stream.write(chunk)
        capture = cv2.VideoCapture(str(path))
        try:
            fps = capture.get(cv2.CAP_PROP_FPS)
            count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
            width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = count / fps if fps > 0 else 0
            if not 0 < duration <= MAX_DURATION or not 0 < width <= 3840 or not 0 < height <= 2160:
                raise HTTPException(400, f'Clip must have a known duration up to {MAX_DURATION}s and be at most 3840×2160')
            ok, frame = capture.read()
            if not ok:
                raise HTTPException(400, 'Cannot decode this video')
            preview = DATA / 'sources' / f'{source_id}.jpg'
            if not cv2.imwrite(str(preview), frame):
                raise HTTPException(503, 'Cannot store preview')
        finally:
            capture.release()
        with Session() as session:
            row = Source(id=source_id, owner=identity, payload={'name': Path(file.filename or 'Uploaded video').name[:120], 'file': path.name, 'duration': round(duration, 3), 'fps': fps, 'width': width, 'height': height, 'input_type': 'uploaded', 'bytes': size})
            session.add(row)
            session.commit()
            return serialize(row)
    except Exception:
        path.unlink(missing_ok=True)
        (DATA / 'sources' / f'{source_id}.jpg').unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.get('/api/sources/{source_id}/{artifact}')
def source_artifact(source_id: str, artifact: str, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, Source, source_id, identity)
        if artifact == 'preview':
            path = DATA / 'sources' / f'{row.id}.jpg'
        elif artifact == 'video':
            path = DATA / 'sources' / row.payload['file']
        else:
            raise HTTPException(404)
        if not path.is_file():
            raise HTTPException(404, 'Source artifact unavailable')
        return FileResponse(path)


@app.post('/api/proposals')
def propose(body: ProposalRequest, identity=Depends(owner)):
    text = body.instruction.lower()
    unsupported = ['collapse', 'helmet', 'ppe', 'fire', 'smoke', 'crowd', 'weapon', 'face', 'obstruction']
    if any(word in text for word in unsupported):
        raise HTTPException(422, 'This capability is not available yet. Use a person-zone, vehicle-counting or machine-activity instruction.')
    machine = any(word in text for word in ['machine', 'motor', 'equipment', 'generator', 'conveyor'])
    traffic = any(word in text for word in ['vehicle', 'truck', 'car ', 'cars', 'bus', 'traffic', 'motorcycle'])
    zone = any(word in text for word in ['person', 'people', 'anyone', 'worker', 'someone'])
    if sum([machine, traffic, zone]) != 1:
        raise HTTPException(422, 'Describe one supported rule at a time: people in a zone, vehicle counting, or visible machine activity.')
    capability = 'machine_activity' if machine else 'traffic' if traffic else 'zone'
    match = re.search(r'(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b', text)
    words = {'one': 1, 'two': 2, 'three': 3, 'five': 5, 'ten': 10}
    dwell = float(match.group(1)) if match else next((v for k, v in words.items() if f'{k} seconds' in text), 2)
    if not 0.2 <= dwell <= 120:
        raise HTTPException(422, 'Dwell must be between 0.2 and 120 seconds')
    return {'capability': capability, 'dwell_seconds': dwell, 'parser': 'constrained local parser',
            'model': 'OpenCV ROI motion proxy' if machine else 'YOLOv8 Nano + ByteTrack',
            'warnings': ['No vision agent has inspected the preview. Draw and confirm the zone or line.', 'Recipients are selected from configured contacts; language cannot authorize delivery.'] + (['Visible motion is not proof of electrical on/off state.'] if machine else [])}


@app.post('/api/runs', status_code=202)
def create_run(body: RunRequest, identity=Depends(owner)):
    if body.rule.recipient and body.rule.recipient not in RECIPIENTS:
        raise HTTPException(400, 'Recipient is not configured')
    approval = None
    if body.vision_provider:
        try:
            approval = vision.authorization(body.vision_provider, body.vision_consent)
        except vision.ReviewError as exc:
            raise HTTPException(409, str(exc)) from exc
    with Session() as session:
        # Serialize the capacity check with enqueue across this operator's sources.
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        elif session.bind.dialect.name == 'postgresql':
            session.execute(select(func.pg_advisory_xact_lock(int(identity[:15], 16))))
        source = owned(session, Source, body.source_id, identity)
        active = session.scalar(select(func.count()).select_from(Run).where(Run.owner == identity, Run.status.in_(['queued', 'processing'])))
        if active >= 3:
            raise HTTPException(429, 'Three jobs are already pending; wait for one to finish')
        run = Run(owner=identity, payload={'source_id': source.id, 'source_name': source.payload['name'], 'rule': body.rule.model_dump(), 'progress': 0, 'stage': 'Waiting for analysis worker', 'counts': {}, 'coverage': 'pending'})
        if approval:
            run.payload = {**run.payload, 'vision_authorization': approval}
        session.add(run)
        session.commit()
        log.info('Queued analysis %s', run.id)
        return serialize(run)


@app.get('/api/runs')
def runs(identity=Depends(owner)):
    with Session() as session:
        return [serialize(x) for x in session.scalars(select(Run).where(Run.owner == identity).order_by(Run.created.desc()).limit(100))]


@app.get('/api/runs/{run_id}')
def get_run(run_id: str, identity=Depends(owner)):
    with Session() as session:
        return serialize(owned(session, Run, run_id, identity))


@app.get('/api/events')
def events(identity=Depends(owner)):
    with Session() as session:
        return vision.incident_views(session, list(session.scalars(
            select(Incident).where(Incident.owner == identity).order_by(Incident.created.desc()).limit(300))))


@app.get('/api/runs/{run_id}/events')
def run_events(run_id: str, identity=Depends(owner)):
    with Session() as session:
        owned(session, Run, run_id, identity)
        return vision.incident_views(session, list(session.scalars(
            select(Incident).where(Incident.owner == identity, Incident.run_id == run_id))))


@app.post('/api/events/{event_id}/acknowledge')
def acknowledge(event_id: str, body: Action, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, Incident, event_id, identity)
        row.payload = {**row.payload, 'operator_status': body.action, 'history': [*row.payload.get('history', []), {'action': body.action, 'note': body.note, 'at': time.time(), 'actor': 'Demo operator'}]}
        session.commit()
        log.info('Operator action %s on %s', body.action, event_id)
        return vision.incident_view(row, session.get(VisionReview, event_id))


@app.get('/api/events/{event_id}/review')
def get_review(event_id: str, identity=Depends(owner)):
    with Session() as session:
        owned(session, Incident, event_id, identity)
        return vision.review_view(session.get(VisionReview, event_id))


@app.post('/api/events/{event_id}/review', status_code=202)
def request_review(event_id: str, body: VisionReviewRequest, identity=Depends(owner)):
    with Session() as session:
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        else:
            session.execute(select(Incident).where(
                Incident.id == event_id, Incident.owner == identity).with_for_update())
        event = owned(session, Incident, event_id, identity)
        try:
            approval = vision.authorization(body.provider, body.consent)
        except vision.ReviewError as exc:
            raise HTTPException(409, str(exc)) from exc
        if not event.payload.get('frames'):
            raise HTTPException(409, 'This incident has no evidence frames')
        row = session.get(VisionReview, event_id)
        if row and row.status in {'queued', 'processing'}:
            return vision.review_view(row)
        if row is None:
            row = VisionReview(id=event_id, owner=identity, run_id=event.run_id)
            session.add(row)
        row.status = 'queued'
        row.created = time.time()
        row.payload = approval
        row.lease = 0
        row.lease_token = ''
        session.commit()
        return vision.review_view(row)


@app.get('/api/events/{event_id}/evidence/{frame_id}')
def evidence(event_id: str, frame_id: str, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, Incident, event_id, identity)
        if frame_id not in row.payload.get('frames', []):
            raise HTTPException(404)
        path = DATA / 'evidence' / frame_id
        if not path.is_file():
            raise HTTPException(404, 'Evidence unavailable')
        return FileResponse(path, media_type='image/jpeg')


@app.get('/api/notifications')
def notifications(identity=Depends(owner)):
    with Session() as session:
        return [serialize(x) for x in session.scalars(select(Notification).where(Notification.owner == identity).order_by(Notification.created.desc()).limit(100))]


def carbon_values(body, session, identity):
    values = body.model_dump()
    if body.run_id:
        run = owned(session, Run, body.run_id, identity)
        if run.status != 'completed':
            raise HTTPException(400, 'Only completed runs can supply carbon activity data')
        if body.kind == 'traffic':
            if run.payload['rule']['capability'] != 'traffic' or not body.vehicle_class:
                raise HTTPException(400, 'Select a traffic run and vehicle class')
            values['quantity'] = run.payload.get('counts', {}).get(body.vehicle_class, 0)
        elif body.kind == 'electricity':
            if run.payload['rule']['capability'] != 'machine_activity' or not body.accept_activity_proxy:
                raise HTTPException(400, 'Explicitly accept the visible-motion runtime proxy')
            values['hours'] = run.payload.get('activity_seconds', 0) / 3600
            values['basis'] = f'Unvalidated visible-motion proxy from run {run.id}. ' + body.basis
        else:
            raise HTTPException(400, 'Fuel entries require measured or operator-provided litres')
        values['coverage'] = run.payload.get('coverage', 'unknown')
    else:
        values['coverage'] = 'operator-supplied activity; not independently verified'
    if body.kind == 'electricity':
        kg = values['quantity'] * values['hours'] * body.load_fraction * body.factor
        formula = f"{values['quantity']:g} kW × {values['hours']:.6g} h × {body.load_fraction:g} load × {body.factor:g} kg CO2e/kWh"
    elif body.kind == 'fuel':
        kg = values['quantity'] * body.factor
        formula = f"{values['quantity']:g} L × {body.factor:g} kg CO2e/L"
    else:
        kg = values['quantity'] * body.distance_km * body.factor / 1000
        formula = f"{values['quantity']:g} vehicles × {body.distance_km:g} km × {body.factor:g} g CO2/vehicle-km ÷ 1000"
    return {**values, 'kg': kg, 'formula': formula, 'label': 'CO2 estimate' if body.kind == 'traffic' else 'CO2e estimate'}


@app.post('/api/carbon', status_code=201)
def add_carbon(body: CarbonRequest, identity=Depends(owner)):
    with Session() as session:
        row = Carbon(owner=identity, payload=carbon_values(body, session, identity))
        session.add(row)
        session.commit()
        return serialize(row)


@app.get('/api/carbon')
def carbon(identity=Depends(owner)):
    with Session() as session:
        return [serialize(x) for x in session.scalars(select(Carbon).where(Carbon.owner == identity).order_by(Carbon.created.desc()).limit(1000))]


def equipment_view(row):
    view = serialize(row)
    elapsed = max(0, time.time() - view['state_since']) if view['state'] == 'on' else 0
    view['logged_on_seconds'] = view.get('on_seconds', 0) + elapsed
    view['basis'] = 'Operator-declared state transitions; unknown intervals excluded. Not independently sensor-verified.'
    return view


@app.get('/api/equipment')
def equipment(identity=Depends(owner)):
    with Session() as session:
        return [equipment_view(x) for x in session.scalars(select(Equipment).where(Equipment.owner == identity).order_by(Equipment.created.desc()))]


@app.post('/api/equipment', status_code=201)
def add_equipment(body: EquipmentRequest, identity=Depends(owner)):
    with Session() as session:
        if session.scalar(select(func.count()).select_from(Equipment).where(Equipment.owner == identity)) >= 50:
            raise HTTPException(429, 'Equipment register is limited to 50 assets in this demo')
        if not body.name.strip():
            raise HTTPException(400, 'Equipment name cannot be blank')
        row = Equipment(owner=identity, payload={'name': body.name.strip(), 'state': 'unknown', 'state_since': time.time(), 'on_seconds': 0, 'history': []})
        session.add(row)
        session.commit()
        return equipment_view(row)


@app.post('/api/equipment/{equipment_id}/state')
def equipment_state(equipment_id: str, body: EquipmentStateRequest, identity=Depends(owner)):
    with Session() as session:
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        else:
            session.execute(select(Equipment).where(Equipment.id == equipment_id, Equipment.owner == identity).with_for_update())
        row = owned(session, Equipment, equipment_id, identity)
        if len(row.payload['history']) >= 1000:
            raise HTTPException(429, 'Transition log limit reached; archive this asset before continuing')
        now = time.time()
        view = equipment_view(row)
        row.payload = {**row.payload, 'state': body.state, 'state_since': now, 'on_seconds': view['logged_on_seconds'], 'history': [*row.payload['history'], {'from': row.payload['state'], 'to': body.state, 'at': now, 'note': body.note, 'actor': 'Demo operator'}]}
        session.commit()
        log.info('Operator equipment state %s on %s', body.state, row.id)
        return equipment_view(row)


@app.get('/api/reports/{format}')
def report(format: str, run_id: str | None = None, identity=Depends(owner)):
    from .reports import build_report
    with Session() as session:
        if run_id:
            owned(session, Run, run_id, identity)
        return build_report(session, identity, format, run_id)


# Opt-in only: API routes stay registered before the frontend catch-all mount.
# Used by the single-command portable launcher, not required for Vite development.
frontend = Path(__file__).resolve().parents[1] / 'dist'
if os.getenv('ZENITH_SERVE_FRONTEND') == '1' and (frontend / 'index.html').is_file():
    app.mount('/', StaticFiles(directory=frontend, html=True), name='frontend')
