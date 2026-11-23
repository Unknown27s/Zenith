import { useEffect, useRef, useState } from 'react';
import { Activity, Check, LoaderCircle, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { connection, json, request } from './api';
import type { Status, VisionStatus } from './types';

type CheckState = 'pass' | 'warning' | 'fail' | 'unchecked' | 'checking';
type CheckResult = {state: CheckState; detail: string};
type CheckId = 'api' | 'database' | 'worker' | 'storage' | 'vision' | 'telegram' | 'stream' | 'action';
const labels: Record<CheckId, string> = {
  api: 'Backend API', database: 'Database', worker: 'Analysis worker', storage: 'Clip storage capacity',
  vision: 'Jev / vision provider', telegram: 'Telegram bot', stream: 'YouTube / camera stream', action: 'Fight & fall model',
};
const stateLabels: Record<CheckState, string> = {
  pass: 'Passed', warning: 'Needs attention', fail: 'Failed', unchecked: 'Not tested', checking: 'Checking…',
};
const unchecked = (detail: string): CheckResult => ({state: 'unchecked', detail});
const failed = (error: unknown): CheckResult => ({state: 'fail', detail: error instanceof Error ? error.message : 'Check failed'});

function snapshot(status: Status | null): Record<CheckId, CheckResult> {
  return {
    api: unchecked('Run checks to test whether the API responds.'),
    database: unchecked('Run checks to query the application database.'),
    worker: unchecked('Run checks to inspect the worker heartbeat.'),
    storage: unchecked('Run checks to compare recorded clip usage against the storage quota.'),
    vision: unchecked(status?.vision?.configured ? `${status.vision.model} configured; connection not tested.` : 'Optional. Configure Jev, NVIDIA or a local model on the backend.'),
    telegram: unchecked(status?.channels?.telegram.configured ? 'Configured; bot connection not tested.' : 'Optional. Configure your bot token and approved chat IDs on the backend.'),
    stream: unchecked(status?.camera?.configured ? `${status.camera.protocol} configured; frame access not tested.` : 'Configure a permissioned YouTube live, RTSP or HLS input on the backend.'),
    action: unchecked('A separate action checkpoint is required for possible fights and falls.'),
  };
}

export default function HealthPanel({status, connected, refresh}: {
  status: Status | null; connected: boolean; refresh: () => void;
}) {
  const [checks, setChecks] = useState(() => snapshot(status));
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const sendPending = useRef<AbortController | null>(null);
  const previewPending = useRef<AbortController | null>(null);
  const session = connection();
  const identity = JSON.stringify([session.base, session.key]);
  const scope = JSON.stringify([identity, status?.vision?.provider, status?.vision?.model,
    status?.vision?.available, status?.channels?.telegram.configured, status?.camera?.configured, status?.camera?.protocol]);
  useEffect(() => {
    pending.current?.abort(); sendPending.current?.abort(); previewPending.current?.abort();
    setChecks(snapshot(status)); setCheckedAt(null); setBusy(false); setMessage(''); setSending(false); setPreviewing(false);
    return () => { pending.current?.abort(); sendPending.current?.abort(); previewPending.current?.abort(); };
    // Reset results when the connected workspace or provider configuration changes.
  }, [scope]);

  function put(id: CheckId, result: CheckResult, controller: AbortController) {
    if (!controller.signal.aborted) setChecks(previous => ({...previous, [id]: result}));
  }

  async function runChecks() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    setBusy(true); setCheckedAt(null);
    setChecks(Object.fromEntries(Object.keys(labels).map(id => [id, {state: 'checking', detail: 'Waiting for this check…'}])) as Record<CheckId, CheckResult>);
    async function check(id: CheckId, run: () => Promise<CheckResult>) {
      try { put(id, await run(), controller); }
      catch (error) { put(id, failed(error), controller); }
    }
    await Promise.allSettled([
      check('api', async () => {
        const result = await json<{status: string; service: string}>('/health', {signal: signal()});
        return result.status === 'ok' && result.service === 'zenith'
          ? {state: 'pass', detail: 'Zenith API responded. This alone does not mean analysis is ready.'}
          : {state: 'fail', detail: 'The endpoint did not return a Zenith health response.'};
      }),
      check('database', async () => {
        const result = await json<{database: {ready: boolean; detail: string}}>('/ready', {signal: signal()});
        return {state: result.database.ready ? 'pass' : 'fail', detail: result.database.detail};
      }),
      (async () => {
        let current: Status;
        try { current = await json<Status>('/status', {signal: signal()}); }
        catch (error) {
          for (const id of ['worker', 'storage', 'vision', 'telegram', 'stream', 'action'] as CheckId[]) {
            put(id, {state: 'fail', detail: `Cannot read authenticated backend status: ${failed(error).detail}`}, controller);
          }
          return;
        }
        const age = current.worker_age_seconds;
        put('worker', {state: current.worker_online ? 'pass' : 'fail',
          detail: current.worker_online ? `Heartbeat ${typeof age !== 'number' ? 'available' : `${Math.max(0, Math.round(age))} seconds old`}. Model inference has not been tested.`
            : 'No fresh worker heartbeat. Start the worker before analysis.'}, controller);
        const used = current.storage_used_mb, limit = current.storage_limit_mb;
        put('storage', used === undefined || limit === undefined ? unchecked('Storage quota data unavailable.') : {
          state: used >= limit ? 'fail' : used >= limit * .9 ? 'warning' : 'pass',
          detail: `${used} / ${limit} MB of recorded clips. Quota check only, not a disk-write or free-space test.`,
        }, controller);
        put('stream', current.saved_cameras?.length ? {state: 'warning',
          detail: `${current.saved_cameras.length} saved YouTube input(s). ${current.saved_cameras.map(item => `${item.name}: ${item.state}`).join(' · ')}. Open Cameras & live streams to test each preview.`}
          : current.camera?.configured ? {state: current.camera.state === 'capture failed' ? 'fail' : 'warning',
          detail: `${current.camera.protocol} · ${current.camera.state}. Use “Check stream frame” to test access without starting analysis.`}
          : {state: 'warning', detail: 'No stream configured. Paste a YouTube URL in Cameras & live streams, or configure an RTSP/HLS input on the backend.'}, controller);
        put('action', {state: current.models?.action.checkpoint_present ? 'warning' : 'unchecked',
          detail: current.models?.action.checkpoint_present ? 'Checkpoint is present. Loading and inference are only tested by an analysis run.'
            : 'No action checkpoint installed. Zone and traffic analysis do not require it.'}, controller);
        await Promise.allSettled([
          current.vision?.configured ? check('vision', async () => {
            const result = await json<VisionStatus>('/vision/status', {signal: signal()});
            return {state: result.model_access && result.available ? 'pass' : result.reachable === false || result.model_access === false ? 'fail' : 'warning',
              detail: `${result.detail} ${result.available ? 'Model-list check only; no frames or inference requests sent.' : 'Frame sharing/review is disabled.'}`};
          }) : Promise.resolve(put('vision', {state: 'unchecked', detail: 'Optional vision review is off or not configured. YOLO triggers can still alert.'}, controller)),
          !current.channels?.telegram.configured ? Promise.resolve(put('telegram', {state: 'unchecked', detail: 'Bot token and chat allowlist are not configured.'}, controller))
            : !current.is_admin || !session.key ? Promise.resolve(put('telegram', {state: 'warning', detail: 'Configured. Sign in with the administrator key to test the bot connection; automatic local sessions cannot run administrator checks.'}, controller))
            : check('telegram', async () => {
              const result = await json<{reachable: boolean | null; detail: string}>('/notifications/status', {signal: signal()});
              return {state: result.reachable === true ? 'pass' : result.reachable === false ? 'fail' : 'warning',
                detail: `${result.detail} No message sent; chat delivery is not tested.`};
            }),
        ]);
      })(),
    ]);
    if (!controller.signal.aborted) { setBusy(false); setCheckedAt(Date.now()); refresh(); }
  }

  async function checkStream() {
    const controller = new AbortController(); previewPending.current = controller;
    setPreviewing(true);
    put('stream', {state: 'checking', detail: 'Reading one stream frame; no analysis run is created.'}, controller);
    try {
      const response = await request('/cameras/rtsp/preview', {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)])});
      const blob = await response.blob();
      if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Stream did not return an image.');
      put('stream', {state: 'pass', detail: 'One stream frame received. This does not guarantee continuous coverage. Draw and confirm a rule in Studio to start analysis.'}, controller);
    } catch (error) { put('stream', failed(error), controller); }
    finally { if (!controller.signal.aborted) setPreviewing(false); }
  }

  async function sendTest() {
    if (!window.confirm('Send a labelled setup-test message to every Telegram chat approved on this backend?')) return;
    const controller = new AbortController(); sendPending.current = controller;
    setSending(true); setMessage('');
    try {
      const result = await json<{bot: string; results: {chat: string; delivered: boolean; detail: string}[]}>('/notifications/test',
        {method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])});
      if (!controller.signal.aborted) {
        setMessage([result.bot, ...result.results.map(item => `Chat ${item.chat}: ${item.detail}`)].join(' · '));
        refresh();
      }
    } catch (error) { if (!controller.signal.aborted) setMessage(failed(error).detail); }
    finally { if (!controller.signal.aborted) setSending(false); }
  }

  const passed = Object.values(checks).filter(check => check.state === 'pass').length;
  return <section className="panel health-checks" aria-labelledby="health-title">
    <div className="panel-heading"><div><h2 id="health-title"><Activity size={19}/> System health checks</h2>
      <p>Test connections without sending alerts or sharing footage with an AI provider.</p></div>
      <button className="button secondary" disabled={busy || previewing} onClick={() => void runChecks()}>
        {busy ? <LoaderCircle size={16} className="spin"/> : <RefreshCw size={16}/>}
        {busy ? 'Checking services…' : 'Run health checks'}
      </button>
    </div>
    <div className="health-check-summary" role="status">
      {busy ? 'Checks are running independently…' : checkedAt ? `${passed} of ${Object.keys(labels).length} checks passed · checked ${new Date(checkedAt).toLocaleTimeString()}` : 'Not tested yet. Configured does not mean connected.'}
      {!connected && <p>Workspace disconnected. Public API/database checks can still run; private checks need operator access.</p>}
      {checkedAt && <p>This is a point-in-time check, not an uptime monitor.</p>}
    </div>
    <div className="health-check-list">{(Object.keys(labels) as CheckId[]).map(id => <div className="health-check-item" key={id}>
      <div><strong>{labels[id]}</strong><span className={`health-check-badge health-${checks[id].state}`}>
        {checks[id].state === 'pass' && <Check size={12}/>}
        {stateLabels[checks[id].state]}
      </span></div>
      <p>{checks[id].detail}</p>
    </div>)}</div>
    <div className="health-check-actions">
      <button className="button secondary" disabled={!connected || !status?.camera?.configured || busy || previewing}
        onClick={() => void checkStream()}>{previewing ? 'Reading stream…' : 'Check stream frame'}</button>
      {status?.is_admin && <button className="button secondary" disabled={!connected || !session.key || !status.channels?.telegram.configured || sending}
        onClick={() => void sendTest()}><Send size={15}/>{sending ? 'Sending test…' : 'Send test Telegram alert'}</button>}
      <a className="text-link" href="#cameras">Open cameras & live streams →</a>
    </div>
    {message && <p className="health-check-message" role="status">{message}</p>}
    {connected && status?.is_admin && !session.key && <p className="health-check-footnote">Enter the administrator key in Backend connection to enable Telegram connection and delivery tests.</p>}
    <p className="health-check-footnote"><ShieldCheck size={15}/> Bot and model checks test connectivity only. Email delivery, detector accuracy and full end-to-end incident delivery are not verified here.</p>
  </section>;
}
