"""One leased file-analysis worker. Run with python -m backend.worker."""
import hashlib
import json
import logging
import os
import threading
import time
import uuid
from collections import deque
from pathlib import Path

import cv2
import httpx
import numpy as np
from sqlalchemy import or_, select, update

from .alerts import telegram_send, telegram_send_photo
from .config import ALL_RECIPIENTS, DATA, TELEGRAM_BOT_TOKEN, TELEGRAM_SEND_EVIDENCE, VISION_AUTO_LIMIT, telegram_chat
from .db import Incident, Notification, Run, Session, Source, VisionReview, init_db
from .vision import process_one_review, process_one_summary

log = logging.getLogger('zenith.worker')
logging.basicConfig(level=logging.INFO)


def claim():
    now = time.time()
    eligible = or_(Run.status == 'queued', (Run.status == 'processing') & (Run.lease < now))
    with Session() as session:
        candidate = session.scalar(select(Run.id).where(eligible).order_by(Run.created).limit(1))
        if not candidate:
            return None
        token = str(uuid.uuid4())
        result = session.execute(update(Run).where(Run.id == candidate, eligible).values(status='processing', lease=now + 90, lease_token=token))
        session.commit()
        if not result.rowcount:
            return None
        row = session.get(Run, candidate)
        attempts = row.payload.get('attempts', 0) + 1
        row.payload = {**row.payload, 'attempts': attempts, 'stage': 'Loading analysis pipeline', 'progress': 0}
        if attempts > 3:
            row.status = 'failed'
            row.payload = {**row.payload, 'error': 'Worker interrupted repeatedly; create a new run', 'coverage': 'incomplete'}
            session.commit()
            return None
        session.commit()
        return row.id, token


def update_run(run_id, token, **changes):
    with Session() as session:
        row = session.get(Run, run_id)
        if row.lease_token != token or row.status != 'processing':
            raise RuntimeError('Worker lease lost')
        status = changes.pop('status', None)
        row.payload = {**row.payload, **changes}
        row.lease = time.time() + 90
        if status:
            row.status = status
        session.commit()


def rule_fingerprint(rule):
    """Stable identity for one rule; recipients and cooldown do not change what is detected."""
    tracked = {key: value for key, value in rule.items()
               if key not in {'recipients', 'recipient', 'alert_cooldown_seconds', 'confirmed'}}
    return hashlib.sha256(json.dumps(tracked, sort_keys=True).encode()).hexdigest()[:32]


def recent_alert(session, owner, rule_key, since):
    """Most recent alert for this exact rule inside the cooldown window."""
    rows = session.scalars(select(Notification).where(
        Notification.owner == owner, Notification.created >= since,
        Notification.status.in_(['pending', 'retry', 'sent', 'preview'])).order_by(Notification.created.desc()).limit(200))
    return next((row for row in rows if row.payload.get('rule_key') == rule_key), None)


def save_incident(run, token, frame_index, timestamp, title, detail, frames, auto_review):
    event_id = hashlib.sha256(f'{run.id}:{frame_index}:{title}:{detail}'.encode()).hexdigest()[:40]
    with Session() as session:
        current = session.get(Run, run.id)
        if current.lease_token != token:
            raise RuntimeError('Worker lease lost')
        if session.get(Incident, event_id):
            return event_id
        rule = run.payload['rule']
        names = []
        named = []
        for label, image in frames:
            name = f'{event_id}-{label}.jpg'
            if cv2.imwrite(str(DATA / 'evidence' / name), image):
                names.append(name)
                named.append((label, name))
        # Only allowlisted recipients become notification rows. A stopped/expired config cannot leak delivery.
        recipients = [recipient for recipient in rule.get('recipients', []) if recipient in ALL_RECIPIENTS]
        cooldown = float(rule.get('alert_cooldown_seconds', 300))
        fingerprint = rule_fingerprint(rule)
        previous = (recent_alert(session, run.owner, fingerprint, time.time() - cooldown)
                    if recipients and cooldown > 0 else None)
        notification_ids = {recipient: hashlib.sha256(f'{event_id}:{recipient}'.encode()).hexdigest()[:48]
                            for recipient in recipients}
        if not recipients:
            alert = {'status': 'not_requested', 'rule_key': fingerprint}
        elif previous is not None:
            # Keep the incident and evidence, but do not create another outbox row.
            alert = {'status': 'suppressed', 'reason': 'cooldown', 'rule_key': fingerprint,
                     'recipients': recipients, 'cooldown_seconds': cooldown,
                     'last_alert_at': previous.created, 'suppressed_until': previous.created + cooldown,
                     'notification_ids': []}
        else:
            alert = {'status': 'queued', 'rule_key': fingerprint, 'recipients': recipients,
                     'cooldown_seconds': cooldown,
                     'notification_ids': [notification_ids[recipient] for recipient in recipients]}
        event = Incident(id=event_id, owner=run.owner, run_id=run.id, payload={
            'run_id': run.id, 'source_id': run.payload['source_id'], 'source_name': run.payload['source_name'],
            'source_seconds': round(timestamp, 3), 'processed_at': time.time(), 'title': title, 'detail': detail,
            'severity': 'review' if run.payload['rule']['capability'] == 'machine_activity' else 'attention',
            'rule_version': 'v2', 'rule_name': run.payload['rule']['name'], 'frames': names,
            'detector_settings': {key: run.payload['rule'].get(key) for key in ('confidence', 'image_size', 'iou_threshold', 'analysis_fps', 'vehicle_classes')},
            'ai_review': 'not_enabled', 'operator_status': 'suspected', 'history': [], 'alert': alert})
        session.add(event)
        if auto_review and names:
            session.add(VisionReview(id=event_id, owner=run.owner, run_id=run.id, payload=auto_review))
        if alert['status'] == 'queued':
            evidence = next((name for label, name in named if label == 'during'), names[0] if names else None)
            text = (f"{title}\nSource: {run.payload['source_name']}\nVideo offset: {timestamp:.2f}s\n"
                    f"Rule: {run.payload['rule']['name']}\n{detail}\n"
                    'Verify the footage and follow your site response procedure.')
            for recipient in recipients:
                notification_id = notification_ids[recipient]
                if session.get(Notification, notification_id):
                    continue
                session.add(Notification(id=notification_id, owner=run.owner, status='pending', payload={
                    'event_id': event_id, 'recipient': recipient, 'subject': f'[Zenith] {title}', 'text': text,
                    'rule_key': fingerprint, 'cooldown_seconds': cooldown,
                    'evidence': evidence, 'attempts': 0}))
        # Incident, alert state and every outbox row commit together.
        session.commit()
        return event_id


def add_after(event_id, image):
    with Session() as session:
        row = session.get(Incident, event_id)
        if not row:
            return
        name = f'{event_id}-after.jpg'
        if name not in row.payload['frames'] and cv2.imwrite(str(DATA / 'evidence' / name), image):
            row.payload = {**row.payload, 'frames': [*row.payload['frames'], name]}
            session.commit()


def crossed(a, b, c, d):
    def orientation(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0])
    return orientation(c, d, a)*orientation(c, d, b) < 0 and orientation(a, b, c)*orientation(a, b, d) <= 0


def run_findings(rule, counts, activity_seconds, event_count, coverage):
    """Always-available, source-bound summary; no invented model observations."""
    capability = rule['capability']
    if capability == 'traffic':
        breakdown = ', '.join(f'{name}: {count}' for name, count in counts.items() if count)
        total = sum(counts.values())
        result = f'{total} tracked vehicle crossing(s) at the configured line.'
        if breakdown:
            result += f' Classes: {breakdown}.'
    elif capability == 'zone':
        result = f'{event_count} suspected zone-dwell observation(s) at the configured region.'
    else:
        result = (f'{activity_seconds:.2f} seconds of detected visible motion in the configured region; '
                  f'{event_count} motion observation(s). This is not an electrical ON/OFF measurement.')
    return {'summary': result, 'limitations': f'{coverage}. Review source footage and geometry; detections are not verified.',
            'basis': 'rule results, not an AI reading of the full video', 'incident_count': event_count}


def detection_classes(rule, names):
    """Resolve checkpoint labels instead of assuming every checkpoint uses COCO IDs."""
    labels = names if isinstance(names, dict) else dict(enumerate(names))
    requested = ['person'] if rule['capability'] == 'zone' else rule.get('vehicle_classes', ['car', 'motorcycle', 'bus', 'truck'])
    by_name = {name: index for index, name in labels.items()}
    missing = [name for name in requested if name not in by_name]
    if missing:
        raise ValueError('The configured YOLO checkpoint does not provide required classes: ' + ', '.join(missing))
    return [by_name[name] for name in requested]


def analyze(run_id, token):
    with Session() as session:
        run = session.get(Run, run_id)
        source = session.get(Source, run.payload['source_id'])
    rule = run.payload['rule']
    cap = cv2.VideoCapture(str(DATA / 'sources' / source.payload['file']))
    model = None
    try:
        if rule['capability'] != 'machine_activity':
            from ultralytics import YOLO
            model = YOLO(os.getenv('ZENITH_MODEL', 'yolov8n.pt'))
        classes = detection_classes(rule, model.names) if model is not None else []
        fps = source.payload['fps']
        step = max(1, round(fps / rule.get('analysis_fps', 8)))
        update_run(run_id, token, analysis_settings={
            'engine': 'OpenCV ROI motion' if model is None else 'YOLO + ByteTrack',
            'checkpoint': None if model is None else os.path.basename(os.getenv('ZENITH_MODEL', 'yolov8n.pt')),
            'confidence': rule.get('confidence', 0.3), 'image_size': rule.get('image_size', 640),
            'iou_threshold': rule.get('iou_threshold', 0.7), 'requested_fps': rule.get('analysis_fps', 8),
            'classes': ['person'] if rule['capability'] == 'zone' else rule.get('vehicle_classes', ['car', 'motorcycle', 'bus', 'truck']) if model is not None else [],
        })
        points = np.array(rule['points'], dtype=np.float32)
        index = 0
        last_t = None
        last_gray = None
        in_zone = {}
        previous = {}
        counted = set()
        counts = {name: 0 for name in ('car', 'motorcycle', 'bus', 'truck')}
        directions = {'A→B': 0, 'B→A': 0}
        crossings = []
        history = deque(maxlen=18)
        pending_after = []
        activity_start = None
        activity_seconds = 0.0
        activity_reported = False
        event_count = 0
        frame_gaps = False
        timestamp_fallback = False
        last_saved = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_index = index
            index += 1
            if frame_index % step:
                continue
            native_t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            timestamp = native_t
            if native_t < 0 or (last_t is not None and native_t <= last_t):
                timestamp = frame_index / fps
                timestamp_fallback = True
            if last_t is not None and timestamp <= last_t:
                raise ValueError('Non-monotonic source timestamps; re-encode the clip before analysis')
            if timestamp > source.payload['duration'] + 1:
                break
            dt = timestamp - last_t if last_t is not None else 0
            if dt > 0.75:
                frame_gaps = True
                # Missing footage cannot establish continuous dwell or a crossing.
                in_zone.clear()
                previous.clear()
                last_gray = None
                activity_start = None
                activity_reported = False
                # Do not infer sustained dwell or a line crossing through unobserved time.
                in_zone.clear()
                previous.clear()
                activity_start = None
                activity_reported = False
                last_gray = None
            scale = min(1, max(960, rule.get('image_size', 640)) / max(frame.shape[:2]))
            if scale < 1:
                frame = cv2.resize(frame, (round(frame.shape[1]*scale), round(frame.shape[0]*scale)))
            height, width = frame.shape[:2]
            polygon = (points * [width, height]).astype(np.int32)
            annotated = frame.copy()
            if rule['capability'] == 'traffic':
                cv2.line(annotated, tuple(polygon[0]), tuple(polygon[1]), (180, 230, 70), 3)
            else:
                overlay = annotated.copy()
                cv2.fillPoly(overlay, [polygon], (100, 180, 40))
                annotated = cv2.addWeighted(overlay, 0.18, annotated, 0.82, 0)
                cv2.polylines(annotated, [polygon], True, (180, 230, 70), 2)
            signals = []
            if model is not None:
                result = model.track(frame, persist=True, tracker='bytetrack.yaml', classes=classes,
                                     conf=rule.get('confidence', 0.3), iou=rule.get('iou_threshold', 0.7),
                                     verbose=False, imgsz=rule.get('image_size', 640))[0]
                active = set()
                if result.boxes is not None and result.boxes.id is not None:
                    for box, track_id, cls in zip(result.boxes.xyxy.cpu().numpy(), result.boxes.id.int().cpu().tolist(), result.boxes.cls.int().cpu().tolist()):
                        active.add(track_id)
                        x1, y1, x2, y2 = [int(v) for v in box]
                        foot = ((x1+x2)/2/width, y2/height)
                        cv2.rectangle(annotated, (x1,y1), (x2,y2), (90,230,170), 2)
                        label = result.names[cls]
                        cv2.putText(annotated, f'{label} #{track_id}', (x1,max(20,y1-7)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (90,230,170), 1)
                        if rule['capability'] == 'zone':
                            inside = cv2.pointPolygonTest(points, foot, False) >= 0
                            if inside:
                                start, fired = in_zone.get(track_id, (timestamp, False))
                                if timestamp-start >= rule['dwell_seconds'] and not fired:
                                    signals.append(('Restricted-zone dwell', f"Person track {track_id} remained inside the confirmed zone for at least {rule['dwell_seconds']:g}s. Suspected rule observation; operator verification required."))
                                    fired = True
                                in_zone[track_id] = (start, fired)
                            else:
                                in_zone.pop(track_id, None)
                        else:
                            prev = previous.get(track_id)
                            if prev and track_id not in counted and timestamp-prev[1] < 0.75 and crossed(prev[0], foot, points[0], points[1]):
                                counts[label] += 1
                                side = (points[1][0]-points[0][0])*(foot[1]-points[0][1])-(points[1][1]-points[0][1])*(foot[0]-points[0][0])
                                direction = 'A→B' if side > 0 else 'B→A'
                                directions[direction] += 1
                                if len(crossings) < 1000:
                                    crossings.append({
                                        'source_seconds': round(timestamp, 3), 'track_id': track_id,
                                        'vehicle_class': label, 'direction': direction,
                                        'box': [x1 / width, y1 / height, x2 / width, y2 / height],
                                    })
                                counted.add(track_id)
                            previous[track_id] = (foot, timestamp)
                in_zone = {k:v for k,v in in_zone.items() if k in active}
                previous = {k:v for k,v in previous.items() if timestamp-v[1] < 1}
            else:
                gray = cv2.GaussianBlur(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (5,5), 0)
                mask = np.zeros(gray.shape, dtype=np.uint8)
                cv2.fillPoly(mask, [polygon], 255)
                fraction = 0.0
                if last_gray is not None and dt <= 0.75:
                    difference = cv2.absdiff(gray, last_gray)
                    fraction = np.count_nonzero((difference > 20) & (mask > 0)) / max(1, np.count_nonzero(mask))
                moving = fraction >= rule['motion_threshold']
                if moving:
                    activity_seconds += dt
                    if activity_start is None:
                        activity_start = timestamp
                    if timestamp-activity_start >= rule['dwell_seconds'] and not activity_reported:
                        signals.append(('Visible equipment activity', 'Sustained pixel motion in the configured region. This is an unvalidated activity proxy, not proof that equipment is powered on. People, lighting and camera movement can cause false activity.'))
                        activity_reported = True
                else:
                    activity_start = None
                    activity_reported = False
                last_gray = gray
                cv2.putText(annotated, f'MOTION PROXY {fraction:.1%} | NOT POWER STATE', (14,30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (90,230,170), 2)
            cv2.putText(annotated, f'SOURCE {timestamp:.2f}s', (14,height-16), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 2)
            for event_id, due in list(pending_after):
                if timestamp >= due:
                    add_after(event_id, annotated)
                    pending_after.remove((event_id, due))
            for title, detail in signals:
                if event_count >= 100:
                    raise ValueError('Incident limit reached; shorten the clip or tune the rule. Coverage is incomplete.')
                before = next((image for t, image in reversed(history) if t <= timestamp-1), None)
                frames = ([('before', before)] if before is not None else []) + [('during', annotated)]
                event_id = save_incident(run, token, frame_index, timestamp, title, detail, frames,
                                         run.payload.get('vision_authorization') if event_count < VISION_AUTO_LIMIT else None)
                pending_after.append((event_id, timestamp+1))
                event_count += 1
            history.append((timestamp, annotated.copy()))
            last_t = timestamp
            if time.monotonic()-last_saved > 2:
                update_run(run_id, token, progress=min(99, round(timestamp/source.payload['duration']*100)), stage='Analyzing source frames', source_seconds=timestamp, counts=counts, directions=directions, activity_seconds=round(activity_seconds,3))
                last_saved = time.monotonic()
        if last_t is None:
            raise ValueError('No frames decoded')
        if last_t < source.payload['duration'] - max(1, 2*step/fps):
            raise ValueError('Video decode ended before expected duration; coverage incomplete')
        # Do not manufacture an after frame if the source ended before it existed.
        coverage = 'partial: source frame gaps' if frame_gaps else 'sampled file coverage; detector accuracy unvalidated'
        update_run(run_id, token, status='completed', progress=100, stage='Analysis complete', counts=counts, directions=directions,
                    activity_seconds=round(activity_seconds,3), source_seconds=last_t,
                    coverage=coverage, findings=run_findings(rule, counts, activity_seconds, event_count, coverage),
                   timestamp_basis='frame index / metadata FPS fallback (re-encode variable-rate sources)' if timestamp_fallback else 'decoded source timestamps',
                   analysis_fps=round(fps/step,2), completed_at=time.time(),
                   **({'crossings': crossings} if rule['capability'] == 'traffic' else {}))
    finally:
        cap.release()


def deliver_notifications():
    with Session() as session:
        rows = list(session.scalars(select(Notification).where(Notification.status.in_(['pending', 'retry'])).limit(10)))
        for row in rows:
            payload = row.payload
            if payload.get('next_attempt', 0) > time.time():
                continue
            recipient = payload['recipient']
            if recipient not in ALL_RECIPIENTS:
                row.status = 'blocked'
                session.commit()
                continue
            chat = telegram_chat(recipient)
            key = os.getenv('RESEND_API_KEY')
            sender = payload.get('sender') or os.getenv('ZENITH_FROM_EMAIL')
            if chat is not None:
                if not TELEGRAM_BOT_TOKEN:
                    row.status = 'preview'
                    session.commit()
                    continue
            elif not key or not sender:
                row.status = 'preview'
                session.commit()
                continue
            attempts = payload.get('attempts', 0) + 1
            if attempts > 3 or time.time()-row.created > 23*3600:
                row.status = 'needs_reconciliation'
                session.commit()
                continue
            channel = 'telegram' if chat is not None else 'email'
            row.payload = {**payload, 'channel': channel, 'attempts': attempts,
                           'next_attempt': time.time() + 30*2**attempts, **({'sender': sender} if sender else {})}
            # Persist the attempt BEFORE network I/O so a crash is visible as an uncertain delivery.
            row.status = 'retry'
            session.commit()
            if chat is not None:
                # Telegram has no idempotency key: a crash after send can duplicate one alert.
                evidence = str(payload.get('evidence') or '')
                path = DATA / 'evidence' / Path(evidence).name if evidence else None
                if TELEGRAM_SEND_EVIDENCE and path is not None and path.is_file() and not payload.get('photo_rejected'):
                    delivered, retryable, detail = telegram_send_photo(chat, path, payload['text'])
                    if not delivered and not retryable:
                        # A permanently rejected photo must not cost the alert; retry as text.
                        row.payload = {**row.payload, 'photo_rejected': True, 'photo_error': detail}
                        delivered, retryable, detail = telegram_send(chat, payload['text'])
                        detail = f'Evidence photo rejected; text alert: {detail}'
                else:
                    delivered, retryable, detail = telegram_send(chat, payload['text'])
                if delivered:
                    row.status = 'sent'
                    row.payload = {**row.payload, 'delivery': detail}
                elif retryable:
                    log.warning('Telegram outcome uncertain; will retry')
                else:
                    row.status = 'failed'
                    row.payload = {**row.payload, 'error': detail}
                session.commit()
                continue
            try:
                response = httpx.post('https://api.resend.com/emails', headers={'Authorization': f'Bearer {key}', 'Idempotency-Key': f'zenith-{row.id}'}, json={'from': sender, 'to': [payload['recipient']], 'subject': payload['subject'], 'text': payload['text']}, timeout=15)
                if response.is_success:
                    row.status = 'sent'
                    row.payload = {**row.payload, 'provider_id': response.json().get('id'), 'delivery': 'provider accepted; delivery not verified'}
                elif response.status_code < 500 and response.status_code != 429:
                    row.status = 'failed'
                    row.payload = {**row.payload, 'error': f'Provider rejected request ({response.status_code})'}
            except httpx.HTTPError:
                log.warning('Email outcome uncertain; will retry with stable idempotency key')
            session.commit()


def main():
    init_db()
    current = {'run_id': None, 'token': None}
    def heartbeat():
        while True:
            try:
                (DATA / 'worker.heartbeat').touch()
                if current['run_id']:
                    with Session() as session:
                        session.execute(update(Run).where(Run.id == current['run_id'], Run.lease_token == current['token'], Run.status == 'processing').values(lease=time.time()+90))
                        session.commit()
            except Exception:
                log.exception('Heartbeat failed')
            time.sleep(10)
    threading.Thread(target=heartbeat, daemon=True).start()
    def notification_loop():
        while True:
            try:
                deliver_notifications()
            except Exception:
                log.exception('Notification processing failed')
            time.sleep(1)
    threading.Thread(target=notification_loop, daemon=True).start()
    while True:
        job = claim()
        if job:
            run_id, token = job
            current.update(run_id=run_id, token=token)
            try:
                analyze(run_id, token)
            except Exception as exc:
                log.exception('Analysis failed for %s', run_id)
                try:
                    update_run(run_id, token, status='failed', stage='Analysis failed', error=str(exc)[:300], coverage='incomplete')
                except Exception:
                    log.exception('Could not persist failure')
            finally:
                current.update(run_id=None, token=None)
        else:
            try:
                process_one_review()
                process_one_summary()
            except Exception:
                log.exception('Vision review queue processing failed')
        time.sleep(1)


if __name__ == '__main__':
    main()
