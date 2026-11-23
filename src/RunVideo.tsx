import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import type { Incident, Run } from './types';

export function carbonLink(run: Run) {
  return `#carbon/${encodeURIComponent(run.id)}`;
}

export default function RunVideo({run, events = []}: {run: Run; events?: Incident[]}) {
  const player = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [pendingTime, setPendingTime] = useState<number | null>(null);
  const crossings = run.crossings ?? [];
  const active = crossings.find(item => Math.abs(item.source_seconds - seconds) < 0.18);
  const total = Object.values(run.counts).reduce((sum, count) => sum + count, 0);
  const incidents = events.filter(event => event.run_id === run.id);
  const countSoFar = crossings.filter(item => item.source_seconds <= seconds + 0.001).length;

  useEffect(() => {
    if (!attempt) return;
    setFailure('');
    const controller = new AbortController();
    let asset = '';
    request(`/sources/${run.source_id}/video`, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])})
      .then(response => response.blob())
      .then(blob => {
        if (controller.signal.aborted) return;
        asset = URL.createObjectURL(blob);
        setUrl(asset);
      })
      .catch(error => {
        if (!controller.signal.aborted) setFailure((error as Error).message);
      });
    return () => {
      controller.abort();
      if (asset) URL.revokeObjectURL(asset);
    };
  }, [attempt, run.source_id]);

  function jump(time: number) {
    if (!attempt || failure) setAttempt(previous => previous + 1);
    if (player.current?.readyState) {
      player.current.pause();
      player.current.currentTime = time;
      setSeconds(time);
    } else {
      setPendingTime(time);
    }
  }

  return <div className="run-video">
    {url ? <div className="run-video-player">
      <video ref={player} src={url} controls playsInline aria-label={run.source_name}
        onTimeUpdate={event => setSeconds(event.currentTarget.currentTime)}
        onLoadedMetadata={event => {
          if (pendingTime !== null) {
            event.currentTarget.currentTime = pendingTime;
            setSeconds(pendingTime);
            setPendingTime(null);
          }
        }}/>
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {run.rule.capability === 'traffic'
          ? <line x1={run.rule.points[0][0] * 1000} y1={run.rule.points[0][1] * 1000}
                  x2={run.rule.points[1][0] * 1000} y2={run.rule.points[1][1] * 1000}/>
          : <polygon points={run.rule.points.map(([x,y]) => `${x * 1000},${y * 1000}`).join(' ')}/>}
        {active && <rect x={active.box[0] * 1000} y={active.box[1] * 1000}
          width={(active.box[2] - active.box[0]) * 1000} height={(active.box[3] - active.box[1]) * 1000}/>}
      </svg>
    </div> : <button className="button secondary" type="button" disabled={attempt > 0 && !failure}
      onClick={() => setAttempt(previous => previous + 1)}>{attempt > 0 && !failure ? 'Loading source video…' : 'Load source video'}</button>}
    {failure && <p role="alert">{failure}</p>}
    {run.rule.capability === 'traffic' && <p>
      <strong>{total} crossings</strong> · {Object.entries(run.counts).map(([name, count]) => `${name} ${count}`).join(' · ')}
      {url && crossings.length > 0 && <> · {countSoFar} at playback position{active && <> · {active.vehicle_class} #{active.track_id}</>}</>}
    </p>}
    {crossings.length > 0 && <div className="run-video-markers" aria-label="Crossing timestamps">
      {crossings.map(item => <button key={item.track_id} type="button" className="button secondary" onClick={() => jump(item.source_seconds)}>
        {item.source_seconds.toFixed(2)}s · {item.vehicle_class} #{item.track_id} · {item.direction}
      </button>)}
    </div>}
    {run.rule.capability === 'traffic' && total > crossings.length &&
      <p className="small-note">Timestamps are available for {crossings.length} of {total} crossings in this run.</p>}
    {incidents.length > 0 && <div className="run-video-markers" aria-label="Incident timestamps">
      {incidents.map(item => <button key={item.id} type="button" className="button secondary" onClick={() => jump(item.source_seconds)}>
        {item.source_seconds.toFixed(2)}s · {item.title}
      </button>)}
    </div>}
  </div>;
}
