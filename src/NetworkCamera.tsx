import { useEffect, useRef, useState } from 'react';
import { json, request } from './api';
import type { DetectorOptions, Point, Rule, Status } from './types';

type StreamRule = Omit<Rule, 'points' | 'confirmed'> & DetectorOptions;

export default function NetworkCamera({camera, rule, workerOnline, connected, notify, refresh}: {
  camera: NonNullable<Status['camera']>; rule: StreamRule; workerOnline: boolean; connected: boolean;
  notify: (message: string) => void; refresh: () => void;
}) {
  const [preview, setPreview] = useState('');
  const [points, setPoints] = useState<Point[]>([]);
  const [approval, setApproval] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  // Uploaded-video geometry/confirmation must never authorize a network stream.
  const signature = JSON.stringify({capability: rule.capability, name: rule.name, instruction: rule.instruction,
    dwell_seconds: rule.dwell_seconds, motion_threshold: rule.motion_threshold, recipients: rule.recipients,
    alert_cooldown_seconds: rule.alert_cooldown_seconds,
    confidence: rule.confidence, image_size: rule.image_size, iou_threshold: rule.iou_threshold,
    analysis_fps: rule.analysis_fps, vehicle_classes: rule.vehicle_classes});
  const currentApproval = JSON.stringify([signature, points, preview]);
  const confirmed = approval === currentApproval;
  const enough = rule.capability === 'traffic' ? points.length === 2 : points.length >= 3;
  const restartable = ['stopped', 'capture failed', 'storage or source limit reached; archive clips before restarting'].includes(camera.state);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { setPoints([]); setApproval(''); }, [rule.capability]);
  useEffect(() => { setApproval(''); }, [signature, points, preview]);

  async function loadPreview() {
    const controller = new AbortController();
    pending.current?.abort(); pending.current = controller;
    setBusy(true); setApproval('');
    try {
      const blob = await (await request('/cameras/rtsp/preview', {signal: controller.signal})).blob();
      if (!controller.signal.aborted) setPreview(URL.createObjectURL(blob));
    } catch (error) { if (!controller.signal.aborted) notify((error as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function control(action: 'start' | 'stop') {
    const controller = new AbortController(); pending.current = controller;
    setBusy(true);
    try {
      await json(`/cameras/rtsp/${action}`, {method: 'POST', signal: controller.signal,
        ...(action === 'start' ? {body: JSON.stringify({rule: {...JSON.parse(signature), points, confirmed}})} : {})});
      if (!controller.signal.aborted) {
        refresh(); notify(action === 'start' ? 'Stream capture started. Short-clip findings appear in Video findings; tracking resets for each clip.' : 'Stream capture stopping.');
      }
    } catch (error) { if (!controller.signal.aborted) notify((error as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className="camera-capture network-camera" aria-label="Network stream analysis">
    <h3>Network stream · {camera.protocol}</h3>
    <p className="small-note">Records short clips ({camera.clip_seconds ?? 5}s for counting; longer when the dwell setting needs it) for YOLO + ByteTrack analysis (or the selected motion proxy). This is not a live annotated feed: tracking resets per clip, and capture/queue gaps can miss events. No frames are sent to hosted AI.</p>
    <p role="status">Stream: {camera.state}{camera.last_clip_at ? ` · last clip ${new Date(camera.last_clip_at * 1000).toLocaleString()}` : ''}</p>
    <div className="action-row">
      <button type="button" className="button secondary" disabled={!connected || busy} onClick={() => void loadPreview()}>Preview stream</button>
      <button type="button" className="button primary" disabled={!connected || busy || !workerOnline || !preview || !confirmed || !enough || !rule.name.trim() || !restartable} onClick={() => void control('start')}>Start stream analysis</button>
      <button type="button" className="button secondary" disabled={!connected || busy || restartable || camera.state === 'in use by another operator'} onClick={() => void control('stop')}>Stop stream</button>
    </div>
    {preview && <>
      <div className="video-stage rtsp-preview"><img src={preview} alt="Current network stream frame"/>
        <svg className="geometry" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Click to draw stream geometry" onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (points.length < (rule.capability === 'traffic' ? 2 : 12)) setPoints([...points, [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]]);
        }}>
          {points.length > 1 && (rule.capability === 'traffic' ? <polyline points={points.map(([x,y]) => `${x*1000},${y*1000}`).join(' ')}/> : <polygon points={points.map(([x,y]) => `${x*1000},${y*1000}`).join(' ')}/>)}
          {points.map(([x,y], i) => <circle key={i} cx={x*1000} cy={y*1000} r="7"/>)}
        </svg>
      </div>
      <div className="geometry-toolbar"><span>Draw a separate stream {rule.capability === 'traffic' ? 'line (2 points)' : 'region (3–12 points)'}. {points.length} points.</span><div>
        <button type="button" className="text-button" onClick={() => setPoints(points.slice(0,-1))}>Undo stream point</button>
        <button type="button" className="text-button" onClick={() => setPoints([])}>Clear stream geometry</button>
      </div></div>
      <details className="coordinate-editor"><summary>Edit stream coordinates with keyboard</summary>
        <textarea aria-label="Stream coordinates" key={JSON.stringify(points)} defaultValue={points.map(p => p.join(', ')).join('\n')} onBlur={event => {
          const rows = event.target.value.trim().split('\n').filter(Boolean).map(line => line.split(',').map(Number));
          if (rows.length <= 12 && rows.every(p => p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1))) setPoints(rows as Point[]);
          else notify('Stream coordinates must be x,y pairs between 0 and 1.');
        }}/>
      </details>
      <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={!enough} onChange={event => setApproval(event.target.checked ? currentApproval : '')}/>I reviewed this stream’s geometry, the selected rule settings and notification recipients.</label>
    </>}
  </section>;
}
