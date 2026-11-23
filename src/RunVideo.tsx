import { useEffect, useRef, useState } from 'react';
import { Play, RotateCw } from 'lucide-react';
import { request } from './api';
import type { Incident, Run } from './types';

export function carbonLink(run: Run) {
  return `#carbon/${encodeURIComponent(run.id)}`;
}

const LOAD_TIMEOUT_MS = 120_000;
const MATCH_WINDOW = 0.18;

export default function RunVideo({run, events = [], autoLoad = false}: {
  run: Run; events?: Incident[]; autoLoad?: boolean;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [attempt, setAttempt] = useState(autoLoad ? 1 : 0);
  const [failure, setFailure] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState<{time: number; play: boolean} | null>(null);

  const counts = run.counts ?? {};
  const crossings = run.crossings ?? [];
  const points = run.rule.points ?? [];
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const incidents = events.filter(event => event.run_id === run.id);
  const active = crossings.find(item => Math.abs(item.source_seconds - seconds) < MATCH_WINDOW);
  const countSoFar = crossings.filter(item => item.source_seconds <= seconds + 0.001).length;
  const loading = attempt > 0 && !url && !failure;

  // Download the source video as a blob.
  useEffect(() => {
    if (!attempt) return;
    setFailure('');
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, LOAD_TIMEOUT_MS);
    let asset = '';
    request(`/sources/${run.source_id}/video`, {signal: controller.signal})
      .then(response => {
        if (!response.ok) throw new Error(`Could not load the video (HTTP ${response.status}).`);
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        asset = URL.createObjectURL(blob);
        setUrl(asset);
      })
      .catch(error => {
        if (timedOut) setFailure('Loading the video timed out. Please try again.');
        else if (!controller.signal.aborted) setFailure((error as Error).message || 'Could not load the video.');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (asset) URL.revokeObjectURL(asset);
      setUrl('');
      setPlaying(false);
      setSeconds(0);
    };
  }, [attempt, run.source_id]);

  // Smooth overlay updates while playing (timeupdate only fires ~4x per second).
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (player.current) setSeconds(player.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function load() {
    setAttempt(previous => previous + 1);
  }

  function jump(time: number | undefined) {
    if (time === undefined || Number.isNaN(time)) return;
    wrapper.current?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    const video = player.current;
    if (video?.readyState) {
      video.currentTime = time;
      setSeconds(time);
      void video.play().catch(() => undefined);
    } else {
      setPending({time, play: true});
      if (!attempt || failure) load();
    }
  }

  const overlayReady = (run.rule.capability === 'traffic' ? points.length >= 2 : points.length >= 3);

  return <div className="run-video" ref={wrapper}>
    {url ? <div className="run-video-player">
      <video ref={player} src={url} controls playsInline preload="metadata" aria-label={run.source_name}
        onTimeUpdate={event => { if (!playing) setSeconds(event.currentTarget.currentTime); }}
        onPlay={() => setPlaying(true)}
        onPause={event => { setPlaying(false); setSeconds(event.currentTarget.currentTime); }}
        onEnded={() => setPlaying(false)}
        onSeeked={event => setSeconds(event.currentTarget.currentTime)}
        onLoadedMetadata={event => {
          if (!pending) return;
          event.currentTarget.currentTime = pending.time;
          setSeconds(pending.time);
          if (pending.play) void event.currentTarget.play().catch(() => undefined);
          setPending(null);
        }}/>
      {overlayReady && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {run.rule.capability === 'traffic'
          ? [points.slice(0,2),points.slice(2,4)].filter(gate=>gate.length===2).map(([a,b], i) =>
            <g key={i}>
              <line x1={a[0]*1000} y1={a[1]*1000} x2={b[0]*1000} y2={b[1]*1000}/>
              {run.rule.segment_metres && (
                <text x={a[0]*1000+10} y={a[1]*1000-8} fill="#d0ec85" fontSize="26" fontWeight="bold">
                  {i === 0 ? 'Gate A' : 'Gate B'}
                </text>
              )}
            </g>)
          : <polygon points={points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')}/>}
        {active && <rect x={active.box[0] * 1000} y={active.box[1] * 1000}
          width={(active.box[2] - active.box[0]) * 1000} height={(active.box[3] - active.box[1]) * 1000}/>}
      </svg>}
    </div> : <button className="button secondary run-video-load" type="button" disabled={loading} onClick={load}>
      {failure ? <RotateCw size={15}/> : <Play size={15}/>}
      {loading ? 'Loading source video…' : failure ? 'Retry loading video' : 'Load source video'}
    </button>}

    {failure && <p role="alert" className="error-text">{failure}</p>}

    {run.rule.capability === 'traffic' && <div className="run-video-summary">
      <strong>{total} {run.rule.segment_metres?"completed traversals":"crossings"}</strong>
      <span>{Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(' · ') || 'No vehicles counted'}</span>
      {url && crossings.length > 0 && <span className="run-video-live">
        {countSoFar} so far{active && <> · {active.vehicle_class} #{active.track_id}</>}
      </span>}
    </div>}

    {run.rule.capability === 'action' && <div className="run-video-summary">
      <strong>{incidents.length} {incidents.length === 1 ? 'flagged observation' : 'flagged observations'}</strong>
      <span>Action analysis · Pose classifier</span>
    </div>}

    {run.rule.capability === 'zone' && <div className="run-video-summary">
      <strong>{incidents.length} {incidents.length === 1 ? 'zone observation' : 'zone observations'}</strong>
      <span>{run.rule.dwell_seconds}s dwell threshold</span>
    </div>}

    {run.rule.capability === 'machine_activity' && <div className="run-video-summary">
      <strong>{run.activity_seconds?.toFixed(2) ?? '0.00'}s visible motion</strong>
      <span>Motion proxy analysis</span>
    </div>}

    {crossings.length > 0 && <div className="run-video-markers" role="group" aria-label="Crossing timestamps">
      {crossings.map((item, index) => <button key={`${item.track_id}-${index}`} type="button"
        className={`button secondary${item === active ? ' current' : ''}`}
        aria-current={item === active ? 'true' : undefined}
        onClick={() => jump(item.source_seconds)}>
        {item.source_seconds.toFixed(2)}s · {item.vehicle_class} #{item.track_id} · {item.direction}
      </button>)}
    </div>}
    {run.rule.capability === 'traffic' && total > crossings.length &&
      <p className="small-note">Timestamps are available for {crossings.length} of {total} {run.rule.segment_metres?"completed traversals":"crossings"} in this run.</p>}

    {incidents.length > 0 && <div className="run-video-markers" role="group" aria-label="Incident timestamps">
      {incidents.map(item => <button key={item.id} type="button" className="button secondary"
        onClick={() => jump(item.source_seconds)}>
        {item.source_seconds?.toFixed(2) ?? '0.00'}s · {item.title}
      </button>)}
    </div>}
  </div>;
}
