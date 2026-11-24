import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, BookOpen, Boxes, Camera, Check, ChevronRight, CircleHelp, Clock3, Cpu, FileText, Film, Leaf, LoaderCircle, Menu, MonitorPlay, Plus, Radio, Settings2, ShieldCheck, Sparkles, Upload, X, Zap } from 'lucide-react';
import { connection, download, ensureLocalSession, json, request } from './api';
import type { Capability, CarbonEntry, CarbonEstimate, Data, Incident, Page, Point, Run, Source, VisionStatus } from './types';
import EquipmentPanel from './EquipmentPanel';
import DemoLibrary from './DemoLibrary';
import RunVideo from './RunVideo';
import DetectorSettings, { detectorPreset } from './DetectorSettings';
import { suggestedPoints } from './geometry';
import VideoFindings from './VideoFindings';
import CameraCapture from './CameraCapture';
import NetworkCamera from './NetworkCamera';
import CamerasPage from './CamerasPage';
import OperatorKeys from './OperatorKeys';
import HealthPanel from './HealthPanel';
import DemoSetup from './DemoSetup';
import FactorLibrary, { type SavedFactor } from './FactorLibrary';
import { analysisModes, runLink, runStatus } from './workflow';

const navigation: {id: Page; label: string; icon: typeof Activity}[] = [
  {id:'overview',label:'Overview',icon:Boxes}, {id:'studio',label:'Monitoring studio',icon:MonitorPlay},
  {id:'cameras',label:'Cameras & live streams',icon:Camera},
  {id:'videos',label:'Video findings',icon:Film}, {id:'demos',label:'Demo footage',icon:ArrowDownToLine},
  {id:'incidents',label:'Incidents & evidence',icon:ShieldCheck}, {id:'carbon',label:'Carbon & energy',icon:Leaf},
  {id:'reports',label:'Reports',icon:FileText}, {id:'how',label:'How it works',icon:BookOpen},
];
const titles: Record<Page, string> = {overview:'Workspace overview',studio:'Monitoring studio',cameras:'Cameras & live streams',videos:'Video findings',demos:'Demo footage library',incidents:'Incidents & evidence',carbon:'Carbon & energy',reports:'Reports',how:'How Zenith works',settings:'Connection & settings'};
const empty: Data = {status:null,sources:[],runs:[],events:[],carbon:[],notifications:[]};
const number = (n: number) => new Intl.NumberFormat('en-IN', {maximumFractionDigits:3}).format(n);
const date = (n: number) => new Date(n*1000).toLocaleString();
// Telegram recipients are stored as telegram:<chat id>.
const recipientLabel = (value: string) => value.startsWith('telegram:') ? 'Telegram · chat ' + value.slice(9) : value;
function routePage(route: string): Page { const [page] = route.split('/'); return Object.hasOwn(titles,page) ? page as Page : 'overview'; }

function Badge({children, tone='neutral'}: {children: ReactNode; tone?: string}) { return <span className={`badge ${tone}`}>{children}</span>; }
function Empty({icon: Icon=Camera, title, children, action}: {icon?: typeof Camera; title: string; children: ReactNode; action?: ReactNode}) { return <div className="empty"><span className="empty-icon"><Icon size={25}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
function Heading({eyebrow, title, children, action}: {eyebrow: string;title: string; children: ReactNode; action?: ReactNode}) { return <div className="heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{children}</p></div>{action}</div>; }
function ProtectedImage({path, alt, className=''}: {path: string;alt: string;className?: string}) {
  const [url,setUrl] = useState(''); const [error,setError] = useState(false);
  useEffect(() => { let active=true; let objectUrl=''; const controller=new AbortController(); setUrl(''); setError(false);
    request(path,{signal:controller.signal}).then(r=>r.blob()).then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(()=>{if(active)setError(true);});
    return ()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[path]);
  return url ? <img className={className} src={url} alt={alt}/> : <div className={`image-placeholder ${className}`}>{error?'Evidence unavailable':<LoaderCircle className="spin" size={18}/>}</div>;
}

export default function App() {
  const [route,setRoute]=useState(()=>window.location.hash.slice(1));
  const page=routePage(route);
  const [,selectedId='',selectedAnalysisId='']=route.split('/'); const [data,setData]=useState<Data>(empty);
  const [connected,setConnected]=useState(false);
  const [connecting,setConnecting]=useState(true);
  const workspaceConnection=useRef(connection()); const [failure,setFailure]=useState('');
  const [notice,setNotice]=useState(''); const [mobile,setMobile]=useState(false); const [revision,setRevision]=useState(0);
  const notify=useCallback((message:string)=>setNotice(message),[]);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{const change=()=>{setRoute(window.location.hash.slice(1));setMobile(false);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{document.title = `${titles[page] || 'Workspace'} · Zenith`;},[page]);
  useEffect(()=>{if(!notice)return;const t=window.setTimeout(()=>setNotice(''),6500);return()=>window.clearTimeout(t);},[notice]);
  useEffect(()=>{
    const current=connection();
    if(current.base!==workspaceConnection.current.base||current.key!==workspaceConnection.current.key){
      workspaceConnection.current=current;
      setData(empty);
      setConnected(false);
      setConnecting(true);
    }
    let active=true;let timer:number;const controller=new AbortController();
    const load=async()=>{
      try {
        const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]);
        if(!connection().base)await ensureLocalSession(signal);
        if(connection().base&&!connection().key)throw new Error('Enter the operator key in Connection Settings for this remote backend.');
        const [status,sources,runs,events,carbon,notifications]=await Promise.all([json<Data['status']>('/status',{signal}),json<Source[]>('/sources',{signal}),json<Run[]>('/runs',{signal}),json<Incident[]>('/events',{signal}),json<CarbonEntry[]>('/carbon',{signal}),json<Data['notifications']>('/notifications',{signal})]);
        if(active){setData({status,sources,runs,events,carbon,notifications});setConnected(true);setConnecting(false);setFailure('');}
      }catch(error){if(active){setConnected(false);setConnecting(false);setFailure((error as Error).message);}}
      if(active)timer=window.setTimeout(load,4000);
    };void load();return()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[revision]);
  const props={data,connected,notify,refresh};
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.querySelector<HTMLElement>('main')?.focus();}}>Skip to main content</a>
    {mobile&&<div className="scrim" onClick={()=>setMobile(false)}/>}
    <aside className={`sidebar ${mobile?'open':''}`}>
      <a href="#overview" className="brand"><span className="brand-symbol">Z<span/></span><span>zenith<span className="brand-dot">.</span></span></a>
      <div className="workspace"><span className="workspace-avatar">TZ</span><div><strong>Team Zenith</strong><small>Operations workspace</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(({id,label,icon:Icon})=><a key={id} className={page===id?'active':''} href={`#${id}`} aria-current={page===id?'page':undefined}><Icon size={19}/><span>{label}</span>{id==='incidents'&&connected&&data.events.filter(x=>x.operator_status==='suspected').length>0&&<span className="nav-count">{data.events.filter(x=>x.operator_status==='suspected').length}</span>}</a>)}</nav>
      <div className="sidebar-bottom">
        <a className={page==='settings'?'settings-link active':'settings-link'} href="#settings"><Settings2 size={18}/> Health & settings</a>
        <div className="operator"><span className="operator-avatar">Z</span><div><strong>{data.status?.is_admin?'Administrator':'Operator'}</strong><small>{connected?'Workspace connected':connecting?'Connecting':'Workspace disconnected'}</small></div></div>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-toggle" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={20}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{titles[page]}</strong></div><div className="topbar-right"><span className="environment"><span className={`status-dot ${connected?'on':''}`}/>{connected?'Backend connected':'Not connected'}</span><a href="#how" aria-label="How it works" className="icon-button"><CircleHelp size={19}/></a><a href="#incidents" aria-label="Open incidents" className="icon-button"><Bell size={19}/></a><span className="top-avatar">TZ</span></div></header>
      <main className="content" id="main-content" tabIndex={-1}>
        {!connected&&page!=='settings'&&<div className="connection-banner" role="status">
          <Radio size={16}/><span>{connecting?'Connecting to the workspace…':failure}</span>
          {!connecting&&<a href="#settings">Connection settings <ArrowRight size={14}/></a>}
        </div>}
        {page==='overview'&&<Overview {...props}/>}
        {page==='studio'&&<Studio key={selectedId} {...props} selectedSourceId={selectedId}/>}
        {page==='cameras'&&<CamerasPage {...props} selectedId={selectedId}/>}
        {page==='videos'&&<VideoFindings data={data} connected={connected} refresh={refresh} notify={notify} selectedSourceId={selectedId} selectedRunId={selectedAnalysisId}/>}
        <div hidden={page!=='demos'}><DemoLibrary actionReady={!!data.status?.models?.action.checkpoint_present} connected={connected} workerOnline={!!data.status?.worker_online} notify={notify} refresh={refresh}/></div>
        {page==='incidents'&&<Incidents key={selectedId} {...props} selectedId={selectedId}/>}
        {page==='carbon'&&<Carbon {...props} requestedRunId={selectedId}/>}
        {page==='reports'&&<Reports {...props}/>}
        {page==='how'&&<HowItWorks/>}
        {page==='settings'&&<Settings {...props}/>}

      </main>
    </div>{notice&&<div className="toast" role="status"><Activity size={18}/><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={16}/></button></div>}
  </div>;
}
interface Props {data: Data;connected:boolean;notify:(message:string)=>void;refresh:()=>void}

function Overview({data,connected}: Props) {
  const pending=data.events.filter(event=>event.operator_status==='suspected');
  const active=data.runs.filter(run=>run.status==='queued'||run.status==='processing');
  const workerReady=connected&&!!data.status?.worker_online;
  return <>
    <Heading eyebrow="ZENITH WORKSPACE" title="Operations overview" action={
      <a className="button primary" href="#studio"><Plus size={17}/> New analysis</a>
    }>Track analysis progress, review evidence, and open saved carbon estimates.</Heading>
    <section className="panel workspace-overview">
      <div className="workspace-readiness">
        <div>
          <h2>Analysis status</h2>
          <p>{!connected?'Connect the workspace to see its analysis status.':workerReady
            ?'The worker is accepting queued analyses.'
            :'Start the analysis worker before submitting footage.'}</p>
        </div>
        <a className="button secondary" href="#settings"><Activity size={16}/> Check system health</a>
      </div>
      <dl className="workspace-metrics">
        <div><dt>Connection</dt><dd>{connected?'Connected':'Disconnected'}</dd></div>
        <div><dt>Analysis worker</dt><dd>{connected?(workerReady?'Online':'Offline'):'Unknown'}</dd></div>
        <div><dt>In progress</dt><dd>{connected?active.length:'—'}</dd></div>
        <div><dt>Needs review</dt><dd>{connected?pending.length:'—'}</dd></div>
      </dl>
    </section>
    <div className="overview-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>Recent analyses</h2><p>Open a run to see progress and evidence.</p></div><a href="#videos">All videos <ArrowUpRight size={15}/></a></div>
        {connected&&data.runs.length?<RunList runs={data.runs.slice(0,5)}/>:<Empty title={connected?'No analyses yet':'Run history unavailable'}>
          {connected?'Upload footage to start a run.':'Connect to load your run history.'}
        </Empty>}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Review queue</h2><p>Observations waiting for an operator decision.</p></div><a href="#incidents/review">Open queue <ArrowUpRight size={15}/></a></div>
        {connected&&pending.length?<ul className="workspace-review">
          {pending.slice(0,5).map(event=><li key={event.id}><a href={'#incidents/'+encodeURIComponent(event.id)}>
            <strong>{event.title}</strong><small>{event.source_name} · {event.source_seconds.toFixed(2)} s</small>
          </a></li>)}
        </ul>:<Empty icon={ShieldCheck} title={connected?'Queue is clear':'Review queue unavailable'}>
          {connected?'New observations will appear here.':'Connect to load observations.'}
        </Empty>}
      </section>
    </div>
    <div className="workspace-utilities">
      <a className="panel" href="#carbon"><Leaf size={21}/><span><strong>Carbon ledger</strong><small>{connected?data.carbon.length+' saved estimates':'Connect to load estimates'}</small></span><ArrowRight size={17}/></a>
      <a className="panel" href="#demos"><Film size={21}/><span><strong>Sample footage</strong><small>Try a workflow with a bundled clip</small></span><ArrowRight size={17}/></a>
    </div>
  </>;
}

function RunList({runs}: {runs:Run[]}) {
  return <div className="run-list">{runs.map(run=><a key={run.id} className="run-row workspace-run" href={runLink(run)}>
    <span className="file-icon"><MonitorPlay size={20}/></span>
    <div className="run-info"><strong>{run.source_name}</strong><small>{analysisModes[run.rule.capability]?.label || run.rule.capability} · {date(run.created)}</small>
      {run.status==='processing'&&<progress aria-label="Analysis progress" value={run.progress} max={100}/>}
      {run.error&&<small className="error-text">{run.error}</small>}
    </div>
    <Badge tone={run.status==='completed'?'success':run.status==='failed'?'danger':'neutral'}>{runStatus(run)}</Badge>
  </a>)}</div>;
}

function Studio({data,connected,notify,refresh,selectedSourceId}: Props & {selectedSourceId:string}) {
  const [sourceId,setSourceId]=useState(()=>selectedSourceId||sessionStorage.getItem('zenith.source')||''); const [instruction,setInstruction]=useState(()=>sessionStorage.getItem('zenith.instruction')||'');
  const [capability,setCapability]=useState<Capability>(()=>{const value=sessionStorage.getItem('zenith.capability');return value==='traffic'||value==='machine_activity'||value==='action'?value:'zone';});const [points,setPoints]=useState<Point[]>([]);
  const [dwell,setDwell]=useState('2');const [name,setName]=useState(''); const [recipients,setRecipients]=useState<string[]>([]); const [cooldown,setCooldown]=useState('300');
  const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState('');const [proposal,setProposal]=useState('');
  const [threshold,setThreshold]=useState('0.03');const [video,setVideo]=useState('');
  const [detector,setDetector]=useState(()=>detectorPreset('zone'));
  const [segment,setSegment]=useState(false);
  const [metres,setMetres]=useState('');
  const [actionConfidence,setActionConfidence]=useState('0.6');
  const missingAction=capability==='action'&&!data.status?.models?.action.checkpoint_present;
  const [review,setReview]=useState(false);
  const [formError,setFormError]=useState('');
  const workerReady=connected&&!!data.status?.worker_online;
  const vision=data.status?.vision;
  useEffect(()=>setReview(false),[sourceId,vision?.provider,vision?.model,vision?.available,connected]);
  useEffect(()=>{setDetector(detectorPreset(capability));setConfirmed(false);},[capability]);
  const source=data.sources.find(x=>x.id===sourceId);
  useEffect(()=>{if(sourceId)sessionStorage.setItem('zenith.source',sourceId);},[sourceId]);
  useEffect(()=>{sessionStorage.setItem('zenith.capability',capability);},[capability]);
  useEffect(()=>{if(!sourceId&&data.sources.length)setSourceId(data.sources[0].id);},[sourceId,data.sources]);
  useEffect(()=>{
    const proposed=sourceId?suggestedPoints(capability,source?.example_id):[];
    setPoints(proposed);
    const sampleSegment=capability==='traffic'&&proposed.length===4;
    setSegment(sampleSegment);
    setMetres(sampleSegment?'50':'');
    setConfirmed(false);
    setFormError('');
    setVideo('');
  },[sourceId,capability,source?.example_id]);
  useEffect(()=>()=>{if(video)URL.revokeObjectURL(video);},[video]);
  async function upload(file:File|undefined) {
    if(!file)return;if(file.size>(data.status?.max_upload_mb||100)*1024*1024){notify('Clip exceeds the upload limit.');return;}
    setBusy('upload');try{const body=new FormData();body.append('file',file);const item=await json<Source>('/sources',{method:'POST',body});setSourceId(item.id);refresh();notify('Video uploaded. Review the suggested region or line before confirming.');}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  async function propose() {
    setBusy('proposal');try{const result=await json<{capability:Capability;dwell_seconds:number;model:string;warnings:string[]}>('/proposals',{method:'POST',body:JSON.stringify({instruction})});setCapability(result.capability);setDwell(String(result.dwell_seconds));setProposal(`${result.model}. ${result.warnings.join(' ')}`);setConfirmed(false);}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  function rulePayload() {
    return {capability,name:name.trim()||analysisModes[capability]?.label||'Analysis',instruction,points,dwell_seconds:Number(dwell),motion_threshold:Number(threshold),...detector,segment_metres:capability==='traffic'&&segment?Number(metres):null,action_confidence:Number(actionConfidence),recipients,alert_cooldown_seconds:Number(cooldown),confirmed};
  }
  async function run() {
    setFormError('');
    setBusy('run');
    try {
      const queued=await json<Run>('/runs',{method:'POST',body:JSON.stringify({source_id:sourceId,
        ...(review&&vision?.available?{vision_provider:vision.provider,vision_consent:vision.provider!=='local'}:{}),
        rule:rulePayload()})});
      setReview(false);
      refresh();
      window.location.hash=runLink(queued);
    } catch(error) {
      setFormError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function openVideo() {
    setBusy('video');try{const blob=await(await request(`/sources/${sourceId}/video`)).blob();setVideo(URL.createObjectURL(blob));}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  const pointLimit=capability==='traffic'?(segment?4:2):12;
  const enough=capability==='action'
    ? !missingAction&&Number(actionConfidence)>=.3&&Number(actionConfidence)<=.99
    : capability==='traffic'
      ? points.length===pointLimit&&(!segment||(Number(metres)>0&&Number(metres)<=10000))&&detector.vehicle_classes.length>0
      : points.length>=3;
  const blocker=!connected?'Connect to a workspace to run analysis.'
    :!workerReady?'The analysis worker is offline.'
    :missingAction?'Install the action checkpoint in Settings.'
    :!source?'Select or upload a video.'
    :!enough?'Complete the rule settings and review the region or gates.'
    :!confirmed?'Review and confirm the rule to continue.':'';
  const models=data.status?.models;
  const engine=capability==='action'
    ? [models?.action.detector,models?.action.checkpoint_present?models.action.classifier:null].filter(Boolean).join(' + ')||'Pose and action classifier'
    : capability==='traffic'
      ? models?.traffic.detector?models.traffic.detector+' + '+models.traffic.tracker:'Vehicle detector and tracker'
      :capability==='machine_activity'?'OpenCV motion analysis':'Person detector and tracker';
  function resetGeometry(useSegment=segment){
    const proposal=sourceId?suggestedPoints(capability,source?.example_id):[];
    if(capability==='traffic'){
      setPoints(useSegment
        ? proposal.length===4?proposal:[[.1,.40],[.9,.40],[.1,.65],[.9,.65]]
        : proposal.slice(0,2));
    }else setPoints(proposal);
    setConfirmed(false);
  }
  return <><Heading eyebrow="MONITORING" title="Start an analysis">Choose what to monitor, then select footage and review the rule.</Heading>
    <fieldset className="workspace-modes">
      <legend>Analysis type</legend>
      {(Object.keys(analysisModes) as Capability[]).map(mode=><label className="workspace-mode" key={mode}>
        <input type="radio" name="analysis-mode" value={mode} checked={mode===capability}
          onChange={()=>{setCapability(mode);setProposal('');}}/>
        <span><strong>{analysisModes[mode].label}</strong><small>{analysisModes[mode].description}</small>
          {mode==='action'&&connected&&!models?.action.checkpoint_present&&<small className="model-required">Checkpoint required</small>}
        </span>
      </label>)}
    </fieldset>
    <div className="studio-grid"><div className="studio-main"><section className="panel"><div className="panel-heading"><div><h2>Source footage</h2><p>Short, fixed-camera clips work best. <a href="#demos">Choose an example →</a></p></div>{source&&<Badge>{source.input_type==='sample'?'Sample':'Upload'}</Badge>}</div><div className="source-controls"><label>Source video<select value={sourceId} disabled={!!busy} onChange={e=>setSourceId(e.target.value)}><option value="">Select an uploaded or sample clip</option>{data.sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.duration.toFixed(1)}s</option>)}</select></label><label className={`button secondary upload-button ${!connected||busy?'disabled':''}`}><Upload size={16}/>{busy==='upload'?'Uploading…':'Upload video'}<input type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm" disabled={!connected||!!busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label></div>
       <details className="workspace-disclosure">
          <summary>Camera sources</summary>
          <p className="info-note">For YouTube inputs, paste URLs directly in <a className="text-link" href="#cameras">Cameras & live streams →</a>. Each saved camera has its own YOLO preview page and incident rule.</p>
         <CameraCapture disabled={!connected||!!busy} onClip={file=>void upload(file)}/>
          {data.status?.camera ? (
           <NetworkCamera camera={data.status.camera} rule={rulePayload()}
             vision={vision} workerOnline={!!data.status.worker_online} actionReady={!missingAction} connected={connected} notify={notify} refresh={refresh}/>
         ) : (
           <p className="info-note">Connect a backend to configure YouTube, RTSP or HLS input. <a className="text-link" href="#settings">Open health checks & setup →</a></p>
         )}
       </details>
       <div className="video-stage">{source?<>
        <ProtectedImage path={`/sources/${source.id}/preview`} alt="First source frame for monitoring geometry"/>
        {capability!=='action'&&<svg role="img" aria-label="Click to draw zone or gate" className="geometry" viewBox={`0 0 ${source.width} ${source.height}`} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();if(points.length<pointLimit){setPoints([...points,[(e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height]]);setConfirmed(false);}}}>
          {points.length>1&&(capability==='traffic'?<>{[points.slice(0,2),points.slice(2,4)].filter(gate=>gate.length===2).map((gate,i)=><polyline key={i} points={gate.map(p=>`${p[0]*source.width},${p[1]*source.height}`).join(' ')}/>)}</>:<polygon points={points.map(p=>`${p[0]*source.width},${p[1]*source.height}`).join(' ')}/>)}
          {points.map((p,i)=><circle key={`${i}-${p}`} cx={p[0]*source.width} cy={p[1]*source.height} r={source.width/120}/>)}
          {capability==='traffic'&&segment&&points.length>=2&&(
            <text x={points[0][0]*source.width+6} y={points[0][1]*source.height-8} fill="#d0ec85" fontSize={Math.max(12, Math.round(source.width/50))} fontWeight="600" style={{paintOrder:'stroke',stroke:'#102019',strokeWidth:3}}>Gate A (entry)</text>
          )}
          {capability==='traffic'&&segment&&points.length>=4&&(
            <text x={points[2][0]*source.width+6} y={points[2][1]*source.height-8} fill="#d0ec85" fontSize={Math.max(12, Math.round(source.width/50))} fontWeight="600" style={{paintOrder:'stroke',stroke:'#102019',strokeWidth:3}}>Gate B (exit)</text>
          )}
        </svg>}<span className="video-label">{source.input_type==='sample'?'SAMPLE PREVIEW':'PREVIEW'} · {source.name}</span>
      </>:<div className="video-empty"><Camera size={40}/><h3>Your video goes here</h3><p>Choose a licensed example in Demo Footage,<br/>or upload your own permitted-use clip.</p><span>MP4 / MOV / AVI / MKV / WebM · {data.status?.max_upload_mb||100} MB max</span></div>}</div>
       <div className="geometry-toolbar"><span>{capability==='action'?'The model watches the full frame.':capability==='traffic'&&segment?'Draw Gate A (2 points) and then Gate B (2 points), each from left to right.':'Review the suggested geometry for this clip.'} {capability!=='action'&&<strong>({points.length}{pointLimit ? ` / ${pointLimit}` : ''} points)</strong>}</span><div>{source&&capability!=='action'&&<><button type="button" className="text-button" onClick={()=>{setPoints(points.slice(0,-1));setConfirmed(false);}}>Undo</button><button type="button" className="text-button" onClick={()=>{setPoints([]);setConfirmed(false);}}>Clear</button><button type="button" className="text-button" onClick={()=>resetGeometry()}>Reset suggestion</button></>}{source&&<button type="button" className="text-button" disabled={!!busy} onClick={()=>void openVideo()}>Play original</button>}</div></div>
      {source&&capability!=='action'&&<details className="coordinate-editor"><summary>Keyboard-accessible geometry editor</summary><p>Normalized coordinates, one x,y pair per line. Values range from 0 to 1.</p><textarea aria-label="Zone coordinates" key={JSON.stringify(points)} defaultValue={points.map(p=>p.join(', ')).join('\n')} onBlur={e=>{const rows=e.target.value.trim().split('\n').filter(Boolean).map(line=>line.split(',').map(Number));if(rows.length<=12&&rows.every(p=>p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1))){setPoints(rows as Point[]);setConfirmed(false);}else notify('Coordinates must be x,y pairs between 0 and 1.');}}/></details>}
      {video&&<div className="original-player"><video controls src={video}/><button className="text-button" onClick={()=>setVideo('')}>Close original video</button></div>}</section>
      <details className="panel workspace-disclosure workspace-advanced">
        <summary>Advanced detection settings</summary>
        <DetectorSettings capability={capability} options={detector} onChange={options=>{setDetector(options);setConfirmed(false);}}/>
      </details>
      <details className="panel instruction-panel workspace-disclosure workspace-advanced">
        <summary>Suggest a rule from a description</summary>
        <textarea value={instruction} onChange={e=>{setInstruction(e.target.value);setConfirmed(false);}} maxLength={2000}
          placeholder="Count vehicles crossing this line." aria-label="Plain-English monitoring instruction"/>
        <div className="instruction-bottom"><button className="button secondary" disabled={!connected||!!busy||instruction.length<5}
          onClick={()=>void propose()}><Sparkles size={15}/>{busy==='proposal'?'Checking…':'Suggest rule'}</button></div>
        {proposal&&<div className="info-note">{proposal}</div>}
      </details>
    </div><div className="studio-side"><section className="panel rule-panel">
      <div className="panel-heading"><div><h2>Review rule</h2><p>{analysisModes[capability]?.label || capability}</p></div></div>
      <label>Run name (optional)<input placeholder={analysisModes[capability]?.label || 'Analysis name'} value={name} onChange={e=>{setName(e.target.value);setConfirmed(false);}} maxLength={100}/></label>{(capability==='zone'||capability==='machine_activity')&&<label>Minimum sustained duration (seconds)<input type="number" min="0.2" max="120" step="0.2" value={dwell} onChange={e=>{setDwell(e.target.value);setConfirmed(false);}}/></label>}{capability==='traffic'&&<>
      <label className="checkbox"><input type="checkbox" checked={segment} onChange={e=>{setSegment(e.target.checked);resetGeometry(e.target.checked);}}/> Count complete road segment traversals</label>
      {segment&&<label>Road distance between the gates (metres)<input type="number" min="0.1" max="10000" step="any" value={metres} onChange={e=>{setMetres(e.target.value);setConfirmed(false);}}/></label>}
      {segment&&source?.example_id==='traffic-counting'&&<p className="small-note">The demo starts with an illustrative 50 m distance.</p>}
      </>}{capability==='action'&&<><label>Action score threshold<input type="number" min="0.3" max="0.99" step="0.05" value={actionConfidence} onChange={e=>{setActionConfidence(e.target.value);setConfirmed(false);}}/></label>
      {missingAction&&<p className="small-note">Upload the trained checkpoint in <a href="#settings">Settings</a>.</p>}
      <p className="small-note">Review each flag against the source footage before confirming an incident.</p></>}{capability==='machine_activity'&&<label>Motion fraction threshold (experimental)<input type="number" min="0.001" max="0.9" step="0.001" value={threshold} onChange={e=>{setThreshold(e.target.value);setConfirmed(false);}}/></label>}<fieldset className="recipient-group"><legend>Notification recipients</legend>{data.status?.recipients.length?data.status.recipients.map(r=><label className="checkbox" key={r}><input type="checkbox" checked={recipients.includes(r)} onChange={e=>{setRecipients(e.target.checked?[...recipients,r]:recipients.filter(x=>x!==r));setConfirmed(false);}}/><span>{recipientLabel(r)}</span></label>):<p>No approved recipients. Configure Telegram or email on the backend.</p>}</fieldset><label>Repeat-alert cooldown (seconds)<input type="number" min="0" max="86400" step="30" value={cooldown} onChange={e=>{setCooldown(e.target.value);setConfirmed(false);}}/></label><div className="model-card"><Cpu size={19}/><div><small>CONFIGURED ENGINE</small>
        <strong>{engine}</strong>
        <span>{capability==='action'?(missingAction?'Checkpoint needed':'Checkpoint installed · loaded per run')
          :capability==='machine_activity'?'Estimates visible motion duration'
          :capability==='traffic'?'Vehicle counts · CO₂ uses documented factors':'Tracked people · zone and dwell rule'}</span>
      </div></div>{capability==='machine_activity'&&<div className="warning-note">Stationary powered equipment can look inactive. People, shadows and camera movement can look like operation. Do not use this as an on/off sensor.</div>}<label className="checkbox"><input type="checkbox" checked={confirmed} disabled={!enough} onChange={e=>setConfirmed(e.target.checked)}/><span>I reviewed the region, rule and notification recipients.</span></label>{vision?.available&&<label className="checkbox">
      <input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)}/>
       <span>{vision.provider!=='local'
         ? `I have permission to send sampled frames and incident evidence from this clip to ${vision.provider==='typesafe'?'TypeSafe (experimental Jev image decisions)':'NVIDIA'} for advisory review.`
        : 'Summarize sampled video frames and review saved incident evidence with the local vision model.'} Up to {vision.auto_limit} incidents per run.</span>
    </label>}<button className="button primary full" disabled={!!blocker||!!busy} onClick={()=>void run()}>
      {busy==='run'?<LoaderCircle size={17} className="spin"/>:<MonitorPlay size={17}/>}
      {busy==='run'?'Submitting…':'Run analysis'}
    </button>
    {formError&&<p className="error-text" role="alert">{formError}</p>}
    {blocker&&<p className="small-note">{blocker} {(!workerReady||missingAction)&&
      <a className="text-link" href="#settings">Open Settings</a>}</p>}
    </section></div></div>
    <section className="panel section-gap"><div className="panel-heading"><div><h2>Run history</h2><p>Progress updates automatically while connected.</p></div><Badge>{data.runs.length} runs</Badge></div>{data.runs.length?<RunList runs={data.runs}/>:<Empty title="No analysis runs yet">Confirmed rules and uploaded footage will appear here when you start a run.</Empty>}</section>
  </>;
}

function IncidentVision({event,vision,connected,notify,refresh}: {
  event: Incident;
  vision?: VisionStatus;
  connected: boolean;
  notify: Props['notify'];
  refresh: Props['refresh'];
}) {
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false);
  const review=event.vision_review;
  const pending=review?.status==='queued'||review?.status==='processing';
  useEffect(()=>setConsent(false),[vision?.provider,vision?.model,vision?.available,connected]);

  async function requestReview() {
    if(!vision?.available)return;
    setBusy(true);
    try {
      await json(`/events/${event.id}/review`,{
        method:'POST',body:JSON.stringify({provider:vision.provider,consent})
      });
      setConsent(false);
      refresh();
      notify('Evidence review queued.');
    } catch(error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="info-note">
    <strong>Vision model interpretation</strong>
    {review?.status==='completed'&&<>
      <p>{review.summary}</p>
      {review.decision&&<p><strong>Evidence decision:</strong> {review.decision}
        {review.confidence!==undefined?` · model confidence ${(review.confidence*100).toFixed(0)}%`:''}
        {' '}— advisory, not a verified incident.</p>}
      <p><strong>Limitations</strong> {review.limitations}</p>
      <small>{review.model} · {review.frame_count} evidence frame(s)</small>
    </>}
    {pending&&<p>{review.status==='queued'?'Review queued. It runs after video analysis.':'Reviewing saved evidence frames.'}</p>}
    {review?.status==='failed'&&<p>{review.error}</p>}
    {(!review||review.status==='not_requested')&&<p>{vision?.available?'Review the saved frames with the configured model.':vision?.detail||'Vision review is unavailable.'}</p>}
    {vision?.available&&!pending&&event.frames.length>0&&<>
      {vision.provider!=='local'&&<label className="checkbox">
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        <span>I have permission to send this incident’s evidence frames to {vision.provider==='typesafe'?'TypeSafe (experimental Jev image decisions)':'NVIDIA'}.</span>
      </label>}
      <button className="button secondary" type="button" disabled={!connected||busy||(vision.provider!=='local'&&!consent)} onClick={()=>void requestReview()}>
        {busy?'Queueing…':review?.status==='completed'||review?.status==='failed'?'Run review again':'Request review'}
      </button>
    </>}
  </section>;
}

function Incidents({data,connected,notify,refresh,selectedId}: Props & {selectedId:string}) {
  const [filter,setFilter]=useState(selectedId==='review'?'suspected':'all');const [selected,setSelected]=useState(selectedId==='review'?'':selectedId);const [busy,setBusy]=useState(false);const [note,setNote]=useState('');
  const closeModal=useCallback(()=>{setSelected('');if(window.location.hash.startsWith('#incidents/'))window.location.hash='#incidents';},[]);
  const event=data.events.find(e=>e.id===selected);
  useEffect(()=>{
    if(!event)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('.modal');
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, select, a[href]')||[]);
    focusable()[0]?.focus();
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){closeModal();return;}
      if(event.key!=='Tab')return;
      const controls=focusable();const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keyboard);
    const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',keyboard);document.body.style.overflow=previousOverflow;previous?.focus();};
  },[event?.id]);
  const events=data.events.filter(e=>filter==='all'||e.operator_status===filter);
  async function act(action:string){if(!event)return;setBusy(true);try{await json(`/events/${event.id}/acknowledge`,{method:'POST',body:JSON.stringify({action,note})});setNote('');refresh();notify('Operator decision recorded.');}catch(e){notify((e as Error).message);}finally{setBusy(false);}}
  return <><Heading eyebrow="OBSERVATIONS, NOT ASSUMPTIONS" title="Incident review">Review the source evidence, record a decision, and keep people in control.</Heading><div className="tab-row">{[['all','All observations'],['suspected','Needs review'],['acknowledged','Acknowledged'],['confirmed','Confirmed'],['dismissed','Dismissed']].map(([id,label])=><button className={filter===id?'selected':''} key={id} onClick={()=>setFilter(id)}>{label}</button>)}</div><section className="panel">{events.length?<div className="incident-list">{events.map(e=><button className="incident-row" key={e.id} onClick={()=>{setSelected(e.id);setNote('');}}>{e.frames.length?<ProtectedImage path={`/events/${e.id}/evidence/${e.frames[0]}`} alt="Incident evidence"/>:<span className="empty-icon"><ShieldCheck/></span>}<div><div className="incident-title"><strong>{e.title}</strong><Badge tone={e.operator_status==='suspected'?'warning':'success'}>{e.operator_status}</Badge></div><p>{e.source_name} · source {e.source_seconds.toFixed(2)}s</p><small>{date(e.created)}</small></div><ArrowUpRight size={18}/></button>)}</div>:<Empty icon={ShieldCheck} title="No observations in this view">Rule-generated events will appear here after real footage is analyzed. An empty list is not a safety guarantee.</Empty>}</section>
    <section className="panel section-gap"><div className="panel-heading"><div><h2>Notification outbox</h2><p>Delivery state is separate from an operator’s acknowledgement.</p></div><Badge>{data.status?.channels?.telegram?.configured?'Telegram configured':data.status?.email_mode==='configured'?'Email configured':'Preview mode'}</Badge></div>{data.notifications.length?<div className="notification-list">{data.notifications.map(n=><details key={n.id}><summary><Bell size={17}/><span>{n.subject}<small>{recipientLabel(n.recipient)}</small></span><Badge tone={n.status==='sent'?'success':'neutral'}>{n.status}</Badge></summary><pre>{n.text}</pre><p>{n.delivery||n.error||'Preview does not mean sent. Configure Telegram or email, then verify with a test alert.'}</p></details>)}</div>:<div className="inline-empty">No notification tasks. Configure an approved recipient before running a rule.</div>}</section>
    {event&&<div className="modal-backdrop" onClick={closeModal}><section className="modal" role="dialog" aria-modal="true" aria-label="Incident review" onClick={e=>e.stopPropagation()}><div className="panel-heading"><div><Badge tone="warning">RULE OBSERVATION</Badge><h2>{event.title}</h2><p>{event.source_name} · source {event.source_seconds.toFixed(2)}s</p></div><button className="icon-button" aria-label="Close incident review" onClick={closeModal}><X/></button></div><div className="evidence-grid">{event.frames.map(frame=><figure key={frame}><ProtectedImage path={`/events/${event.id}/evidence/${frame}`} alt={`${frame.includes('before')?'Before':frame.includes('after')?'After':'During'} event evidence`}/><figcaption>{frame.includes('before')?'Before':frame.includes('after')?'After':'During'}</figcaption></figure>)}</div><p>{event.detail}</p>{event.alert?.status==='suppressed'&&<div className="info-note">Alert suppressed for {event.alert.cooldown_seconds}s after the previous alert for this rule. The incident and evidence were kept.{event.alert.suppressed_until?` Next alert allowed after ${date(event.alert.suppressed_until)}.`:''}</div>}{event.alert?.status==='queued'&&<div className="info-note">Alert queued to {event.alert.recipients?.length||0} recipient(s). Delivery state is in the notification outbox.</div>}<IncidentVision key={event.id} event={event} vision={data.status?.vision} connected={connected} notify={notify} refresh={refresh}/><label>Action note<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} placeholder="What did you verify? What action was taken?"/></label><div className="action-row"><button className="button primary" disabled={!connected||busy} onClick={()=>void act('acknowledged')}><Check size={16}/> Acknowledge</button><button className="button secondary" disabled={!connected||busy} onClick={()=>void act('confirmed')}>Confirm observation</button><button className="button secondary" disabled={!connected||busy} onClick={()=>void act('dismissed')}>Dismiss</button></div><div className="history">{event.history.map(h=><p key={`${h.at}-${h.action}`}><strong>{h.action}</strong> · {date(h.at)}<br/>{h.note}</p>)}</div></section></div>}
  </>;
}

function Carbon({data,connected,notify,refresh,requestedRunId}:Props & {requestedRunId:string}) {
  const [kind,setKind]=useState('electricity');const [busy,setBusy]=useState(false);const [runId,setRunId]=useState('');
  const [factor,setFactor]=useState<SavedFactor|null>(null);
  const [preview,setPreview]=useState<CarbonEstimate|null>(null);
  const [previewing,setPreviewing]=useState(false);
  const [estimateError,setEstimateError]=useState('');
  const previewRevision=useRef(0);
  function clearPreview(){
    previewRevision.current+=1;
    setPreview(null);
    setEstimateError('');
  }
  useEffect(()=>{clearPreview();},[kind,runId,factor,connected]);
  useEffect(()=>{
    if (!factor) return;
    const form=document.querySelector<HTMLFormElement>('.carbon-form form');
    const factorInput=form?.elements.namedItem('factor');
    const sourceInput=form?.elements.namedItem('factor_source');
    const classInput=form?.elements.namedItem('vehicle_class');
    if (factorInput instanceof HTMLInputElement) factorInput.value=String(factor.factor);
    if (sourceInput instanceof HTMLInputElement) sourceInput.value=`${factor.source} · ${factor.region} · ${factor.year}`;
    if (classInput instanceof HTMLSelectElement && factor.vehicle_class) classInput.value=factor.vehicle_class;
  },[factor,runId]);
  const [proxy,setProxy]=useState(false);
  const [metered,setMetered]=useState(false);
  const linkedRun=data.runs.find(run=>run.id===requestedRunId&&run.status==='completed'&&(run.rule.capability==='traffic'||run.rule.capability==='machine_activity'));
  const linkedCapability=linkedRun?.rule.capability;
  const linkedId=linkedRun?.id;
  useEffect(()=>{
    if(!linkedId)return;
    setKind(linkedCapability==='traffic'?'traffic':'electricity');
    setRunId(linkedId);
    setProxy(false);
    setMetered(false);
  },[linkedId,linkedCapability]);
  const selectedRun=data.runs.find(run=>run.id===runId);
  const useMeter=kind==='electricity'&&metered;
  function estimateBody(form:HTMLFormElement) {
    const values=Object.fromEntries(new FormData(form));
    return JSON.stringify({
      name:values.name,kind,quantity:Number(values.quantity||0),metered_kwh:useMeter?Number(values.metered_kwh):null,
      factor:Number(values.factor),factor_id:factor?.id||null,factor_source:values.factor_source,basis:values.basis,
      hours:kind==='electricity'?Number(values.hours||1):1,
      load_fraction:kind==='electricity'?Number(values.load_fraction||1):1,
      distance_km:kind==='traffic'?(selectedRun?.rule.segment_metres?selectedRun.rule.segment_metres/1000:Number(values.distance_km)):1,
      run_id:runId||null,vehicle_class:kind==='traffic'?(values.vehicle_class||factor?.vehicle_class||null):null,
      accept_activity_proxy:!useMeter&&proxy,
    });
  }
  async function submitEstimate(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const submitter=(e.nativeEvent as SubmitEvent).submitter;
    const save=submitter?.getAttribute('value')==='save';
    const body=estimateBody(e.currentTarget);
    const revision=previewRevision.current;
    setEstimateError('');
    if(save)setBusy(true);else setPreviewing(true);
    try{
      const result=await json<CarbonEstimate>(save?'/carbon':'/carbon/preview',{method:'POST',body});
      if(save){
        clearPreview();
        refresh();
        notify('Carbon estimate saved.');
      }else if(revision===previewRevision.current){
        setPreview(result);
      }
    }catch(error){
      if(save||revision===previewRevision.current)setEstimateError((error as Error).message);
    }finally{
      if(save)setBusy(false);else setPreviewing(false);
    }
  }
  const equipment=data.carbon.filter(x=>x.kind!=='traffic').reduce((s,x)=>s+x.kg,0);const road=data.carbon.filter(x=>x.kind==='traffic').reduce((s,x)=>s+x.kg,0);
  const candidates=data.runs.filter(r=>r.status==='completed'&&r.rule.capability===(kind==='traffic'?'traffic':'machine_activity'));
  return <><Heading eyebrow="BUILT-IN CARBON ACCOUNTING" title="Carbon estimates">Calculate an estimate from traffic counts, equipment activity, electricity use, or fuel consumption.</Heading><div className="stat-grid carbon-stats"><section className="stat-card"><div className="stat-top">Equipment & fuel<Zap size={20}/></div><strong>{data.carbon.some(x=>x.kind!=='traffic')?number(equipment):'—'} <em>kg CO₂e</em></strong><small>Electricity and fuel estimates</small></section><section className="stat-card"><div className="stat-top">Road traffic<Activity size={20}/></div><strong>{data.carbon.some(x=>x.kind==='traffic')?number(road):'—'} <em>kg CO₂</em></strong><small>Vehicle-kilometre estimates</small></section><section className="stat-card"><div className="stat-top">Saved activity entries<FileText size={20}/></div><strong>{data.carbon.length}</strong><small>Not deduplicated · avoid overlapping entries</small></section></div>
    <FactorLibrary kind={kind} connected={connected} onSelect={setFactor} notify={notify}/>
    <div className="carbon-layout"><section className="panel carbon-form"><div className="panel-heading"><div><h2>Add an activity estimate</h2><p>Bring a factor from a credible, applicable source.</p></div><Plus size={20}/></div><div className="tab-row">{[['electricity','Electric equipment'],['fuel','Fuel consumption'],['traffic','Road traffic']].map(([id,label])=><button key={id} className={kind===id?'selected':''} onClick={()=>{setKind(id);setRunId('');setProxy(false);setMetered(false);}}>{label}</button>)}</div><form key={`${kind}:${runId}`} onSubmit={submitEstimate} onChange={clearPreview}><label>Equipment / activity name<input name="name" defaultValue={selectedRun?.source_name.slice(0,100)||''} required maxLength={100} placeholder={kind==='electricity'?'e.g. Loading-bay conveyor':kind==='fuel'?'e.g. Backup generator':'e.g. Gate 01 · cars'}/></label>{kind!=='fuel'&&<label>Activity source<select value={runId} onChange={e=>{setRunId(e.target.value);setProxy(false);}}><option value="">Operator / meter / operating log</option>{candidates.map(r=><option key={r.id} value={r.id}>{r.source_name} · {r.id.slice(0,8)}</option>)}</select></label>}{kind==='traffic'&&runId&&<label>Vehicle class<select name="vehicle_class" disabled={!!factor?.vehicle_class}>{['car','motorcycle','bus','truck'].map(c=><option key={c} value={c}>{c} ({selectedRun?.counts[c] ?? 0})</option>)}</select></label>}
      {kind==='electricity'&&<label>Electricity input<select value={metered?'meter':'runtime'}
        onChange={event=>{setMetered(event.target.value==='meter');setProxy(false);}}>
        <option value="runtime">Power × runtime</option><option value="meter">Metered energy (kWh)</option>
      </select></label>}
      <div className="form-grid">{useMeter?<label>Metered energy (kWh)<input name="metered_kwh" type="number" min="0" max="1000000000000" step="any" required/></label>:<label>{kind==='electricity'?'Rated / measured power (kW)':kind==='fuel'?'Fuel consumed (litres)':'Vehicle count'}<input name="quantity" type="number" min="0" max="1000000000000" step="any" required={!runId||kind!=='traffic'} disabled={!!runId&&kind==='traffic'} placeholder={runId&&kind==='traffic'?'From selected run':'Enter known activity'}/></label>}{kind==='electricity'&&!useMeter&&<label>Operating time (hours)<input name="hours" type="number" min="0" max="10000000" step="any" required={!runId} disabled={!!runId} placeholder={runId?'From activity proxy':'From meter / log'}/></label>}{kind==='traffic'&&<label>Segment distance (km)<input name="distance_km" type="number" min="0.000001" max="1000000" step="any" required readOnly={!!selectedRun?.rule.segment_metres} defaultValue={selectedRun?.rule.segment_metres?selectedRun.rule.segment_metres/1000:undefined} placeholder="Configured road segment"/></label>}{kind==='electricity'&&!useMeter&&<label>Load fraction (0–1)<input name="load_fraction" type="number" min="0.000001" max="1" step="any" required placeholder="Measured or assumed; document below"/></label>}<label>{kind==='electricity'?'Factor (kg CO₂e/kWh)':kind==='fuel'?'Factor (kg CO₂e/litre)':'Factor (g CO₂/vehicle-km)'}<input name="factor" readOnly={!!factor} type="number" min="0.000000001" max="1000000000" step="any" required placeholder="No default factor assumed"/></label></div><label>Factor source & applicability<input name="factor_source" readOnly={!!factor} required minLength={3} maxLength={1000} placeholder="Source URL / document, year, region, fuel or vehicle class"/></label><label>Activity basis & assumptions<textarea name="basis" required minLength={3} maxLength={1000} placeholder="Runtime source, load assumption, operating interval, fuel type, accounting boundary and uncertainty…"/></label>{kind==='electricity'&&!useMeter&&runId&&<label className="checkbox"><input type="checkbox" required checked={proxy} onChange={e=>setProxy(e.target.checked)}/><span>I accept an unvalidated visible-motion proxy for runtime. It does not establish on/off state or power consumption.</span></label>}<div className="action-row">
        <button className="button primary" type="submit" value="preview" disabled={!connected||busy||previewing}><Leaf size={16}/>{previewing?'Calculating…':'Preview estimate'}</button>
        {preview&&<button className="button secondary" type="submit" value="save" disabled={!connected||busy||previewing}>{busy?'Saving…':'Save to ledger'}</button>}
      </div>
      {estimateError&&<p className="error-text" role="alert">{estimateError}</p>}
      {preview&&<div className="info-note workspace-estimate" role="status">
        <strong>{new Intl.NumberFormat('en-IN',{maximumFractionDigits:8}).format(preview.kg)} kg {preview.kind==='traffic'?'CO₂':'CO₂e'}</strong>
        <p>{preview.formula}</p><p>{preview.factor_source}</p>
      </div>}</form></section><aside><section className="formula-card"><span className="eyebrow">THE CALCULATION, NOT A BLACK BOX</span><h3>{kind==='electricity'?'Electric equipment':kind==='fuel'?'Fuel consumption':'Road traffic'}</h3><div className="formula">{useMeter?<>Metered kWh × Factor</>:kind==='electricity'?<>Power × Runtime<br/>× Load × Factor</>:kind==='fuel'?<>Litres consumed<br/>× Fuel factor</>:<>Count × Distance<br/>× Class factor ÷ 1,000</>}</div><p>{useMeter?'Use the metered energy for the documented interval.':kind==='electricity'?'kW × hours = kWh. Multiply by a sourced electricity factor in kg CO₂e/kWh.':kind==='fuel'?'Use litres actually consumed or a documented engineering estimate. On/off time alone is not fuel volume.':'Calculate separately for each class. Use factors in grams CO₂ per vehicle-kilometre.'}</p></section><div className="warning-note section-gap"><strong>A runtime is not a measurement of emissions.</strong><p>Visual motion can be caused by people or lighting. A stationary machine may still consume power. For reliable on/off state use PLC, smart-meter or operator data.</p></div><div className="side-note"><ShieldCheck size={21}/><h3>Boundaries matter.</h3><p>These entries are activity estimates, not a complete industrial carbon inventory. Do not combine overlapping entries, CO₂-only and CO₂e totals, or incompatible factor boundaries.</p></div></aside></div>
    {selectedRun&&<section className="panel section-gap">
      <div className="panel-heading"><div><h2>Video evidence for this estimate</h2><p>{selectedRun.source_name}</p></div></div>
      <RunVideo key={selectedRun.id} run={selectedRun} events={data.events}/>
    </section>}
    <EquipmentPanel connected={connected} notify={notify}/>
    <section className="panel section-gap"><div className="panel-heading"><div><h2>Activity ledger</h2><p>Each number keeps its formula, source and assumptions.</p></div><Badge>{data.carbon.length} entries</Badge></div>{data.carbon.length?<div className="ledger">{data.carbon.map(entry=><details key={entry.id}><summary><span className="stat-icon green"><Leaf size={18}/></span><span><strong>{entry.name}</strong><small>{entry.kind} · {date(entry.created)}</small></span><strong>{number(entry.kg)} kg <small>{entry.kind==='traffic'?'CO₂':'CO₂e'}</small></strong></summary><div><code>{entry.formula}</code><p><strong>Factor source:</strong> {entry.factor_source}</p><p><strong>Activity basis:</strong> {entry.basis}</p><p><strong>Coverage:</strong> {entry.coverage}</p>{entry.run_id&&<a className="text-link" href={`#carbon/${encodeURIComponent(entry.run_id)}`}>Open linked video →</a>}</div></details>)}</div>:<Empty icon={Leaf} title="No factors. No invented footprint.">Add documented activity and an applicable emission factor to calculate your first estimate.</Empty>}</section>
  </>;
}

function Reports({data,connected,notify}:Props) {
  const [runId,setRunId]=useState('');const [busy,setBusy]=useState('');
  async function exportReport(format:string){setBusy(format);try{await download(`/reports/${format}${runId?`?run_id=${encodeURIComponent(runId)}`:''}`,`zenith-report.${format}`);notify('Report downloaded.');}catch(e){notify((e as Error).message);}finally{setBusy('');}}
  return <><Heading eyebrow="AN EVIDENCE TRAIL YOU CAN SHARE" title="Take the full picture with you.">Export saved observations, decisions, vehicle counts and transparent carbon calculations.</Heading><div className="reports-grid"><section className="panel report-config"><div className="panel-heading"><div><h2>Build your report</h2><p>Reports use saved backend records, not dashboard screenshots.</p></div><FileText size={22}/></div><label>Scope<select value={runId} onChange={e=>setRunId(e.target.value)}><option value="">Entire operator workspace</option>{data.runs.map(r=><option key={r.id} value={r.id}>{r.rule.name ? `${r.rule.name} (${r.source_name})` : r.source_name} · {r.id.slice(0,8)}</option>)}</select></label><div className="report-includes">{['Run status and analysis coverage','Suspected events and available evidence','Operator decisions and action notes','Vehicle class counts and activity runtime','Carbon formulas, sources and assumptions','Explicit unavailable-feature disclosures'].map(text=><div key={text}><Check size={17}/>{text}</div>)}</div><div className="action-row"><button className="button primary" disabled={!connected||!!busy} onClick={()=>void exportReport('pdf')}><ArrowDownToLine size={17}/>{busy==='pdf'?'Generating…':'Download PDF'}</button><button className="button secondary" disabled={!connected||!!busy} onClick={()=>void exportReport('csv')}><ArrowDownToLine size={17}/> Export CSV</button></div><p className="small-note">Run-scoped exports include only carbon entries explicitly linked to that run.</p></section><div className="report-preview"><div className="paper"><div className="paper-brand">zenith.</div><span>OPERATIONS / EVIDENCE REPORT</span><h2>Clarity, documented.</h2><p>Safety observations<br/>Activity & carbon estimates</p><div className="paper-line"/><div className="paper-line short"/><div className="paper-metrics"><span><ShieldCheck size={21}/><small>Evidence</small></span><span><Leaf size={21}/><small>Estimates</small></span></div><div className="paper-line"/><div className="paper-line short"/><div className="paper-footer">ILLUSTRATIVE COVER · NOT A GENERATED REPORT</div></div></div></div></>;
}

function HowItWorks() {
  const steps=[
    {icon:Upload,title:'Bring your footage',text:'Upload a short, permitted-use video. Zenith saves a private source and decodes a preview. This MVP does not connect directly to cameras.'},
    {icon:Sparkles,title:'Describe & confirm',text:'A constrained English parser suggests one supported capability. You draw the exact zone or counting line, choose a duration and approved recipients, then confirm.'},
    {icon:Cpu,title:'Detect, track & apply rules',text:'The worker uses YOLOv8 Nano and ByteTrack for people and vehicles. Python checks zone dwell or a finite line crossing. Equipment mode uses pixel motion, not an on/off model.'},
    {icon:ShieldCheck,title:'Inspect the observation',text:'The rule stores a suspected event and source-timestamped frames. Before and after frames are included only when available. You acknowledge, confirm or dismiss it.'},
    {icon:Leaf,title:'Estimate with documented factors',text:'Road counts or equipment runtime can supply activity data. You provide power/fuel data and applicable emission factors. Formulas, units, sources and uncertainty remain attached.'},
    {icon:FileText,title:'Notify & document',text:'Approved contacts produce an email preview by default. Optional Resend configuration enables actual sends. Download PDF or CSV from protected saved records.'},
  ];
  return <><Heading eyebrow="THE SEPARATE EXPLAINER" title="Understand what happens inside.">No hidden claims. Here is what this version does, where the models stop, and where you decide.</Heading><section className="how-intro"><div><Badge tone="hero-badge">HUMAN-CONFIRMED MONITORING</Badge><h2>Language sets the intention.<br/>Rules trigger the observation.<br/><span>People make the decision.</span></h2></div><div className="how-orbit"><Camera size={48}/><span>VIDEO → EVIDENCE</span></div></section><div className="how-steps">{steps.map(({icon:Icon,title,text},i)=><section className="panel how-step" key={title}><div className="how-step-top"><span className="stat-icon mint"><Icon size={22}/></span><span>0{i+1}</span></div><h2>{title}</h2><p>{text}</p></section>)}</div><section className="panel section-gap"><div className="panel-heading"><div><h2>What is available—and what is not</h2><p>The product vision is larger than this first build.</p></div><ShieldCheck size={23}/></div><div className="capability-table"><div><strong>Capability</strong><strong>This version</strong></div>{[
      ['People in a confirmed zone','Real detector + tracking + dwell rule; footage validation still required'],['Vehicle counting','Real class counts and two line-side directions; camera calibration still required'],['Machine operation','Experimental visible-motion proxy or operator-supplied activity; not true on/off sensing'],['Plain-English rules','Constrained local parser; not a preview-inspecting vision agent'],['AI evidence review','Optional consent-gated NVIDIA or local interpretation of sampled video and incident frames'],['Possible fights and falls','Pose classifier with a separately installed checkpoint and operator review'],['PPE / crowd / exit obstruction','Dedicated models are required'],['Live cameras & health alerts','Optional backend RTSP capture to short clips and browser recording; no low-latency alerts or uptime watchdog'],['Email delivery','Preview by default; optional Resend sending, no delivery webhooks'],['Hosting','Laptop primary; optional temporary Colab launcher, no uptime guarantee'],['Safety certification / emissions compliance','Neither claimed nor established'],
    ].map(([a,b])=><div key={a}><strong>{a}</strong><span>{b}</span></div>)}</div></section></>;
}

function Settings({data,connected,notify,refresh}:Props) {
  const [base,setBase]=useState(connection().base);const [key,setKey]=useState(connection().key);const [busy,setBusy]=useState(false);
  const [installing,setInstalling]=useState(false);
  const models=data.status?.models;
  async function installModel(file:File|undefined){
    if(!file)return;
    setInstalling(true);
    try{
      const body=new FormData();
      body.append('file',file);
      await json('/models/action',{method:'POST',body});
      refresh();
      notify('Fight and fall checkpoint installed.');
    }catch(error){notify((error as Error).message);}
    finally{setInstalling(false);}
  }
  async function apply(e:FormEvent){e.preventDefault();setBusy(true);const previous=connection();try{if(base){const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use an HTTPS origin, or a loopback HTTP origin, without a path or credentials.');}if(key.length<24)throw new Error('Enter the operator key generated by the backend.');sessionStorage.setItem('zenith.base',base.replace(/\/$/,''));sessionStorage.setItem('zenith.key',key);await json('/status');refresh();notify('Backend connected. Operator access verified.');}catch(e){sessionStorage.setItem('zenith.base',previous.base);sessionStorage.setItem('zenith.key',previous.key);notify((e as Error).message);}finally{setBusy(false);}}
  return <><Heading eyebrow="CONNECTIONS & DIAGNOSTICS" title="Health & settings">Check service connections, configure your demo and manage analysis models.</Heading><div className="settings-grid"><section className="panel settings-form"><div className="panel-heading"><div><h2>Backend connection</h2><p>The key stays in this browser tab’s session storage.</p></div><Badge tone={connected?'success':'neutral'}>{connected?'Connected':'Disconnected'}</Badge></div><form onSubmit={apply}><label>API origin<input type="url" value={base} onChange={e=>setBase(e.target.value)} placeholder="Blank = this dashboard’s server · or https://your-tunnel.ngrok-free.app"/></label><p className="small-note">Leave blank when opening the dashboard from the Colab notebook or running locally. On Vercel, paste the HTTPS origin printed by the notebook.</p><label>Operator API key<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required minLength={24} placeholder="From data/operator.key or ZENITH_API_KEY"/></label><div className="action-row"><button className="button primary" disabled={busy} type="submit"><Radio size={17}/>{busy?'Connecting…':'Verify & connect'}</button><button type="button" className="button secondary" onClick={()=>{sessionStorage.removeItem('zenith.key');setKey('');refresh();notify('Browser disconnected. Backend records remain saved.');}}>Disconnect</button></div></form>
    <div className="settings-email-note"><strong>Email notifications</strong><p>{connected ? data.status?.email_mode==='configured' ? 'Provider configured; delivery not tested.' : 'Preview only; configure RESEND_API_KEY and ZENITH_FROM_EMAIL on the backend to send.' : 'Connect to see email configuration.'}</p></div>
    </section><HealthPanel status={data.status} connected={connected} refresh={refresh}/></div>
    <DemoSetup status={data.status} connected={connected}/>
    {connected&&<section className="panel section-gap">
      <div className="panel-heading"><div><h2>Analysis models</h2><p>Used by the connected analysis worker.</p></div><Cpu size={22}/></div>
      <div className="health-row"><span>Traffic and CO₂</span><span>{models?.traffic.detector || 'YOLOv8 Nano'} · {models?.traffic.tracker || 'ByteTrack'} · class emission factors</span></div>
      <div className="health-row"><span>Fight and fall</span><span>{models?.action.detector || 'YOLO11 Pose'} · {models?.action.checkpoint_present ? models.action.classifier : 'Checkpoint needed'}</span></div>
      {data.status?.is_admin&&(models?.action.upload_enabled ?? true)&&<label className="button secondary upload-button">
        <Upload size={16}/>{installing?'Validating checkpoint…':'Upload Colab action checkpoint'}<input type="file" accept=".pt" disabled={installing} onChange={e=>{void installModel(e.target.files?.[0]);e.target.value='';}}/>
      </label>}
      <p className="small-note">Connect with the administrator key to install zenith_cctv_action.pt from the training notebook. The worker loads it when you run a fight and fall analysis.</p>
    </section>}{connected&&data.status?.is_admin&&<OperatorKeys notify={notify}/>}<div className="hosting-grid"><section className="panel hosting-card"><span className="stat-icon mint"><MonitorPlay size={23}/></span><Badge tone="success">RECOMMENDED</Badge><h2>Your laptop</h2><p>Run the API and worker locally with SQLite, or use Docker Compose with PostgreSQL. Keep source files and evidence on your disk.</p><code>npm run dev<br/>.venv/bin/python -m uvicorn backend.main:app<br/>.venv/bin/python -m backend.worker</code><small>Setup commands are in README.md. Bind locally unless protected public access is intentional.</small></section><section className="panel hosting-card"><span className="stat-icon peach"><Cpu size={23}/></span><Badge>OPTIONAL / TEMPORARY</Badge><h2>Google Colab</h2><p>Open the dashboard link printed by the notebook and enter your operator key. To use Vercel, enter the tunnel origin too.</p><code>notebooks/Zenith_Colab.ipynb</code><small>Runtimes and GPUs are not guaranteed. Free Colab restricts primarily using a separate web UI. Read docs/COLAB.md and provider policy; it is not persistent SaaS hosting.</small></section></div></>;
}
