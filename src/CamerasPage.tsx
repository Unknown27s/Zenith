import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { connection, json } from './api';
import type { Capability, Data, SavedCamera } from './types';
import NetworkCamera, { type StreamRule } from './NetworkCamera';
import AnnotatedPreview from './AnnotatedPreview';
import DetectorSettings, { detectorPreset } from './DetectorSettings';
import { analysisModes } from './workflow';

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
      <p>One camera, its own detection preview, confirmed rule and evidence.</p></div><a className="button secondary" href="#cameras">← All cameras</a></div>
    {connected && !supported && <BackendUpdateRequired/>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {selected ? <CameraWorkspace key={selected.id} camera={selected} data={data} connected={connected} notify={notify} refresh={update}/> :
      <section className="panel camera-empty"><p>{!connected ? 'Connect your backend to view this camera.' : 'Loading camera… If it was removed, return to All cameras.'}</p></section>}
  </>;
  return <>
    <div className="heading"><div><div className="eyebrow">MULTI-INPUT DEMO</div><h1>Cameras & live streams</h1>
      <p>Paste YouTube URLs here. No environment edit or restart is needed for saved demo inputs.</p></div></div>
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
    <div className="saved-camera-grid">{cameras.map(camera => <article className="panel saved-camera-card" key={camera.id}>
      <Camera size={24}/><h2>{camera.name}</h2><p>{camera.url}</p>
      <dl><div><dt>Clip analysis</dt><dd>{camera.health.state}</dd></div><div><dt>YOLO preview</dt><dd>{camera.live.state}</dd></div>
        <div><dt>Latest clip</dt><dd>{camera.health.last_clip_at ? new Date(camera.health.last_clip_at*1000).toLocaleTimeString() : 'None yet'}</dd></div></dl>
      <div className="action-row"><a className="button primary" href={`#cameras/${camera.id}`}>Open camera →</a>
        <button className="button secondary" disabled={camera.health.active || camera.live.active} onClick={() => void remove(camera)} aria-label={`Remove ${camera.name}`}><Trash2 size={15}/></button></div>
    </article>)}</div>
    {!cameras.length && <section className="panel camera-empty"><Camera size={28}/><p>{connected ? 'Add your first permitted YouTube livestream above.' : 'Connect your backend in Health & settings to save camera inputs.'}</p></section>}
  </>;
}

function BackendUpdateRequired() {
  return <div className="connection-banner" role="alert"><div><strong>Backend update required—not a YouTube URL error.</strong>
    <p>The running API does not support saved cameras yet. Stop your existing API/worker launcher with Ctrl+C,
      then run <code>python start.py</code> again using the same database/options as before. Refresh this dashboard afterward.
      Starting another copy without stopping the old one will leave port 8000 occupied.</p></div></div>;
}

function CameraWorkspace({camera, data, connected, refresh, notify}: Omit<Props, 'selectedId'> & {camera: SavedCamera}) {
  const [rule, setRule] = useState<StreamRule>(() => ({
    capability: 'zone', name: `${camera.name} watch`, instruction: '', dwell_seconds: 2, motion_threshold: .03,
    action_confidence: .6, recipients: [], alert_cooldown_seconds: 300, ...detectorPreset('zone'),
    ...camera.last_rule,
  }));
  const sourceIds = new Set(data.sources.filter(source => source.camera_id === camera.id).map(source => source.id));
  const runs = data.runs.filter(run => sourceIds.has(run.source_id));
  const runIds = new Set(runs.map(run => run.id));
  const incidents = data.events.filter(event => runIds.has(event.run_id));
  function capability(value: Capability) {
    setRule(previous => ({...previous, capability: value, ...detectorPreset(value)}));
  }
  return <div className="camera-workspace">
    <AnnotatedPreview camera={camera} connected={connected} refresh={refresh} notify={notify}/>
    <section className="panel camera-rule-settings"><div className="panel-heading"><div><h2>Incident rule for this camera</h2><p>These settings belong to {camera.name}, not other cameras.</p></div></div>
      <div className="camera-rule-fields form-grid">
        <label>Monitoring type<select aria-label="Monitoring type" value={rule.capability} onChange={event => capability(event.target.value as Capability)}>
          {(Object.keys(analysisModes) as Capability[]).map(mode => <option key={mode} value={mode}>{analysisModes[mode].label}</option>)}</select></label>
        <label>Rule name<input maxLength={100} value={rule.name} onChange={event => setRule({...rule, name: event.target.value})}/></label>
        <label>Minimum sustained duration (seconds)<input type="number" min=".2" max="120" step=".2" value={rule.dwell_seconds} onChange={event => setRule({...rule, dwell_seconds: Number(event.target.value)})}/></label>
        <label>Repeat-alert cooldown (seconds)<input type="number" min="0" max="86400" value={rule.alert_cooldown_seconds} onChange={event => setRule({...rule, alert_cooldown_seconds: Number(event.target.value)})}/></label>
        {rule.capability==='action'&&<label>Action score threshold<input type="number" min=".3" max=".99" step=".05" value={rule.action_confidence ?? .6}
          onChange={event => setRule({...rule, action_confidence: Number(event.target.value)})}/></label>}
        {rule.capability==='machine_activity'&&<label>Visible-motion fraction threshold<input type="number" min=".001" max=".9" step=".001" value={rule.motion_threshold}
          onChange={event => setRule({...rule, motion_threshold: Number(event.target.value)})}/></label>}
      </div>
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
      <NetworkCamera camera={camera.health} rule={rule} endpoint={`/cameras/${camera.id}`} initialPoints={camera.last_rule?.points}
        vision={data.status?.vision} connected={connected} workerOnline={!!data.status?.worker_online}
        actionReady={!!data.status?.models?.action.checkpoint_present} refresh={refresh} notify={notify}/>
    </section>
    <section className="panel camera-history"><h2>Camera findings</h2><p>{runs.length} clip analyses · {incidents.length} observations. Preview boxes alone do not create incidents.</p>
      {incidents.slice(0, 6).map(event => <a key={event.id} href={`#incidents/${event.id}`}><strong>{event.title}</strong><span>{event.source_seconds.toFixed(2)} s · {event.operator_status}</span></a>)}
      {runs.slice(0, 6).map(run => <a key={run.id} href={`#videos/${run.source_id}/${run.id}`}><strong>{run.source_name}</strong><span>{run.status} · {run.stage}</span></a>)}
    </section>
  </div>;
}
