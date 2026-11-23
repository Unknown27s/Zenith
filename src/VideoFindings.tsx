import { useEffect, useState } from 'react';
import { Camera, MonitorPlay } from 'lucide-react';
import RunVideo, { carbonLink } from './RunVideo';
import { download, json, request } from './api';
import type { Data, Source } from './types';

function EvidenceThumb({path}: {path:string}) {
  const [url,setUrl] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    request(path,{signal:controller.signal}).then(response=>response.blob()).then(blob=>{
      if (!controller.signal.aborted) { objectUrl=URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(()=>{});
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [path]);
  return url ? <img src={url} alt="Recorded evidence frame" className="finding-thumb"/> : null;
}

function SourceClip({source}: {source:Source}) {
  const [url,setUrl] = useState('');
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  async function load() {
    try {setUrl(URL.createObjectURL(await (await request(`/sources/${source.id}/video`)).blob()));}
    catch { /* The protected video is still available through Studio when connected. */ }
  }
  return url ? <video className="camera-preview" src={url} controls playsInline/> :
    <button className="button secondary" type="button" onClick={()=>void load()}>Play uploaded video</button>;
}

export default function VideoFindings({data,refresh,notify,selectedSourceId}: {data: Data; refresh:()=>void; notify:(message:string)=>void; selectedSourceId?:string}) {
  const selectedSource = data.sources.find(source=>source.id===selectedSourceId);
  async function report(runId:string, format:'pdf'|'csv') {
    try {await download(`/reports/${format}?run_id=${encodeURIComponent(runId)}`,`zenith-${runId.slice(0,8)}.${format}`);}
    catch(error) {notify((error as Error).message);}
  }
  async function review(runId:string, trackId:number, action:'valid'|'false_positive') {
    const note = window.prompt(`Why is this crossing ${action === 'valid' ? 'valid' : 'a false positive'}?`);
    if (!note) return;
    try {
      await json(`/runs/${runId}/crossings/${trackId}/review`,
        {method:'POST',body:JSON.stringify({action,note})});
      refresh();
      notify('Crossing review saved. Raw detector counts remain unchanged for audit.');
    } catch(error) {notify((error as Error).message);}
  }
  function edit(source: Source) {
    sessionStorage.setItem('zenith.source', source.id);
    window.location.hash = 'studio';
  }
  return <>
    <div className="heading"><div><div className="eyebrow">ONE VIDEO · ITS ACTUAL FINDINGS</div>
      <h1>{selectedSource?.name||'Video findings'}</h1>
      <p>Each clip and analysis run has its own results. A summary is saved when analysis finishes; optional AI interpretation requires separate consent.</p>
    </div><div className="action-row">{selectedSource&&<a className="button secondary" href="#videos">← All videos</a>}<a className="button primary" href="#studio"><Camera size={17}/> Upload or record</a></div></div>
    {selectedSourceId&&!selectedSource&&data.sources.length>0&&<p role="alert">This video is not in your workspace.</p>}
    {data.sources.length ? <div className="video-findings-list">{(selectedSourceId?(selectedSource?[selectedSource]:[]):data.sources).map(source => {
      const runs = data.runs.filter(run => run.source_id === source.id);
      return <section className="panel" key={source.id}>
        <div className="panel-heading"><div><h2>{source.name}</h2>
          <p>{source.duration.toFixed(1)}s · {source.input_type === 'sample' ? 'Packaged example' : 'Uploaded clip'} · {runs.length} analysis run(s)</p>
        </div><div className="action-row">{!selectedSourceId&&<a className="button primary" href={`#videos/${encodeURIComponent(source.id)}`}>View analysis →</a>}<button className="button secondary" type="button" onClick={() => edit(source)}><MonitorPlay size={16}/> Analyze this clip</button></div></div>
        {selectedSourceId ? runs.length ? runs.map(run => {
          const events = data.events.filter(event => event.run_id === run.id);
          return <div className="video-finding-run" key={run.id}>
            <h3>{run.rule.name} · {run.status}</h3>
            {run.status === 'completed' ? <>
              <p><strong>Analysis summary:</strong> {run.findings?.summary || 'This older run has no saved summary. Review its rule results and source video below.'}</p>
              {run.findings && <p className="small-note">{run.findings.limitations} · {run.findings.basis}</p>}
              <div className="video-finding-ai">{run.vision_summary?.status === 'completed'
                ? <><p><strong>AI sample-frame summary:</strong> {run.vision_summary.summary}</p><p className="small-note">{run.vision_summary.limitations}</p></>
                : run.vision_summary?.status === 'failed' ? <p>AI summary unavailable: {run.vision_summary.error}</p>
                : run.vision_summary?.status === 'queued' || run.vision_summary?.status === 'processing' ? <p>AI sample-frame summary {run.vision_summary.status}…</p>
                : <p className="small-note">No AI frames shared. Enable hosted vision and explicitly consent in Studio to request an optional AI summary on a new run.</p>}</div>
              <p><strong>Findings:</strong> {events.length ? `${events.length} rule observation(s) with evidence below.` : run.findings?.incident_count ? `${run.findings.incident_count} observation(s) recorded; open Incidents & evidence for available entries.` : 'No rule observations recorded. This does not establish safety.'}
              {!!run.findings && run.findings.incident_count > events.length && ' Some older findings are outside the recent event list.'}</p>
              {run.rule.capability === 'traffic' && <p className="small-note">
                Raw crossings: {(run.crossings||[]).length} · reviewed false positives: {Object.values(run.crossing_reviews||{}).filter(x=>x.action==='false_positive').length}.
                Raw counts and past carbon entries remain unchanged; new linked estimates exclude crossings reviewed as false positives.
              </p>}
              {(events.length>0||!!run.crossings?.length)&&<div className="finding-timeline" aria-label="Video finding timeline">
                <div className="finding-timeline-track">{[...events.map(event=>({id:event.id,time:event.source_seconds})),
                  ...(run.crossings||[]).map(crossing=>({id:String(crossing.track_id),time:crossing.source_seconds}))].map(mark=>
                    <span key={mark.id} style={{left:`${Math.max(0,Math.min(100,mark.time/source.duration*100))}%`}}/>)}</div>
                {events.map(event=><a className="finding-marker" key={event.id} href={`#incidents/${event.id}`}>
                  {!!event.frames.length&&<EvidenceThumb path={`/events/${event.id}/evidence/${event.frames[0]}`}/>}
                  <span>{event.source_seconds.toFixed(2)}s · {event.title} · {event.operator_status}</span>
                </a>)}
                {(run.crossings||[]).map(crossing=><div className="finding-marker" key={`${crossing.track_id}-${crossing.source_seconds}`}>
                  <span>{crossing.source_seconds.toFixed(2)}s · {crossing.vehicle_class} #{crossing.track_id} · {run.crossing_reviews?.[crossing.track_id]?.action||'unreviewed'}</span>
                  <button className="text-button" type="button" onClick={()=>void review(run.id,crossing.track_id,'valid')}>Confirm</button>
                  <button className="text-button" type="button" onClick={()=>void review(run.id,crossing.track_id,'false_positive')}>False positive</button>
                </div>)}
              </div>}
              <RunVideo run={run} events={events}/>
              <div className="action-row"><button className="button secondary" type="button" onClick={()=>void report(run.id,'pdf')}>Download PDF report</button>
                <button className="button secondary" type="button" onClick={()=>void report(run.id,'csv')}>Download CSV</button></div>
              {run.rule.capability !== 'zone' && <a className="text-link" href={carbonLink(run)}>Calculate carbon with documented inputs →</a>}
            </> : <p>{run.error || run.stage || 'Waiting for analysis worker'}{run.status === 'processing' ? ` · ${run.progress}%` : ''}</p>}
          </div>;
        }) : <><SourceClip source={source}/><p>No analysis has run for this video. Open Studio, describe what you want to watch, review the suggested geometry, then confirm and run.</p></>
        : <p className="small-note">{runs[0]?.findings?.summary||'Open this video to see its analysis and reports.'}</p>}
      </section>;
    })}</div> : <section className="panel"><h2>No videos yet</h2><p>Upload a permitted clip or record a short camera sample in Monitoring studio.</p></section>}
  </>;
}
