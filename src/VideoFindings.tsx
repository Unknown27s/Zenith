import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Camera, MonitorPlay } from 'lucide-react';
import RunVideo, { carbonLink } from './RunVideo';
import { download, json, request } from './api';
import type { Data, Source } from './types';
import { runLink, runStatus } from './workflow';

/* ------------------------------------------------------------------ */
/* Types and small helpers                                             */
/* ------------------------------------------------------------------ */

type Run = Data['runs'][number];
type RunEvent = Data['events'][number];
type Crossing = NonNullable<Run['crossings']>[number];
type ReviewAction = 'valid' | 'false_positive';
type Notify = (message: string) => void;

interface ReviewTarget {
  runId: string;
  trackId: number;
  action: ReviewAction;
}

const NO_RUNS: Run[] = [];
const NO_EVENTS: RunEvent[] = [];

const REVIEW_LABEL: Record<ReviewAction, string> = {
  valid: 'Confirmed',
  false_positive: 'False positive',
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const formatSeconds = (seconds: number) => `${seconds.toFixed(2)}s`;

/** Position of a moment on the timeline, safe for zero or missing durations. */
const percentOf = (time: number, duration: number) =>
  duration > 0 && Number.isFinite(time) ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0;

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/**
 * Fetches a protected resource as an object URL and cleans it up on change or unmount.
 * Pass `null` to stay idle. Bump `attempt` to retry after an error.
 */
function useBlobUrl(path: string | null, attempt = 0) {
  const [state, setState] = useState<{ url: string; status: 'idle' | 'loading' | 'ready' | 'error' }>({
    url: '',
    status: 'idle',
  });

  useEffect(() => {
    if (!path) {
      setState({ url: '', status: 'idle' });
      return;
    }
    const controller = new AbortController();
    let objectUrl = '';
    setState({ url: '', status: 'loading' });
    request(path, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, status: 'ready' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ url: '', status: 'error' });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, attempt]);

  return state;
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

function EvidenceThumb({ path }: { path: string }) {
  const { url } = useBlobUrl(path);
  return url ? <img src={url} alt="Recorded evidence frame" className="finding-thumb" loading="lazy" /> : null;
}

function SourceClip({ source }: { source: Source }) {
  const [attempt, setAttempt] = useState(0);
  const { url, status } = useBlobUrl(attempt > 0 ? `/sources/${source.id}/video` : null, attempt);

  if (url) return <video className="camera-preview" src={url} controls playsInline />;

  const label = status === 'loading' ? 'Loading video…' : status === 'error' ? 'Try again' : 'Play uploaded video';
  return (
    <>
      <button
        className="button secondary"
        type="button"
        disabled={status === 'loading'}
        onClick={() => setAttempt(n => n + 1)}
      >
        {label}
      </button>
      {status === 'error' && (
        <p className="small-note" role="alert">
          The video could not be loaded here. It may still be available in Studio.
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Review dialog (replaces window.prompt)                              */
/* ------------------------------------------------------------------ */

function ReviewDialog({
  target,
  onCancel,
  onSubmit,
}: {
  target: ReviewTarget | null;
  onCancel: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target) {
      setNote('');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [target]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSaving(false);
    }
  }

  const isValid = target?.action === 'valid';
  return (
    <dialog
      ref={dialogRef}
      className="review-dialog"
      aria-labelledby="review-dialog-title"
      onCancel={event => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
    >
      {target && (
        <form onSubmit={submit}>
          <h2 id="review-dialog-title">{isValid ? 'Confirm crossing' : 'Mark as false positive'}</h2>
          <p className="small-note">
            Crossing #{target.trackId}. Raw detector counts stay unchanged for audit.
          </p>
          <label>
            {isValid ? 'Why is this crossing valid?' : 'Why is this a false positive?'}
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} required autoFocus />
          </label>
          <div className="action-row">
            <button className="button secondary" type="button" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button className="button primary" type="submit" disabled={saving || !note.trim()}>
              {saving ? 'Saving…' : 'Save review'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Run details                                                         */
/* ------------------------------------------------------------------ */

function VisionSummary({ summary }: { summary: Run['vision_summary'] }) {
  switch (summary?.status) {
    case 'completed':
      return (
        <>
          <p><strong>AI sample-frame summary:</strong> {summary.summary}</p>
          <p className="small-note">{summary.limitations}</p>
        </>
      );
    case 'failed':
      return <p>AI summary unavailable: {summary.error}</p>;
    case 'queued':
    case 'processing':
      return <p>AI sample-frame summary {summary.status}…</p>;
    default:
      return (
        <p className="small-note">
          No AI frames shared. Enable hosted vision and give explicit consent in Studio to request an optional AI
          summary on a new run.
        </p>
      );
  }
}

function FindingTimeline({
  run,
  events,
  duration,
  onReview,
}: {
  run: Run;
  events: RunEvent[];
  duration: number;
  onReview: (target: ReviewTarget) => void;
}) {
  const crossings: Crossing[] = run.crossings ?? [];
  const marks = [
    ...events.map(event => ({ key: `event-${event.id}`, time: event.source_seconds })),
    ...crossings.map(c => ({ key: `crossing-${c.track_id}-${c.source_seconds}`, time: c.source_seconds })),
  ];

  return (
    <div className="finding-timeline" role="group" aria-label="Video finding timeline">
      <div className="finding-timeline-track" aria-hidden="true">
        {marks.map(mark => (
          <span key={mark.key} style={{ left: `${percentOf(mark.time, duration)}%` }} />
        ))}
      </div>

      {events.map(event => (
        <a className="finding-marker" key={event.id} href={`#incidents/${event.id}`}>
          {event.frames.length > 0 && <EvidenceThumb path={`/events/${event.id}/evidence/${event.frames[0]}`} />}
          <span>
            {formatSeconds(event.source_seconds)} · {event.title} · {event.operator_status}
          </span>
        </a>
      ))}

      {crossings.map(crossing => {
        const reviewed = run.crossing_reviews?.[crossing.track_id]?.action as ReviewAction | undefined;
        return (
          <div className="finding-marker" key={`${crossing.track_id}-${crossing.source_seconds}`}>
            <span>
              {formatSeconds(crossing.source_seconds)} · {crossing.vehicle_class} #{crossing.track_id} ·{' '}
              <span className={`badge ${reviewed === 'valid' ? 'success' : reviewed === 'false_positive' ? 'danger' : 'neutral'}`}>
                {reviewed ? REVIEW_LABEL[reviewed] : 'Unreviewed'}
              </span>
            </span>
            <button
              className="text-button"
              type="button"
              aria-label={`Confirm crossing #${crossing.track_id}`}
              onClick={() => onReview({ runId: run.id, trackId: crossing.track_id, action: 'valid' })}
            >
              Confirm
            </button>
            <button
              className="text-button"
              type="button"
              aria-label={`Mark crossing #${crossing.track_id} as false positive`}
              onClick={() => onReview({ runId: run.id, trackId: crossing.track_id, action: 'false_positive' })}
            >
              False positive
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ReportButtons({ runId, notify }: { runId: string; notify: Notify }) {
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);

  async function report(format: 'pdf' | 'csv') {
    if (busy) return;
    setBusy(format);
    try {
      await download(`/reports/${format}?run_id=${encodeURIComponent(runId)}`, `zenith-${runId.slice(0, 8)}.${format}`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="action-row">
      <button className="button secondary" type="button" disabled={!!busy} onClick={() => void report('pdf')}>
        {busy === 'pdf' ? 'Preparing PDF…' : 'Download PDF report'}
      </button>
      <button className="button secondary" type="button" disabled={!!busy} onClick={() => void report('csv')}>
        {busy === 'csv' ? 'Preparing CSV…' : 'Download CSV'}
      </button>
    </div>
  );
}

function observationText(run: Run, events: RunEvent[]) {
  const recorded = run.findings?.incident_count ?? 0;
  const base = events.length
    ? `${plural(events.length, 'rule observation')} with evidence below.`
    : recorded
      ? `${plural(recorded, 'observation')} recorded; open Incidents & evidence for available entries.`
      : 'No rule observations recorded. This does not establish safety.';
  return recorded > events.length ? `${base} Some older findings are outside the recent event list.` : base;
}

function RunFindings({
  run,
  events,
  source,
  notify,
  onReview,
}: {
  run: Run;
  events: RunEvent[];
  source: Source;
  notify: Notify;
  onReview: (target: ReviewTarget) => void;
}) {
  const crossings = run.crossings ?? [];
  const falsePositives = Object.values(run.crossing_reviews ?? {}).filter(r => r.action === 'false_positive').length;

  return (
    <div className="video-finding-run">
      <div className="workspace-run-heading">
        <h3><a href={runLink(run)}>{run.rule.name}</a></h3><span className={`badge ${run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'neutral'}`}>{runStatus(run)}</span>
      </div>
      {run.analysis_settings&&<p className="small-note">
        {[run.analysis_settings.engine,run.analysis_settings.checkpoint,run.analysis_settings.classifier].filter(Boolean).join(' · ')}
        {run.analysis_settings.action_confidence!=null&&' · Action threshold '+Math.round(run.analysis_settings.action_confidence*100)+'%'}
      </p>}

      {run.status !== 'completed' ? (
        <div className="workspace-run-progress" role={run.status==='failed'?'alert':'status'}>
          <p>{run.error || run.stage || 'Waiting for analysis worker'}</p>
          {run.status==='processing'&&<progress aria-label="Analysis progress" value={run.progress} max={100}/>}
          {run.status==='failed'&&<a className="text-link" href={'#studio/'+encodeURIComponent(source.id)}>Review the setup for this clip</a>}
        </div>
      ) : (
        <>
          <p>
            <strong>Analysis summary:</strong>{' '}
            {run.findings?.summary || 'This older run has no saved summary. Review its rule results and source video below.'}
          </p>
          {run.findings && <p className="small-note">{run.findings.limitations} · {run.findings.basis}</p>}

          <div className="video-finding-ai">
            <VisionSummary summary={run.vision_summary} />
          </div>

          <p><strong>Findings:</strong> {observationText(run, events)}</p>

          {run.rule.capability === 'traffic' && (
            <p className="small-note">
              Raw crossings: {crossings.length} · reviewed false positives: {falsePositives}. Raw counts and past
              carbon entries remain unchanged; new linked estimates exclude crossings reviewed as false positives.
            </p>
          )}

          {(events.length > 0 || crossings.length > 0) && (
            <FindingTimeline run={run} events={events} duration={source.duration} onReview={onReview} />
          )}

          <RunVideo run={run} events={events} />
          <ReportButtons runId={run.id} notify={notify} />

          {(run.rule.capability==='traffic'||run.rule.capability==='machine_activity') && (
            <a className="text-link" href={carbonLink(run)}>Calculate carbon with documented inputs →</a>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Source card                                                         */
/* ------------------------------------------------------------------ */

function SourceCard({
  source,
  runs,
  eventsByRun,
  detailed,
  notify,
  onReview,
}: {
  source: Source;
  runs: Run[];
  eventsByRun: Map<string, RunEvent[]>;
  detailed: boolean;
  notify: Notify;
  onReview: (target: ReviewTarget) => void;
}) {

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{source.name}</h2>
          <p>
            {source.duration.toFixed(1)}s · {source.input_type === 'sample' ? 'Packaged example' : source.camera_id ? 'Saved camera clip' : 'Uploaded clip'} ·{' '}
            {plural(runs.length, 'analysis run')}
          </p>
        </div>
        <div className="action-row">
          {!detailed && (
            <a className="button primary" href={`#videos/${encodeURIComponent(source.id)}`}>View analysis →</a>
          )}
          <a className="button secondary" href={'#studio/'+encodeURIComponent(source.id)}>
            <MonitorPlay size={16} aria-hidden="true" /> Analyze this clip
          </a>
        </div>
      </div>

      {!detailed ? (
        <p className="small-note">{runs[0]?.findings?.summary || 'Open this video to see its analysis and reports.'}</p>
      ) : runs.length ? (
        runs.map(run => (
          <RunFindings
            key={run.id}
            run={run}
            events={eventsByRun.get(run.id) ?? NO_EVENTS}
            source={source}
            notify={notify}
            onReview={onReview}
          />
        ))
      ) : (
        <>
          <SourceClip source={source} />
          <p>
            No analysis has run for this video. Open Studio, describe what you want to watch, review the suggested
            geometry, then confirm and run.
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function VideoFindings({
  data,
  connected,
  refresh,
  notify,
  selectedSourceId,
  selectedRunId,
}: {
  data: Data;
  connected: boolean;
  refresh: () => void;
  notify: Notify;
  selectedSourceId?: string;
  selectedRunId?: string;
}) {
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [focused, setFocused] = useState<{id:string; run?:Run; events?:RunEvent[]; error?:string}>();
  const [retry, setRetry] = useState(0);
  useEffect(()=>{
    if(!selectedRunId||!connected){setFocused(undefined);return;}
    const controller=new AbortController();
    let timer:number|undefined;
    const path='/runs/'+encodeURIComponent(selectedRunId);
    const load=async()=>{
      try {
        const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]);
        const run=await json<Run>(path,{signal});
        const events=run.status==='completed'?await json<RunEvent[]>(path+'/events',{signal}):NO_EVENTS;
        if(controller.signal.aborted)return;
        setFocused({id:selectedRunId,run,events});
        if(run.status==='queued'||run.status==='processing'||run.vision_summary?.status==='queued'||run.vision_summary?.status==='processing'){
          timer=window.setTimeout(load,2500);
        }
      }catch(error){
        if(!controller.signal.aborted)setFocused({id:selectedRunId,error:errorMessage(error)});
      }
    };
    void load();
    return ()=>{controller.abort();window.clearTimeout(timer);};
  },[selectedRunId,connected,retry]);


  const runsBySource = useMemo(() => groupBy(data.runs, run => run.source_id), [data.runs]);
  const eventsByRun = useMemo(() => groupBy(data.events, event => event.run_id), [data.events]);

  const selectedSource = data.sources.find(source => source.id === selectedSourceId);
  const visibleSources = selectedSourceId ? (selectedSource ? [selectedSource] : []) : data.sources;
  const detailed = Boolean(selectedSourceId);
  const selection=focused?.id===selectedRunId?focused:undefined;
  const fallbackRun=selectedSource?(runsBySource.get(selectedSource.id)??NO_RUNS).find(run=>run.id===selectedRunId):undefined;
  const selectedRun=selection?.run&&selection.run.source_id===selectedSourceId?selection.run:fallbackRun;

  async function saveReview(note: string) {
    if (!reviewTarget) return;
    const { runId, trackId, action } = reviewTarget;
    try {
      await json(`/runs/${runId}/crossings/${trackId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      });
      setReviewTarget(null);
      refresh();
      setRetry(value=>value+1);
      notify('Crossing review saved. Raw detector counts remain unchanged for audit.');
    } catch (error) {
      notify(errorMessage(error)); // dialog stays open so the note is not lost
    }
  }

  return (
    <>
      <div className="heading">
        <div>
          <div className="eyebrow">{selectedRunId?'ANALYSIS RUN':'MONITORING'}</div>
          <h1>{selectedSource?.name || 'Video findings'}</h1>
          <p>{selectedRunId?'Follow this run and review the results when it completes.':'Open a clip to see its analysis runs and review the evidence.'}</p>
        </div>
        <div className="action-row">
          {selectedSourceId&&<a className="button secondary" href={selectedRunId?'#videos/'+encodeURIComponent(selectedSourceId):'#videos'}>
            {selectedRunId?'All runs for this clip':'All videos'}
          </a>}
          <a className="button primary" href="#studio">
            <Camera size={17} aria-hidden="true" /> Upload or record
          </a>
        </div>
      </div>

      {selectedSourceId && !selectedSource && data.sources.length > 0 && (
        <p role="alert">This video is not in your workspace.</p>
      )}

      {selectedRunId ? (
        connected&&selectedSource&&selectedRun?
          <section className="panel workspace-run-detail" aria-label="Selected analysis">
            <RunFindings key={selectedRun.id} run={selectedRun} source={selectedSource}
              events={selection?.run?.id===selectedRun.id?selection.events??NO_EVENTS:eventsByRun.get(selectedRun.id)??NO_EVENTS}
              notify={notify} onReview={setReviewTarget}/>
            {selection?.error&&<p role="alert">{selection.error} <button className="text-button" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
          </section>
          : <section className="panel workspace-run-detail" aria-live="polite">
            <p>{selection?.error||(!connected?'Connect to load this analysis.':
              selection?.run?'This run does not belong to the selected clip.':'Loading analysis…')}</p>
            {selection?.error&&<button className="button secondary" onClick={()=>setRetry(n=>n+1)}>Retry</button>}
          </section>
      ) : data.sources.length ? (
        <div className="video-findings-list">
          {visibleSources.map(source => (
            <SourceCard
              key={source.id}
              source={source}
              runs={runsBySource.get(source.id) ?? NO_RUNS}
              eventsByRun={eventsByRun}
              detailed={detailed}
              notify={notify}
              onReview={setReviewTarget}
            />
          ))}
        </div>
      ) : (
        <section className="panel">
          <h2>No videos yet</h2>
          <p>Upload a permitted clip or record a short camera sample in Monitoring studio.</p>
        </section>
      )}

      <ReviewDialog target={reviewTarget} onCancel={() => setReviewTarget(null)} onSubmit={saveReview} />
    </>
  );
}
