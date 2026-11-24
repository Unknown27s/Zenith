import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Camera, CheckCircle2, Circle, Plus, Trash2 } from 'lucide-react';
import { connection, json } from './api';
import type { Capability, Data, Run, SavedCamera } from './types';
import NetworkCamera, { type StreamRule } from './NetworkCamera';
import AnnotatedPreview from './AnnotatedPreview';
import CameraCarbon from './CameraCarbon';
import DetectorSettings, { detectorPreset } from './DetectorSettings';
import { analysisModes, cameraClipState, cameraPreviewState, runStatus } from './workflow';

type Props = {data: Data; connected: boolean; refresh: () => void; notify: (message: string) => void; selectedId: string};

export default function CamerasPage({data, connected, refresh, notify, selectedId}: Props) {
  const [cameras, setCameras] = useState<SavedCamera[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const identity = JSON.stringify(connection());
  const supported = data.status?.camera_inputs_supported === true;
  useEffect(() => {
    setCameras([]); setError('');
  }, [connected, identity]);
  useEffect(() => {
    if (!connected || !supported) return;
    const controller = new AbortController();
    let timer: number;
    async function load() {
      try {
        const rows = await json<SavedCamera[]>('/cameras', {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])});
        if (!controller.signal.aborted) { setCameras(rows); setError(''); }
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
      if (!controller.signal.aborted) timer = window.setTimeout(load, 3000);
    }
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [connected, supported, identity, revision]);
  const update = useCallback(() => { setRevision(value => value+1); refresh(); }, [refresh]);

  async function add(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const saved = await json<SavedCamera>('/cameras', {method: 'POST', body: JSON.stringify({name: name.trim(), url: url.trim()})});
      setName(''); setUrl(''); setPermission(false); update();
      window.location.hash = `cameras/${saved.id}`;
      notify('YouTube input saved. Open its preview and confirm its own monitoring rule.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(camera: SavedCamera) {
    if (!window.confirm(`Remove “${camera.name}”? Existing clips and incidents will remain saved.`)) return;
    try { await json(`/cameras/${camera.id}/remove`, {method: 'POST'}); update(); }
    catch (failure) { notify((failure as Error).message); }
  }

  const selected = cameras.find(camera => camera.id === selectedId);
  if (selectedId) return <>
    <div className="heading"><div><div className="eyebrow">CAMERA WORKSPACE</div><h1>{selected?.name || 'Camera workspace'}</h1>
      <p>Preview the stream, save this camera’s rule, start clip analysis, then estimate carbon from its traffic counts.</p></div><a className="button secondary" href="#cameras">← All cameras</a></div>
    {connected && !supported && <BackendUpdateRequired/>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {selected ? <CameraWorkspace key={selected.id} camera={selected} data={data} connected={connected} notify={notify} refresh={update}/> :
      <section className="panel camera-empty"><p>{!connected ? 'Connect your backend to view this camera.' : 'Loading camera… If it was removed, return to All cameras.'}</p></section>}
  </>;
  return <>
    <div className="heading"><div><div className="eyebrow">MULTI-INPUT DEMO</div><h1>Cameras & live streams</h1>
      <p>Paste YouTube URLs here. Each camera keeps its own incident rule and carbon estimate.</p></div></div>
    {connected && !supported && <BackendUpdateRequired/>}
    <section className="panel camera-add"><h2><Plus size={18}/> Add YouTube camera input</h2>
      <form onSubmit={event => void add(event)}>
        <div className="form-grid"><label>Camera name<input value={name} maxLength={80} required placeholder="Entrance · Camera 01" onChange={event => setName(event.target.value)}/></label>
          <label>YouTube livestream URL<input type="url" value={url} maxLength={2048} required placeholder="https://www.youtube.com/watch?v=…" onChange={event => setUrl(event.target.value)}/></label></div>
        <label className="checkbox"><input type="checkbox" checked={permission} onChange={event => setPermission(event.target.checked)}/>I have permission to process this stream and share evidence with the selected alert recipients.</label>
        <button className="button primary" disabled={!connected || !supported || busy || !permission || !name.trim() || !url.trim()}><Plus size={16}/>{busy ? 'Saving…' : 'Save camera & open'}</button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="small-note">Six saved inputs per workspace; up to three bounded clip captures and two sampled YOLO previews on this backend.
        All inputs share one analysis worker and the workspace queue/storage limits. Saved inputs survive restart; capture never auto-resumes.
        RTSP/HLS credentials remain backend-configured in Studio for now.</p>
    </section>
    <div className="saved-camera-grid">{cameras.map(camera => {
      const runs = runsForCamera(camera, data);
      const trafficRuns = runs.filter(run => run.status === 'completed' && run.rule.capability === 'traffic');
      const ruleLabel = camera.last_rule
        ? `${analysisModes[camera.last_rule.capability]?.label || camera.last_rule.capability} · ${camera.last_rule.name}`
        : 'Not saved';
      const blocked = camera.health.state.startsWith('storage or source limit') || camera.health.state === 'capture failed';
      const next = blocked
        ? camera.health.state.startsWith('storage or source limit')
          ? 'Clip capture is stopped by the clip or storage limit. Archive or remove old camera clips, then start clip analysis again.'
          : 'The last capture attempt failed. Check stream access, then start clip analysis again.'
        : !camera.last_rule ? 'Open the camera and save its incident rule.'
        : camera.health.active ? 'Clip analysis is running. New findings appear as clips complete.'
        : trafficRuns.length ? 'Review the latest findings, then save a carbon estimate from this camera.'
        : runs.length ? 'Review the latest findings. For carbon, use a Traffic & CO₂ rule and start a new clip.'
        : 'Open the camera and start clip analysis.';
      const latest = camera.health.last_clip_at ? new Date(camera.health.last_clip_at*1000).toLocaleTimeString()
        : runs[0] ? `${new Date(runs[0].created*1000).toLocaleTimeString()} (analysed)` : 'None yet';
      return <article className="panel saved-camera-card" key={camera.id}>
      <Camera size={24}/><h2>{camera.name}</h2><p>{camera.url}</p>
      <dl><div><dt>Incident rule</dt><dd>{ruleLabel}</dd></div>
        <div><dt>Clip analysis</dt><dd>{cameraClipState(camera.health.state)}</dd></div>
        <div><dt>Live preview</dt><dd>{cameraPreviewState(camera.live.state)}</dd></div>
        <div><dt>Carbon</dt><dd>{trafficRuns.length ? `Ready · ${trafficRuns.length} traffic clip${trafficRuns.length === 1 ? '' : 's'}` : camera.last_rule?.capability === 'traffic' ? 'Waiting for a completed traffic clip' : 'Needs a Traffic & CO₂ rule'}</dd></div>
        <div><dt>Latest clip</dt><dd>{latest}</dd></div></dl>
      <p className="camera-next"><strong>Next:</strong> {next}</p>
      <div className="action-row"><a className="button primary" href={`#cameras/${camera.id}`}>Open camera & rule →</a>
        <button className="button secondary" disabled={camera.health.active || camera.live.active} onClick={() => void remove(camera)} aria-label={`Remove ${camera.name}`}><Trash2 size={15}/></button></div>
    </article>;})}</div>
    {!cameras.length && <section className="panel camera-empty"><Camera size={28}/><p>{connected ? 'Add your first permitted YouTube livestream above.' : 'Connect your backend in Health & settings to save camera inputs.'}</p></section>}
  </>;
}

function BackendUpdateRequired() {
  return <div className="connection-banner" role="alert"><div><strong>Backend update required—not a YouTube URL error.</strong>
    <p>The running API does not support saved cameras yet. Stop your existing API/worker launcher with Ctrl+C,
      then run <code>python start.py</code> again using the same database/options as before. Refresh this dashboard afterward.
      Starting another copy without stopping the old one will leave port 8000 occupied.</p></div></div>;
}

function runsForCamera(camera: SavedCamera, data: Data) {
  const sourceIds = new Set(data.sources.filter(source => source.camera_id === camera.id).map(source => source.id));
  return data.runs.filter(run => sourceIds.has(run.source_id));
}

function CameraStatus({camera, runs, trafficRuns, connected}: {
  camera: SavedCamera; runs: Run[]; trafficRuns: Run[]; connected: boolean;
}) {
  const saved = camera.last_rule;
  const active = !!camera.health.active || ['connecting', 'capturing', 'reconnecting', 'waiting for analysis capacity'].includes(camera.health.state);
  const blocked = camera.health.state.startsWith('storage or source limit') || camera.health.state === 'capture failed';
  const steps = [
    {done: !!saved, title: 'Save this camera’s incident rule',
      detail: saved ? `${analysisModes[saved.capability]?.label || saved.capability} · ${saved.name}`
        : 'Preview a frame, draw the line or region, then click Save rule.'},
    {done: active || runs.length > 0, title: 'Start clip analysis',
      detail: active ? cameraClipState(camera.health.state)
        : runs.length ? `${runs.length} clip${runs.length === 1 ? '' : 's'} analysed · not currently capturing`
        : 'Start the separate clip analysis to record short clips.'},
    {done: runs.length > 0, title: 'Review findings',
      detail: runs.length ? `${runs.length} clip analysis${runs.length === 1 ? '' : 'es'} recorded.`
        : 'Findings appear after the first clip completes.'},
    {done: trafficRuns.length > 0, title: 'Estimate carbon',
      detail: trafficRuns.length ? `${trafficRuns.length} completed traffic clip${trafficRuns.length === 1 ? '' : 's'} can feed the carbon panel.`
        : 'Needs a completed Traffic & CO₂ clip.'},
  ];
  const current = steps.findIndex(step => !step.done);
  const next = blocked
    ? camera.health.state.startsWith('storage or source limit')
      ? 'Clip capture is stopped by the clip or storage limit. Archive or remove old camera clips, then start clip analysis again.'
      : 'The last capture attempt failed. Check stream access, then start clip analysis again.'
    : !saved ? 'Preview the stream and save the rule in the incident-rule panel.'
    : active ? 'Clip analysis is running. Wait for a clip to finish, then review its findings.'
    : !runs.length ? 'Start clip analysis below and wait for the first clip to finish.'
    : !trafficRuns.length ? 'Review the findings. Carbon needs a completed Traffic & CO₂ clip.'
    : 'Open Carbon from this camera and save an estimate when the counts look right.';
  return <section className="panel camera-status" aria-label="Camera status and next step">
    <div className="panel-heading"><div><h2>What is happening on this camera</h2>
      <p>Only the incident rule creates clips, findings and alerts. The live preview is optional and creates nothing.</p></div>
      <span className={`badge ${blocked ? 'warning' : active ? 'success' : 'neutral'}`}>{cameraClipState(camera.health.state)}</span></div>
    <ol className="camera-status-steps">
      {steps.map((step, index) => <li key={step.title} className={step.done ? 'done' : index === current ? 'current' : ''}>
        {step.done ? <CheckCircle2 size={18}/> : <Circle size={18}/>}
        <div><strong>{step.title}</strong><small>{step.detail}</small></div>
      </li>)}
    </ol>
    <p className="camera-next"><strong>Next step:</strong> {next} {!connected && 'Connect the backend to use these controls.'}</p>
  </section>;
}

function CameraWorkspace({camera, data, connected, refresh, notify}: Omit<Props, 'selectedId'> & {camera: SavedCamera}) {
  const [rule, setRule] = useState<StreamRule>(() => ({
    capability: 'zone', name: `${camera.name} watch`, instruction: '', dwell_seconds: 2, motion_threshold: .03,
    action_confidence: .6, recipients: [], alert_cooldown_seconds: 300, ...detectorPreset('zone'),
    ...camera.last_rule,
  }));
  const runs = runsForCamera(camera, data);
  const trafficRuns = runs.filter(run => run.status === 'completed' && run.rule.capability === 'traffic');
  const runIds = new Set(runs.map(run => run.id));
  const incidents = data.events.filter(event => runIds.has(event.run_id));
  function capability(value: Capability) {
    setRule(previous => ({...previous, capability: value, ...detectorPreset(value)}));
  }
  return <div className="camera-workspace">
    <AnnotatedPreview camera={camera} connected={connected} refresh={refresh} notify={notify}/>
    <CameraStatus camera={camera} runs={runs} trafficRuns={trafficRuns} connected={connected}/>
    <section className="panel camera-rule-settings" id="camera-rule">
      <div className="panel-heading"><div><h2>Incident rule & clip analysis</h2>
        <p>This rule belongs to {camera.name}. <strong>Save rule</strong> stores it; <strong>Start clip analysis</strong> stores it and begins recording short clips. Only this rule creates findings and alerts.</p></div></div>
      <div className="camera-rule-fields form-grid">
        <label>Monitoring type<select aria-label="Monitoring type" value={rule.capability} onChange={event => capability(event.target.value as Capability)}>
          {(Object.keys(analysisModes) as Capability[]).map(mode => <option key={mode} value={mode}>{analysisModes[mode].label}</option>)}</select></label>
        <label>Rule name<input maxLength={100} value={rule.name} onChange={event => setRule({...rule, name: event.target.value})}/></label>
        {(rule.capability==='zone'||rule.capability==='machine_activity')&&<label>Minimum sustained duration (seconds)<input type="number" min=".2" max="120" step=".2" value={rule.dwell_seconds} onChange={event => setRule({...rule, dwell_seconds: Number(event.target.value)})}/></label>}
        {rule.capability==='action'&&<label>Action score threshold<input type="number" min=".3" max=".99" step=".05" value={rule.action_confidence ?? .6}
          onChange={event => setRule({...rule, action_confidence: Number(event.target.value)})}/></label>}
        {rule.capability==='machine_activity'&&<label>Visible-motion fraction threshold<input type="number" min=".001" max=".9" step=".001" value={rule.motion_threshold}
          onChange={event => setRule({...rule, motion_threshold: Number(event.target.value)})}/></label>}
        <label>Repeat-alert cooldown (seconds)<input type="number" min="0" max="86400" value={rule.alert_cooldown_seconds} onChange={event => setRule({...rule, alert_cooldown_seconds: Number(event.target.value)})}/></label>
      </div>
      <p className="camera-rule-note"><strong>{analysisModes[rule.capability]?.label}:</strong> {analysisModes[rule.capability]?.description}
        {rule.capability==='traffic' ? ' The camera counts across a two-point line; enter the road distance for each clip in the carbon panel.' : ''}
      </p>
      <details className="camera-detector-settings"><summary>Advanced incident detection settings</summary>
        <DetectorSettings capability={rule.capability} options={rule} onChange={options => setRule({...rule, ...options})}/>
      </details>
      <fieldset className="camera-recipients"><legend>Notification recipients for this camera</legend>
        {data.status?.recipients.length ? data.status.recipients.map(recipient => <label className="checkbox" key={recipient}>
          <input type="checkbox" checked={rule.recipients.includes(recipient)} onChange={event => setRule({...rule,
            recipients: event.target.checked ? [...rule.recipients, recipient] : rule.recipients.filter(item => item !== recipient)})}/>
          {recipient.startsWith('telegram:') ? `Telegram · chat ${recipient.slice(9)}` : recipient}
        </label>) : <p>No approved recipients. Configure Telegram or email in Health & settings.</p>}
      </fieldset>
      <NetworkCamera camera={camera.health} rule={rule} endpoint={`/cameras/${camera.id}`} saveEndpoint={`/cameras/${camera.id}/rule`} initialPoints={camera.last_rule?.points}
        vision={data.status?.vision} connected={connected} workerOnline={!!data.status?.worker_online}
        actionReady={!!data.status?.models?.action.checkpoint_present} refresh={refresh} notify={notify}/>
    </section>
    <CameraCarbon camera={camera} runs={runs} connected={connected} notify={notify} refresh={refresh}/>
    <section className="panel camera-history" id="camera-findings"><h2>Camera findings & history</h2><p>{runs.length} clip analyses · {incidents.length} observations. Preview boxes alone do not create incidents.</p>
      {incidents.slice(0, 6).map(event => <a key={event.id} href={`#incidents/${event.id}`}><strong>{event.title}</strong><span>{event.source_seconds.toFixed(2)} s · {event.operator_status}</span></a>)}
      {runs.slice(0, 6).map(run => <a key={run.id} href={`#videos/${run.source_id}/${run.id}`}><strong>{run.source_name}</strong><span>{runStatus(run)} · {run.stage}</span></a>)}
    </section>
  </div>;
}
