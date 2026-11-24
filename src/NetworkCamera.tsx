import { useEffect, useRef, useState } from 'react';
import { json, request } from './api';
import type { DetectorOptions, Point, Rule, Status, VisionStatus } from './types';
import { cameraClipState } from './workflow';

export type StreamRule = Omit<Rule, 'points' | 'confirmed'> & DetectorOptions;

export default function NetworkCamera({camera, rule, vision, workerOnline, actionReady, connected, notify, refresh, endpoint='/cameras/rtsp', saveEndpoint, initialPoints=[]}: {
  camera: NonNullable<Status['camera']>; rule: StreamRule; workerOnline: boolean; actionReady: boolean; connected: boolean;
  vision?: VisionStatus;
  endpoint?: string;
  saveEndpoint?: string;
  initialPoints?: Point[];
  notify: (message: string) => void; refresh: () => void;
}) {
  const [preview, setPreview] = useState('');
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [approval, setApproval] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(false);
  const pending = useRef<AbortController | null>(null);
  // Uploaded-video geometry/confirmation must never authorize a network stream.
  const signature = JSON.stringify({capability: rule.capability, name: rule.name, instruction: rule.instruction,
    dwell_seconds: rule.dwell_seconds, motion_threshold: rule.motion_threshold, recipients: rule.recipients,
    alert_cooldown_seconds: rule.alert_cooldown_seconds,
    confidence: rule.confidence, image_size: rule.image_size, iou_threshold: rule.iou_threshold,
    analysis_fps: rule.analysis_fps, vehicle_classes: rule.vehicle_classes, action_confidence: rule.action_confidence});
  const currentApproval = JSON.stringify([signature, points, preview, review, vision?.provider, vision?.model]);
  const confirmed = approval === currentApproval;
  const action = rule.capability === 'action';
  const enough = action ? actionReady : rule.capability === 'traffic' ? points.length === 2 : points.length >= 3;
  const restartable = ['stopped', 'capture failed', 'storage or source limit reached; archive clips before restarting'].includes(camera.state);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const previousCapability = useRef(rule.capability);
  useEffect(() => {
    if (previousCapability.current !== rule.capability) setPoints([]);
    previousCapability.current = rule.capability;
    setApproval('');
  }, [rule.capability]);
  useEffect(() => { setApproval(''); }, [signature, points, preview]);
  useEffect(() => { setReview(false); setApproval(''); }, [vision?.provider, vision?.model, vision?.available, connected]);

  async function loadPreview() {
    const controller = new AbortController();
    pending.current?.abort(); pending.current = controller;
    setBusy(true); setApproval('');
    try {
      const blob = await (await request(`${endpoint}/preview`, {signal: controller.signal})).blob();
      if (!controller.signal.aborted) setPreview(URL.createObjectURL(blob));
    } catch (error) { if (!controller.signal.aborted) notify((error as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function control(action: 'start' | 'stop') {
    const controller = new AbortController(); pending.current = controller;
    setBusy(true);
    try {
      await json(`${endpoint}/${action}`, {method: 'POST', signal: controller.signal,
        ...(action === 'start' ? {body: JSON.stringify({rule: {...JSON.parse(signature), points, confirmed},
          ...(review&&vision?.available?{vision_provider:vision.provider,vision_consent:vision.provider!=='local'}:{})})} : {})});
      if (!controller.signal.aborted) {
        refresh(); notify(action === 'start' ? 'Stream capture started. Short-clip findings appear in Video findings; tracking resets for each clip.' : 'Stream capture stopping.');
      }
    } catch (error) { if (!controller.signal.aborted) notify((error as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function saveRule() {
    if (!saveEndpoint) return;
    setSaving(true);
    try {
      await json(saveEndpoint, {method: 'POST', body: JSON.stringify({
        rule: {...JSON.parse(signature), points, confirmed},
      })});
      notify('Incident rule saved for this camera.');
      refresh();
    } catch (error) { notify((error as Error).message); }
    finally { setSaving(false); }
  }

  return <section className="camera-capture network-camera" aria-label="Network stream analysis">
    <h3>Incident rule & clip analysis · {camera.protocol || 'YouTube / RTSP / HLS'}</h3>
    {!camera.configured&&<p className="info-note">No network source configured. Set <code>ZENITH_YOUTUBE_URL</code>, <code>ZENITH_CAMERA_URL</code> or <code>ZENITH_RTSP_URL</code> in the private backend environment and restart. <a className="text-link" href="#settings">Open health checks & setup →</a></p>}
    <p className="small-note">Records short clips ({camera.clip_seconds ?? 5}s for counting; longer when the dwell setting needs it) for the selected detector, action model or motion proxy. This is not a live annotated feed: use the optional preview above for boxes. Tracking resets per clip, and capture/queue gaps can miss events. YouTube adds playback delay. AI review is optional; Telegram evidence sharing is configured separately on the backend.</p>
    <p className="camera-rule-progress" aria-hidden="true"><span className={preview ? 'done' : ''}>1 · Preview frame</span><span className={confirmed ? 'done' : ''}>2 · Draw & review</span><span>3 · Save or start</span></p>
    <p role="status"><strong>Clip analysis:</strong> {cameraClipState(camera.state)}{camera.last_clip_at ? ` · last clip ${new Date(camera.last_clip_at * 1000).toLocaleString()}` : ''}</p>
    <div className="action-row">
      <button type="button" className="button secondary" disabled={!connected || !camera.configured || busy} onClick={() => void loadPreview()}>{preview ? 'Refresh preview frame' : '1 · Get preview frame'}</button>
      {saveEndpoint && <button type="button" className="button secondary" disabled={!connected || busy || saving || !confirmed || !enough || !rule.name.trim()} onClick={() => void saveRule()}>{saving ? 'Saving rule…' : '2 · Save rule'}</button>}
      <button type="button" className="button primary" disabled={!connected || !camera.configured || busy || !workerOnline || !preview || !confirmed || !enough || !rule.name.trim() || !restartable} onClick={() => void control('start')}>3 · Start clip analysis</button>
      <button type="button" className="button secondary" disabled={!connected || busy || restartable || camera.state === 'in use by another operator'} onClick={() => void control('stop')}>Stop clip analysis</button>
    </div>
    <p className="small-note">Save rule stores this rule without starting capture. Start clip analysis stores it and records short clips for the worker; findings appear in Video findings.</p>
    {preview && <>
      <div className="video-stage rtsp-preview"><img src={preview} alt="Current network stream frame"/>
        {!action&&<svg className="geometry" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Click to draw stream geometry" onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (points.length < (rule.capability === 'traffic' ? 2 : 12)) setPoints([...points, [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]]);
        }}>
          {points.length > 1 && (rule.capability === 'traffic' ? <polyline points={points.map(([x,y]) => `${x*1000},${y*1000}`).join(' ')}/> : <polygon points={points.map(([x,y]) => `${x*1000},${y*1000}`).join(' ')}/>)}
          {points.map(([x,y], i) => <circle key={i} cx={x*1000} cy={y*1000} r="7"/>)}
        </svg>}
      </div>
      {!action&&<><div className="geometry-toolbar"><span>Draw a separate stream {rule.capability === 'traffic' ? 'line (2 points)' : 'region (3–12 points)'}. {points.length} points.</span><div>
        <button type="button" className="text-button" onClick={() => setPoints(points.slice(0,-1))}>Undo stream point</button>
        <button type="button" className="text-button" onClick={() => setPoints([])}>Clear stream geometry</button>
      </div></div>
      <details className="coordinate-editor"><summary>Edit stream coordinates with keyboard</summary>
        <textarea aria-label="Stream coordinates" key={JSON.stringify(points)} defaultValue={points.map(p => p.join(', ')).join('\n')} onBlur={event => {
          const rows = event.target.value.trim().split('\n').filter(Boolean).map(line => line.split(',').map(Number));
          if (rows.length <= 12 && rows.every(p => p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) setPoints(rows as Point[]);
          else notify('Stream coordinates must be x,y pairs between 0 and 1.');
        }}/>
      </details></>}
      {action&&<p className="small-note">{actionReady?"The action model watches the full frame.":"Install the action checkpoint in Settings."}</p>}
      {vision&&<label className="checkbox"><input type="checkbox" checked={review} disabled={!vision.available} onChange={event=>setReview(event.target.checked)}/>
        {vision.available
          ? <>{vision.provider==='local'?'Review saved incident evidence with the local model.':
              `I have permission to send incident evidence from this stream session to ${vision.provider==='typesafe'?'TypeSafe (experimental image review)':'NVIDIA'}.`}
              {' '}Up to {vision.auto_limit} incidents per clip. Advisory only; alerts do not wait for review.</>
          : `Vision review is configured but not available: ${vision.detail||'check Settings'}.`}
      </label>}
      <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={!enough} onChange={event => setApproval(event.target.checked ? currentApproval : '')}/>I reviewed the stream preview, settings and notification recipients.</label>
    </>}
  </section>;
}
