import hashlib
import hmac
import io
import logging
import os
import re
import secrets
import time
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text

from .config import ALL_RECIPIENTS, DATA, MAX_DURATION, MAX_UPLOAD, STORAGE_LIMIT, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS, TELEGRAM_SEND_EVIDENCE, TOKEN
from .db import CameraInput, Carbon, EmissionFactor, Equipment, Incident, Notification, OperatorKey, Run, RunSummary, Session, Source, VisionReview, engine, init_db, serialize
from .schemas import Action, CameraInputRequest, CameraRequest, CarbonRequest, CrossingReviewRequest, EmissionFactorRequest, EquipmentRequest, EquipmentStateRequest, OperatorKeyRequest, ProposalRequest, RunRequest, VisionReviewRequest
from . import camera, vision, youtube, live_preview
from .models import ACTION_UPLOAD, action_checkpoint, model_status
from .alerts import telegram_probe, telegram_send

log = logging.getLogger('zenith')
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app):
    init_db()
    try:
        yield
    finally:
        camera.stop_all()
        live_preview.stop_all()


app = FastAPI(title='Zenith monitoring', version='0.1.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv('ZENITH_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(','), allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type', 'ngrok-skip-browser-warning'], expose_headers=['X-Captured-At', 'X-Predicted-At'])
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
        if valid:
            with Session() as session:
                valid = session.scalar(select(func.count()).select_from(OperatorKey)) == 0
    if not valid:
        if credentials is not None and len(credentials.credentials) >= 24:
            digest = hashlib.sha256(credentials.credentials.encode()).hexdigest()
            with Session() as session:
                key = session.scalar(select(OperatorKey).where(
                    OperatorKey.token_hash == digest, OperatorKey.enabled.is_(True)))
                if key is not None:
                    return key.owner
        log.warning('Rejected invalid operator credential')
        raise HTTPException(401, 'Connect the local session or enter a valid operator key in Settings')
    return hashlib.sha256(TOKEN.encode()).hexdigest()


def administrator(identity=Depends(owner), credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    if credentials is None or not secrets.compare_digest(identity, hashlib.sha256(TOKEN.encode()).hexdigest()):
        raise HTTPException(403, 'Enter the administrator key in Settings before managing operator keys')
    return identity


@app.post('/api/local-session')
def local_session(request: Request, response: Response):
    # No permanent key is returned. Reject cross-site requests and DNS rebinding.
    from urllib.parse import urlsplit
    origin = request.headers.get('origin', '')
    approved = {str(request.base_url).rstrip('/'), *os.getenv('ZENITH_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(',')}
    if not local_browser(request) or origin not in approved or urlsplit(origin).hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise HTTPException(403, 'Automatic access is available only from the local laptop application; remote access requires the operator key')
    with Session() as session:
        if session.scalar(select(func.count()).select_from(OperatorKey)):
            raise HTTPException(403, 'Automatic local sessions are disabled when separate operator keys exist. Enter your operator key in Settings.')
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


def database_readiness():
    # Probe the actual configured connection and an application table, not just the API process.
    # Never return connection strings or driver error text to clients.
    try:
        with engine.connect() as connection:
            connection.execute(select(Source.id).limit(0))
        return {'ready': True, 'engine': engine.dialect.name, 'detail': 'Application database is reachable'}
    except Exception:
        log.warning('Database readiness check failed')
        return {'ready': False, 'engine': engine.dialect.name, 'detail': 'Application database is unavailable'}


@app.get('/api/ready')
def ready():
    database = database_readiness()
    body = {'status': 'ready' if database['ready'] else 'not_ready', 'service': 'zenith',
            'database': database}
    return JSONResponse(body, status_code=200 if database['ready'] else 503)


@app.get('/api/status')
def status(identity=Depends(owner)):
    heartbeat = DATA / 'worker.heartbeat'
    age = time.time() - heartbeat.stat().st_mtime if heartbeat.exists() else None
    vision_status = vision.provider_status()
    with Session() as session:
        used = sum(row.payload.get('bytes', 0) for row in session.scalars(select(Source).where(Source.owner == identity)))
        saved_cameras = [{'id': row.id, 'name': row.payload['name'], **camera.saved_status(row.id)}
                         for row in session.scalars(select(CameraInput).where(CameraInput.owner == identity))]
    return {'database': database_readiness(), 'camera': camera.status(identity), 'is_admin': identity == hashlib.sha256(TOKEN.encode()).hexdigest(),
            'storage_used_mb': round(used / 1024**2, 1), 'storage_limit_mb': STORAGE_LIMIT // 1024**2,
            'saved_cameras': saved_cameras,
            'camera_inputs_supported': True,
            'worker_online': age is not None and age < 45, 'worker_age_seconds': age,
            'email_mode': 'configured' if os.getenv('RESEND_API_KEY') and os.getenv('ZENITH_FROM_EMAIL') else 'preview',
            'channels': {'email': 'configured' if os.getenv('RESEND_API_KEY') and os.getenv('ZENITH_FROM_EMAIL') else 'preview',
                         'telegram': {'configured': bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS), 'chats': len(TELEGRAM_CHAT_IDS), 'evidence': TELEGRAM_SEND_EVIDENCE}},
            'ai_review': vision_status['provider'], 'vision': vision_status, 'recipients': ALL_RECIPIENTS, 'max_upload_mb': MAX_UPLOAD // (1024*1024),
            'max_video_seconds': MAX_DURATION, 'deployment': 'laptop operator-key workspaces',
            'capabilities': ['zone', 'traffic', 'machine_activity', 'action'], 'models': model_status()}


@app.post('/api/models/action')
async def install_action_model(file: UploadFile, identity=Depends(administrator)):
    if os.getenv('ZENITH_ACTION_MODEL'):
        raise HTTPException(409, 'This backend uses ZENITH_ACTION_MODEL. Update the configured file on the worker.')
    if Path(file.filename or '').suffix.lower() != '.pt':
        raise HTTPException(400, 'Choose the .pt checkpoint exported by the Zenith action notebook.')
    try:
        from .action_model import load_classifier
    except ImportError as error:
        raise HTTPException(503, 'Install worker dependencies on the API host or configure ZENITH_ACTION_MODEL.') from error
    ACTION_UPLOAD.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=ACTION_UPLOAD.parent, suffix='.part', delete=False) as stream:
        temporary = Path(stream.name)
        try:
            content = await file.read(8 * 1024**2 + 1)
            if not content or len(content) > 8 * 1024**2:
                raise HTTPException(400, 'The checkpoint must be nonempty and at most 8 MB.')
            stream.write(content)
            stream.close()
            try:
                load_classifier(temporary)
            except Exception as error:
                raise HTTPException(400, 'Invalid checkpoint. Export the model from the Zenith fight and fall notebook.') from error
            temporary.replace(ACTION_UPLOAD)
        finally:
            temporary.unlink(missing_ok=True)
    return model_status()


def check_model(rule):
    if rule.capability == 'action' and not action_checkpoint().is_file():
        raise HTTPException(409, 'Upload the fight and fall checkpoint in Settings before starting analysis.')


@app.get('/api/operators')
def operators(identity=Depends(administrator)):
    with Session() as session:
        return [{'id': row.id, 'label': row.payload['label'], 'enabled': row.enabled, 'created': row.created}
                for row in session.scalars(select(OperatorKey).order_by(OperatorKey.created.desc()))]


@app.post('/api/operators', status_code=201)
def add_operator(body: OperatorKeyRequest, identity=Depends(administrator)):
    with Session() as session:
        if session.scalar(select(func.count()).select_from(OperatorKey)) >= 10:
            raise HTTPException(429, 'This laptop is limited to 10 operator keys')
        token = secrets.token_urlsafe(32)
        row = OperatorKey(owner=str(uuid.uuid4()), token_hash=hashlib.sha256(token.encode()).hexdigest(),
                          payload={'label': body.label.strip()})
        session.add(row)
        session.commit()
        return {'id': row.id, 'label': row.payload['label'], 'key': token}


@app.post('/api/operators/{key_id}/revoke')
def revoke_operator(key_id: str, identity=Depends(administrator)):
    with Session() as session:
        row = session.get(OperatorKey, key_id)
        if row is None:
            raise HTTPException(404, 'Operator key not found')
        row.enabled = False
        session.commit()
    return {'status': 'revoked'}


@app.get('/api/vision/status')
def vision_status(identity=Depends(owner)):
    return vision.probe()


def check_recipients(rule):
    """Reject any recipient the backend was not configured to contact."""
    unknown = [recipient for recipient in rule.recipients if recipient not in ALL_RECIPIENTS]
    if unknown:
        raise HTTPException(400, 'One or more recipients are not configured on this backend')


@app.post('/api/cameras/rtsp/start', status_code=202)
def start_rtsp(body: CameraRequest, identity=Depends(owner)):
    check_model(body.rule)
    check_recipients(body.rule)
    heartbeat = DATA / 'worker.heartbeat'
    if not heartbeat.exists() or time.time() - heartbeat.stat().st_mtime > 45:
        raise HTTPException(409, 'Start the analysis worker before starting a camera')
    try:
        approval = vision.authorization(body.vision_provider, body.vision_consent) if body.vision_provider else None
        return camera.start(identity, body.rule.model_dump(), approval)
    except vision.ReviewError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post('/api/cameras/rtsp/stop')
def stop_rtsp(identity=Depends(owner)):
    try:
        return camera.stop(identity)
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc


@app.get('/api/cameras/rtsp/preview')
def preview_rtsp(identity=Depends(owner)):
    try:
        return Response(camera.snapshot(identity), media_type='image/jpeg')
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc


def camera_input_view(row):
    return {**serialize(row), 'health': camera.saved_status(row.id), 'live': live_preview.status(row.id)}


@app.get('/api/cameras')
def camera_inputs(identity=Depends(owner)):
    with Session() as session:
        return [camera_input_view(row) for row in session.scalars(
            select(CameraInput).where(CameraInput.owner == identity).order_by(CameraInput.created))]


@app.post('/api/cameras', status_code=201)
def add_camera_input(body: CameraInputRequest, identity=Depends(owner)):
    canonical = youtube.video_url(body.url.strip())
    if not canonical:
        raise HTTPException(400, 'Paste an HTTPS YouTube watch/live video link. Arbitrary network URLs are not accepted from the browser.')
    with Session() as session:
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        elif session.bind.dialect.name == 'postgresql':
            session.execute(select(func.pg_advisory_xact_lock(int(identity[:15], 16))))
        rows = list(session.scalars(select(CameraInput).where(CameraInput.owner == identity)))
        if len(rows) >= 6:
            raise HTTPException(409, 'This demo supports six saved inputs per workspace')
        if any(row.payload['url'] == canonical for row in rows):
            raise HTTPException(409, 'This YouTube input is already saved in your workspace')
        row = CameraInput(owner=identity, payload={'name': body.name.strip(), 'url': canonical})
        session.add(row)
        session.flush()
        result = camera_input_view(row)
        session.commit()
        return result


@app.post('/api/cameras/{camera_id}/remove')
def remove_camera_input(camera_id: str, identity=Depends(owner)):
    with Session() as session:
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        else:
            session.execute(select(CameraInput.id).where(CameraInput.id == camera_id).with_for_update())
        row = owned(session, CameraInput, camera_id, identity)
        try:
            live_preview.forget(row.id)
            camera.forget_saved(row.id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        session.delete(row)
        session.commit()
    return {'status': 'removed'}


@app.get('/api/cameras/{camera_id}/preview')
def preview_camera_input(camera_id: str, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, CameraInput, camera_id, identity)
        url = row.payload['url']
    try:
        return Response(camera.snapshot(identity, input_url=url), media_type='image/jpeg')
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post('/api/cameras/{camera_id}/start', status_code=202)
def start_camera_input(camera_id: str, body: CameraRequest, identity=Depends(owner)):
    check_model(body.rule)
    check_recipients(body.rule)
    heartbeat = DATA / 'worker.heartbeat'
    if not heartbeat.exists() or time.time() - heartbeat.stat().st_mtime > 45:
        raise HTTPException(409, 'Start the analysis worker before starting a camera')
    with Session() as session:
        # Serialize start/remove for this saved record. The connector is single-process.
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        else:
            session.execute(select(CameraInput.id).where(CameraInput.id == camera_id).with_for_update())
        row = owned(session, CameraInput, camera_id, identity)
        try:
            approval = vision.authorization(body.vision_provider, body.vision_consent) if body.vision_provider else None
            result = camera.start_saved(identity, row.id, row.payload['name'], row.payload['url'],
                                        body.rule.model_dump(), approval)
        except (ValueError, vision.ReviewError) as exc:
            raise HTTPException(409, str(exc)) from exc
        row.payload = {**row.payload, 'last_rule': body.rule.model_dump()}
        session.commit()
        return result


@app.post('/api/cameras/{camera_id}/stop')
def stop_camera_input(camera_id: str, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, CameraInput, camera_id, identity)
        return camera.stop_saved(row.id)


@app.post('/api/cameras/{camera_id}/live/start', status_code=202)
def start_camera_preview(camera_id: str, identity=Depends(owner)):
    with Session() as session:
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        else:
            session.execute(select(CameraInput.id).where(CameraInput.id == camera_id).with_for_update())
        row = owned(session, CameraInput, camera_id, identity)
        try:
            return live_preview.start(row.id, row.payload['url'])
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc


@app.post('/api/cameras/{camera_id}/live/stop')
def stop_camera_preview(camera_id: str, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, CameraInput, camera_id, identity)
        return live_preview.stop(row.id)


@app.get('/api/cameras/{camera_id}/live/frame')
def camera_preview_frame(camera_id: str, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, CameraInput, camera_id, identity)
        try:
            jpeg, captured_at, predicted_at = live_preview.frame(row.id)
        except ValueError as exc:
            raise HTTPException(503, str(exc)) from exc
        return Response(jpeg, media_type='image/jpeg',
                        headers={'X-Captured-At': str(captured_at), 'X-Predicted-At': str(predicted_at)})


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
            remaining = STORAGE_LIMIT - sum(row.payload.get('bytes', 0) for row in session.scalars(
                select(Source).where(Source.owner == identity)))
            if remaining <= 0:
                raise HTTPException(429, 'Source storage quota reached; archive old clips before uploading')
        with path.open('wb') as stream:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, 'Clip exceeds upload limit')
                if size > remaining:
                    raise HTTPException(413, 'Clip exceeds your remaining source storage quota')
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
    unsupported = ['helmet', 'ppe', 'fire', 'smoke', 'crowd', 'weapon', 'face', 'obstruction']
    if any(word in text for word in unsupported):
        raise HTTPException(422, 'This capability is not available yet. Use a person-zone, vehicle-counting or machine-activity instruction.')
    action = bool(re.search(r'\b(fights?|fighting|violence|fall(?:s|ing)?|collapse[sd]?)\b', text))
    machine = any(word in text for word in ['machine', 'motor', 'equipment', 'generator', 'conveyor'])
    traffic = any(word in text for word in ['vehicle', 'truck', 'car ', 'cars', 'bus', 'traffic', 'motorcycle'])
    zone = any(word in text for word in ['person', 'people', 'anyone', 'worker', 'someone'])
    if action and not (machine or traffic):
        return {'capability': 'action', 'dwell_seconds': 2, 'parser': 'constrained local parser',
                'model': 'YOLO Pose and Action Transformer', 'warnings': ['Review each possible fight or fall against the footage.']}
    if action or sum([machine, traffic, zone]) != 1:
        raise HTTPException(422, 'Describe one supported rule at a time: people in a zone, vehicle counting, or visible machine activity.')
    capability = 'machine_activity' if machine else 'traffic' if traffic else 'zone'
    match = re.search(r'(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b', text)
    words = {'one': 1, 'two': 2, 'three': 3, 'five': 5, 'ten': 10}
    dwell = float(match.group(1)) if match else next((v for k, v in words.items() if f'{k} seconds' in text), 2)
    if not 0.2 <= dwell <= 120:
        raise HTTPException(422, 'Dwell must be between 0.2 and 120 seconds')
    return {'capability': capability, 'dwell_seconds': dwell, 'parser': 'constrained local parser',
            'model': 'OpenCV ROI motion proxy' if machine else 'YOLOv8 Nano + ByteTrack',
            'warnings': ['No vision agent has inspected the preview. Review the suggested rule and any geometry.', 'Recipients are selected from configured contacts; language cannot authorize delivery.'] + (['Visible motion is not proof of electrical on/off state.'] if machine else [])}


@app.post('/api/runs', status_code=202)
def create_run(body: RunRequest, identity=Depends(owner)):
    check_model(body.rule)
    check_recipients(body.rule)
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
        session.flush()
        if approval:
            session.add(RunSummary(id=run.id, owner=identity, payload=approval))
        session.commit()
        log.info('Queued analysis %s', run.id)
        return serialize(run)


@app.get('/api/runs')
def runs(identity=Depends(owner)):
    with Session() as session:
        rows = list(session.scalars(select(Run).where(Run.owner == identity).order_by(Run.created.desc()).limit(100)))
        summaries = {x.id: x for x in session.scalars(select(RunSummary).where(
            RunSummary.owner == identity, RunSummary.id.in_([row.id for row in rows])))} if rows else {}
        return [{**serialize(row), 'vision_summary': vision.review_view(summaries.get(row.id))} for row in rows]


@app.get('/api/runs/{run_id}')
def get_run(run_id: str, identity=Depends(owner)):
    with Session() as session:
        row = owned(session, Run, run_id, identity)
        return {**serialize(row), 'vision_summary': vision.review_view(session.get(RunSummary, row.id))}


@app.post('/api/runs/{run_id}/crossings/{track_id}/review')
def review_crossing(run_id: str, track_id: int, body: CrossingReviewRequest, identity=Depends(owner)):
    with Session() as session:
        if session.bind.dialect.name == 'sqlite':
            session.execute(text('BEGIN IMMEDIATE'))
        else:
            session.execute(select(Run).where(Run.id == run_id, Run.owner == identity).with_for_update())
        row = owned(session, Run, run_id, identity)
        if row.status != 'completed' or not any(x['track_id'] == track_id for x in row.payload.get('crossings', [])):
            raise HTTPException(404, 'Recorded crossing not found')
        reviews = dict(row.payload.get('crossing_reviews', {}))
        reviews[str(track_id)] = {'action': body.action, 'note': body.note, 'reviewed_at': time.time()}
        row.payload = {**row.payload, 'crossing_reviews': reviews}
        session.commit()
        return {'track_id': track_id, **reviews[str(track_id)]}


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


_last_alert_test = 0.0


def notification_administrator(identity=Depends(owner)):
    """Allow the verified local workspace to test Telegram without key entry."""
    if not secrets.compare_digest(identity, hashlib.sha256(TOKEN.encode()).hexdigest()):
        raise HTTPException(403, 'Telegram setup checks are available only to the administrator workspace')
    return identity


@app.get('/api/notifications/status')
def notification_status(identity=Depends(notification_administrator)):
    """Explicit non-sending Telegram connectivity check. Never exposes the bot token."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_IDS:
        return {'configured': False, 'reachable': None,
                'detail': 'Set TELEGRAM_BOT_TOKEN and ZENITH_TELEGRAM_CHATS on the backend, then restart.'}
    reachable, detail = telegram_probe()
    return {'configured': True, 'reachable': reachable, 'detail': detail}


@app.post('/api/notifications/test')
def test_alert(identity=Depends(notification_administrator)):
    """Send one explicit setup check to each allowlisted Telegram chat. Never returns the bot token."""
    global _last_alert_test
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_IDS:
        raise HTTPException(409, 'Telegram is not configured. Set TELEGRAM_BOT_TOKEN and ZENITH_TELEGRAM_CHATS on the backend, then restart it.')
    if time.time() - _last_alert_test < 10:
        raise HTTPException(429, 'Wait a few seconds before sending another test alert')
    _last_alert_test = time.time()
    bot_ok, bot_detail = telegram_probe()
    if not bot_ok:
        return {'bot': bot_detail, 'results': []}
    text = ('Zenith test alert\n'
            'Telegram delivery is configured. No incident occurred: this is a setup check.\n'
            'Keep this chat private; alerts can contain site and footage details.')
    results = []
    for chat in TELEGRAM_CHAT_IDS:
        delivered, retryable, detail = telegram_send(chat, text)
        results.append({'chat': chat, 'delivered': delivered, 'detail': detail,
                        **({'retryable': True} if retryable else {})})
    return {'bot': bot_detail, 'results': results}


def carbon_values(body, session, identity):
    values = body.model_dump()
    if body.factor_id:
        factor = owned(session, EmissionFactor, body.factor_id, identity)
        details = factor.payload
        if details['kind'] != body.kind or (body.kind == 'traffic' and details['vehicle_class'] != body.vehicle_class):
            raise HTTPException(400, 'Saved factor does not match this activity and vehicle class')
        values['factor'] = details['factor']
        values['factor_source'] = f"{details['source']} · {details['region']} · {details['year']} · saved factor {factor.id}"
    if body.run_id:
        run = owned(session, Run, body.run_id, identity)
        if run.status != 'completed':
            raise HTTPException(400, 'Only completed runs can supply carbon activity data')
        if body.kind == 'traffic':
            if run.payload['rule']['capability'] != 'traffic' or not body.vehicle_class:
                raise HTTPException(400, 'Select a traffic run and vehicle class')
            distance = run.payload['rule'].get('segment_metres')
            if distance is not None:
                values['distance_km'] = distance / 1000
            raw_count = run.payload.get('counts', {}).get(body.vehicle_class, 0)
            dismissed = sum(1 for crossing in run.payload.get('crossings', [])
                if crossing['vehicle_class'] == body.vehicle_class and
                run.payload.get('crossing_reviews', {}).get(str(crossing['track_id']), {}).get('action') == 'false_positive')
            values['quantity'] = max(0, raw_count - dismissed)
            if dismissed:
                values['basis'] = (f'{dismissed} operator-reviewed false positive crossing(s) excluded '
                                   f'from {raw_count} raw {body.vehicle_class} crossings. ' + body.basis)
        elif body.kind == 'electricity':
            if run.payload['rule']['capability'] != 'machine_activity':
                raise HTTPException(400, 'Select an equipment activity run')
            if body.metered_kwh is None:
                if not body.accept_activity_proxy:
                    raise HTTPException(400, 'Explicitly accept the visible-motion runtime proxy')
                values['hours'] = run.payload.get('activity_seconds', 0) / 3600
                values['basis'] = f'Unvalidated visible-motion proxy from run {run.id}. ' + body.basis
            else:
                values['basis'] = 'Operator-supplied metered energy. ' + body.basis
        else:
            raise HTTPException(400, 'Fuel entries require measured or operator-provided litres')
        values['coverage'] = run.payload.get('coverage', 'unknown')
    else:
        values['coverage'] = 'operator-supplied activity; not independently verified'
    if body.metered_kwh is not None:
        kg = body.metered_kwh * values['factor']
        formula = f"{body.metered_kwh:g} kWh × {values['factor']:g} kg CO2e/kWh"
        if not body.run_id:
            values['basis'] = 'Operator-supplied metered energy. ' + body.basis
    elif body.kind == 'electricity':
        kg = values['quantity'] * values['hours'] * body.load_fraction * values['factor']
        formula = f"{values['quantity']:g} kW × {values['hours']:.6g} h × {body.load_fraction:g} load × {values['factor']:g} kg CO2e/kWh"
    elif body.kind == 'fuel':
        kg = values['quantity'] * values['factor']
        formula = f"{values['quantity']:g} L × {values['factor']:g} kg CO2e/L"
    else:
        kg = values['quantity'] * values['distance_km'] * values['factor'] / 1000
        formula = f"{values['quantity']:g} vehicles × {values['distance_km']:g} km × {values['factor']:g} g CO2/vehicle-km ÷ 1000"
    return {**values, 'kg': kg, 'formula': formula, 'label': 'CO2 estimate' if body.kind == 'traffic' else 'CO2e estimate'}


@app.post('/api/carbon/preview')
def preview_carbon(body: CarbonRequest, identity=Depends(owner)):
    with Session() as session:
        return carbon_values(body, session, identity)


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


@app.get('/api/carbon/factors')
def emission_factors(identity=Depends(owner)):
    with Session() as session:
        return [serialize(x) for x in session.scalars(select(EmissionFactor).where(
            EmissionFactor.owner == identity).order_by(EmissionFactor.created.desc()).limit(50))]


@app.post('/api/carbon/factors', status_code=201)
def add_emission_factor(body: EmissionFactorRequest, identity=Depends(owner)):
    with Session() as session:
        if session.scalar(select(func.count()).select_from(EmissionFactor).where(EmissionFactor.owner == identity)) >= 50:
            raise HTTPException(429, 'Maximum 50 saved factors per operator')
        row = EmissionFactor(owner=identity, payload=body.model_dump())
        session.add(row)
        session.commit()
        return serialize(row)


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
