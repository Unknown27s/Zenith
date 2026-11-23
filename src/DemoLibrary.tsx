import AutomaticDemo from './AutomaticDemo';
import { ArrowDownToLine, ArrowUpRight, Camera, Clock3, Film, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import manifest from '../public/examples/manifest.json';
import { json } from './api';
import type { Source } from './types';

const datasets = [
  {
    title: 'Highway Traffic Videos',
    provider: 'Kaggle · aryashah2k',
    tag: 'TRAFFIC DEMO CANDIDATE',
    description: 'Fixed-camera highway footage with light, medium and heavy traffic. Use a short clip with a user-confirmed counting line.',
    size: 'About 63 MB archive',
    license: 'Uploader lists CC0. Original description credits WSDOT and requests a paper citation; confirm underlying reuse rights.',
    note: 'The description reports a corrupt first frame. Inspect and trim the clip if needed before uploading. No detector/count accuracy is pre-validated.',
    page: 'https://www.kaggle.com/datasets/aryashah2k/highway-traffic-videos-dataset',
    download: 'https://www.kaggle.com/api/v1/datasets/download/aryashah2k/highway-traffic-videos-dataset',
  },
  {
    title: 'AAU RainSnow Traffic Surveillance',
    provider: 'Kaggle · Aalborg University',
    tag: 'CHALLENGING TRAFFIC FOOTAGE',
    description: 'RGB and thermal traffic surveillance in rain, snow and variable illumination. Better for later robustness work than the first presentation.',
    size: 'About 3.39 GB dataset',
    license: 'Kaggle lists CC BY 4.0. Provide attribution and review the original authors’ terms and citation requirements.',
    note: 'Includes long sequences/frame pairs and annotations. Prepare a short RGB video; this app does not ingest dataset archives or frame directories.',
    page: 'https://www.kaggle.com/datasets/aalborguniversity/aau-rainsnow',
    download: '',
  },
  {
    title: 'Multiple Cameras Fall Dataset',
    provider: 'Kaggle · soumicksarker',
    tag: 'FALL DETECTION RESEARCH',
    description: 'Simulated falls and normal daily activities captured with multiple cameras. A research reference for evaluating pose-based fall recognition.',
    size: 'About 3.78 GB dataset',
    license: 'License is “Other (specified in description)”. Permission is unresolved: do not redistribute it as a public demo bundle.',
    note: 'The prototype uses a separately trained pose checkpoint. Check the dataset terms before publishing any clip.',
    page: 'https://www.kaggle.com/datasets/soumicksarker/multiple-cameras-fall-dataset',
    download: '',
  },
];

export default function DemoLibrary({connected, workerOnline, notify, refresh, actionReady}: {connected: boolean; workerOnline: boolean; actionReady: boolean; notify: (message: string) => void; refresh: () => void}) {
  const [busy, setBusy] = useState('');
  async function useExample(item: typeof manifest[number]) {
    setBusy(item.id);
    try {
      const source = await json<Source>(`/sources/sample/${item.id}`, {method: 'POST'});
      sessionStorage.setItem('zenith.source', source.id);
      sessionStorage.setItem('zenith.capability', item.capability);
      sessionStorage.setItem('zenith.instruction', item.instruction);
      refresh(); window.location.hash = 'studio';
      notify('Example imported. Review the suggested analysis settings before running.');
    } catch (error) { notify((error as Error).message); }
    finally { setBusy(''); }
  }
  return <>
    <div className="heading"><div><div className="eyebrow">FOOTAGE TO GET STARTED</div><h1>Choose a real source. Keep its context.</h1><p>Download from the original provider, inspect the clip, then upload it to the monitoring studio.</p></div><a className="button primary" href="#studio"><Camera size={17}/> Open studio</a></div>
    <AutomaticDemo connected={connected} workerOnline={workerOnline} actionReady={actionReady} refresh={refresh}/>
    <div className="info-note"><strong>Example footage for every supported capability.</strong> Preview or download the clips below, then use one in the studio. They are real source excerpts, not fabricated detector outputs. Studio suggests editable geometry; check it against the footage before confirming. Source credit and license travel with each example.</div>
    <div className="example-video-grid">{manifest.map(item => <section className="panel example-video-card" key={item.id}>
      <video controls playsInline preload="metadata" src={`/examples/${item.file}`} aria-label={item.title}/>
      <div className="example-video-body"><span className="badge">{item.capability === 'zone' ? 'PEOPLE / ZONE' : item.capability === 'traffic' ? 'TRAFFIC / CARBON INPUT' : item.capability === 'action' ? 'FIGHT / FALL TEST CLIP' : 'EQUIPMENT / MOTION PROXY'}</span><h2>{item.title}</h2><p>{item.description}</p><blockquote>{item.instruction}</blockquote>
      <p className="example-credit">{item.credit}<br/><a href={item.licenseUrl} target="_blank" rel="noopener noreferrer">{item.license}</a> · <a href={item.source} target="_blank" rel="noopener noreferrer">Original source ↗</a></p><p className="example-credit">{item.changes}</p>
      <div className="action-row"><button className="button primary" disabled={!connected || !!busy} onClick={() => void useExample(item)}>{busy === item.id ? 'Importing…' : 'Use in studio'}</button><a className="button secondary" download href={`/examples/${item.file}`}><ArrowDownToLine size={16}/> Download video</a></div></div>
    </section>)}</div>
    <div className="heading section-gap"><div><div className="eyebrow">ADDITIONAL RESEARCH SOURCES</div><h2>More footage on Kaggle</h2><p>External datasets may need login, trimming, attribution or permission. Unsupported detectors are labelled explicitly.</p></div></div>
    <div className="dataset-grid">{datasets.map(dataset => <section className="panel dataset-card" key={dataset.page}>
      <div className="dataset-top"><span className="stat-icon mint"><Film size={23}/></span><span className="badge">{dataset.tag}</span></div>
      <p className="dataset-provider">{dataset.provider}</p><h2>{dataset.title}</h2><p>{dataset.description}</p>
      <div className="dataset-size"><ArrowDownToLine size={16}/>{dataset.size}</div>
      <div className="dataset-license"><ShieldCheck size={18}/><p>{dataset.license}</p></div><p className="dataset-note">{dataset.note}</p>
      <div className="action-row"><a className="button secondary" href={dataset.page} target="_blank" rel="noopener noreferrer">Dataset & terms <ArrowUpRight size={16}/></a>{dataset.download && <a className="button primary" href={dataset.download} target="_blank" rel="noopener noreferrer"><ArrowDownToLine size={16}/> Download ZIP</a>}</div>
    </section>)}</div>
    <section className="panel section-gap"><div className="panel-heading"><div><h2>For a convincing safety or equipment demo</h2><p>Your own consenting, fixed-camera clip is often the clearest starting point.</p></div><Clock3 size={23}/></div><div className="demo-guide"><div><strong>Restricted-zone dwell</strong><p>Record one permitted zone entry and a separate walk-past. Draw the region yourself and check what the rule actually produces.</p></div><div><strong>Equipment activity</strong><p>Record visible movement in a fixed region. Use the operation log or control-panel observation for true ON/OFF state; pixel motion alone is not power state.</p></div><div><strong>Upload limits</strong><p>Default limits are 100 MB and 180 seconds. Prefer a 10–30 second clip for the presentation. Never fabricate carbon factors or expected detections.</p></div></div></section>
  </>;
}
