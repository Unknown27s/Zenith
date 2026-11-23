import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, BookOpen, Boxes, Camera, Check, ChevronRight, CircleHelp, Clock3, Cpu, FileText, Leaf, LoaderCircle, Menu, MonitorPlay, Plus, Radio, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Upload, X, Zap } from 'lucide-react';
import { connection, download, ensureLocalSession, json, request } from './api';
import type { Capability, CarbonEntry, Data, Incident, Page, Point, Run, Source, VisionStatus } from './types';
import EquipmentPanel from './EquipmentPanel';
import DemoLibrary from './DemoLibrary';
import RunVideo, { carbonLink } from './RunVideo';
import DetectorSettings, { detectorPreset } from './DetectorSettings';

const navigation: {id: Page; label: string; icon: typeof Activity}[] = [
  {id:'overview',label:'Overview',icon:Boxes}, {id:'studio',label:'Monitoring studio',icon:MonitorPlay},
  {id:'demos',label:'Demo footage',icon:ArrowDownToLine},
  {id:'incidents',label:'Incidents & evidence',icon:ShieldCheck}, {id:'carbon',label:'Carbon & energy',icon:Leaf},
  {id:'reports',label:'Reports',icon:FileText}, {id:'how',label:'How it works',icon:BookOpen},
];
const titles: Record<Page, string> = {overview:'Workspace overview',studio:'Monitoring studio',demos:'Demo footage library',incidents:'Incidents & evidence',carbon:'Carbon & energy',reports:'Reports',how:'How Zenith works',settings:'Connection & settings'};
const empty: Data = {status:null,sources:[],runs:[],events:[],carbon:[],notifications:[]};
const number = (n: number) => new Intl.NumberFormat('en-IN', {maximumFractionDigits:3}).format(n);
const date = (n: number) => new Date(n*1000).toLocaleString();
const capabilityLabel: Record<Capability, string> = {zone:'Restricted-zone dwell',traffic:'Vehicle line counting',machine_activity:'Equipment activity proxy'};
function navigate(page: Page) { window.location.hash = page; }
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
  const requestedRunId=route.split('/')[1]||''; const [data,setData]=useState<Data>(empty);
  const [connected,setConnected]=useState(false); const [failure,setFailure]=useState('');
  const [notice,setNotice]=useState(''); const [mobile,setMobile]=useState(false); const [revision,setRevision]=useState(0);
  const notify=useCallback((message:string)=>setNotice(message),[]);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{const change=()=>{setRoute(window.location.hash.slice(1));setMobile(false);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(!notice)return;const t=window.setTimeout(()=>setNotice(''),6500);return()=>window.clearTimeout(t);},[notice]);
  useEffect(()=>{
    let active=true;let timer:number;const controller=new AbortController();
    const load=async()=>{
      try {
        if(!connection().base)await ensureLocalSession(controller.signal);
        if(connection().base&&!connection().key)throw new Error('Enter the operator key in Connection Settings for this remote backend.');
        const [status,sources,runs,events,carbon,notifications]=await Promise.all([json<Data['status']>('/status',{signal:controller.signal}),json<Source[]>('/sources',{signal:controller.signal}),json<Run[]>('/runs',{signal:controller.signal}),json<Incident[]>('/events',{signal:controller.signal}),json<CarbonEntry[]>('/carbon',{signal:controller.signal}),json<Data['notifications']>('/notifications',{signal:controller.signal})]);
        if(active){setData({status,sources,runs,events,carbon,notifications});setConnected(true);setFailure('');}
      }catch(error){if(active){setConnected(false);setFailure((error as Error).message);}}
      if(active)timer=window.setTimeout(load,4000);
    };void load();return()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[revision]);
  const props={data,connected,notify,refresh};
  return <div className="app-shell">
    {mobile&&<div className="scrim" onClick={()=>setMobile(false)}/>}
    <aside className={`sidebar ${mobile?'open':''}`}>
      <a href="#overview" className="brand"><span className="brand-symbol">Z<span/></span><span>zenith<span className="brand-dot">.</span></span></a>
      <div className="workspace"><span className="workspace-avatar">TZ</span><div><strong>Team Zenith</strong><small>Designathon workspace</small></div><ChevronRight size={15}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(({id,label,icon:Icon})=><a key={id} className={page===id?'active':''} href={`#${id}`} aria-current={page===id?'page':undefined}><Icon size={19}/><span>{label}</span>{id==='incidents'&&data.events.filter(x=>x.operator_status==='suspected').length>0&&<span className="nav-count">{data.events.filter(x=>x.operator_status==='suspected').length}</span>}</a>)}</nav>
      <div className="sidebar-bottom"><div className="local-card"><span className={`status-dot ${connected?'on':''}`}/><strong>{connected?'Backend connected':'Laptop-first workspace'}</strong><p>Private footage. Clear evidence.<br/>People stay in control.</p><Badge tone="dark">MVP · File analysis</Badge></div><a className={`settings-link ${page==='settings'?'active':''}`} href="#settings"><Settings2 size={18}/> Connection & settings</a><div className="operator"><span className="operator-avatar">Z</span><div><strong>Demo operator</strong><small>Single-operator access</small></div></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-toggle" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={20}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{titles[page]}</strong></div><div className="topbar-right"><span className="environment"><span className={`status-dot ${connected?'on':''}`}/>{connected?'Backend connected':'Not connected'}</span><a href="#how" aria-label="How it works" className="icon-button"><CircleHelp size={19}/></a><a href="#incidents" aria-label="Open incidents" className="icon-button"><Bell size={19}/></a><span className="top-avatar">TZ</span></div></header>
      <main className="content">
        {!connected&&page!=='settings'&&<div className="connection-banner"><Radio size={16}/><span>{failure}</span><a href="#settings">Connect backend <ArrowRight size={14}/></a></div>}
        {page==='overview'&&<Overview {...props}/>}
        {page==='studio'&&<Studio {...props}/>}
        <div hidden={page!=='demos'}><DemoLibrary connected={connected} workerOnline={!!data.status?.worker_online} notify={notify} refresh={refresh}/></div>
        {page==='incidents'&&<Incidents {...props}/>}
        {page==='carbon'&&<Carbon {...props} requestedRunId={requestedRunId}/>}
        {page==='reports'&&<Reports {...props}/>}
        {page==='how'&&<HowItWorks/>}
        {page==='settings'&&<Settings {...props}/>}
        <footer className="footer"><span>ZENITH / Evidence before action.</span><span>Safety observations · Estimated emissions · Human decisions</span></footer>
      </main>
    </div>{notice&&<div className="toast" role="status"><Activity size={18}/><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X size={16}/></button></div>}
  </div>;
}
interface Props {data: Data;connected:boolean;notify:(message:string)=>void;refresh:()=>void}

function Overview({data,connected}: Props) {
  const pending=data.events.filter(x=>x.operator_status==='suspected').length;
  const vehicles=data.runs.filter(x=>x.status==='completed').reduce((sum,r)=>sum+Object.values(r.counts).reduce((a,b)=>a+b,0),0);
  const electric=data.carbon.filter(x=>x.kind==='electricity'||x.kind==='fuel').reduce((s,x)=>s+x.kg,0);
  const traffic=data.carbon.filter(x=>x.kind==='traffic').reduce((s,x)=>s+x.kg,0);
  return <>
    <Heading eyebrow="A CLEARER VIEW OF YOUR OPERATIONS" title="See what matters. Act with confidence." action={<button className="button primary" onClick={()=>navigate('studio')}><Plus size={17}/> New analysis</button>}>Safety, activity and carbon insights. One evidence-led workspace.</Heading>
    <section className="hero"><div className="hero-copy"><Badge tone="hero-badge"><span className="status-dot on"/> BUILT FOR EXISTING CCTV</Badge><h2>Your footage.<br/>A more intelligent perspective.</h2><p>Describe what to watch. Confirm the rule.<br/>Turn video into observations you can act on.</p><button className="button lime" onClick={()=>navigate('studio')}>Open monitoring studio <ArrowUpRight size={18}/></button><div className="hero-foot"><ShieldCheck size={15}/> No invented alerts. Every observation has a source.</div></div><div className="hero-visual" aria-hidden="true"><div className="visual-top"><span>ZENITH VISION / WORKSPACE</span><span>FILE ANALYSIS</span></div><div className="scene-grid"><div className="scene-building building-one"/><div className="scene-building building-two"/><div className="scene-building building-three"/><div className="scene-road"/><div className="scene-zone"><span>DEFINE YOUR ZONE</span></div><div className="scene-target"><span/><span/><span/><span/></div><div className="scene-dot dot-one"/><div className="scene-dot dot-two"/></div><div className="visual-bottom"><span><Activity size={14}/> Observe → understand → respond</span><span>ILLUSTRATION</span></div></div></section>
    <div className="stat-grid">{[
      {label:'Sources in workspace',value:connected?String(data.sources.length):'—',sub:'Uploaded clips · not live cameras',icon:Camera,tone:'mint'},
      {label:'Awaiting human review',value:connected?String(pending):'—',sub:'Suspected rule observations',icon:ShieldCheck,tone:'peach'},
      {label:'Vehicle crossings',value:connected?number(vehicles):'—',sub:'Completed runs · may include re-runs',icon:Activity,tone:'blue'},
      {label:'Equipment emissions',value:connected&&data.carbon.some(x=>x.kind!=='traffic')?number(electric):'—',sub:'kg CO₂e estimated · not measured',icon:Leaf,tone:'green'},
    ].map(({label,value,sub,icon:Icon,tone})=><section className="stat-card" key={label}><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon size={18}/></span></div><strong>{value}</strong><small>{sub}</small></section>)}</div>
    <div className="overview-grid"><section className="panel"><div className="panel-heading"><div><h2>Analysis activity</h2><p>Your latest source-to-evidence runs</p></div><a href="#studio">View studio <ArrowUpRight size={15}/></a></div>{data.runs.length?<RunList runs={data.runs.slice(0,4)}/>:<Empty title="Your first insight starts here" action={<button className="button secondary" onClick={()=>navigate('studio')}><Upload size={16}/> Add a video</button>}>Upload a short clip, draw a zone or line, and run real analysis.</Empty>}</section><section className="panel carbon-summary"><div className="panel-heading"><div><span className="eyebrow">BEYOND THE ROAD</span><h2>Carbon, with context.</h2></div><Leaf size={22}/></div><p>Track electricity, fuel and road traffic—not just trucks. Keep the assumptions beside every number.</p><div className="carbon-category"><span><Zap size={17}/> Equipment & fuel</span><strong>{data.carbon.some(x=>x.kind!=='traffic')?`${number(electric)} kg CO₂e`:'Not configured'}</strong></div><div className="carbon-category"><span><Activity size={17}/> Traffic</span><strong>{data.carbon.some(x=>x.kind==='traffic')?`${number(traffic)} kg CO₂`:'Not configured'}</strong></div><div className="subtle-note">CO₂ and CO₂e are shown separately. No factors are assumed.</div><a className="text-link" href="#carbon">Configure your carbon inputs <ArrowRight size={16}/></a></section></div>
    <section className="principles"><div><ShieldCheck size={20}/><span><strong>Evidence-led safety</strong><small>Suspected events, not automatic conclusions.</small></span></div><div><SlidersHorizontal size={20}/><span><strong>You confirm the rule</strong><small>Clear boundaries and configured contacts.</small></span></div><div><BookOpen size={20}/><span><strong>Nothing behind a curtain</strong><small><a href="#how">Explore the separate How It Works page →</a></small></span></div></section>
  </>;
}

function RunList({runs}: {runs:Run[]}) {
  return <div className="run-list">{runs.map(run=><div key={run.id} className="run-row"><span className="file-icon"><MonitorPlay size={20}/></span><div className="run-info"><strong>{run.source_name}</strong><small>{capabilityLabel[run.rule.capability]} · {date(run.created)}</small>
    {run.status==='completed'&&run.rule.capability!=='zone'&&<a className="text-link" href={carbonLink(run)}>Calculate carbon →</a>}{run.status==='processing'&&<div className="progress"><span style={{width:`${run.progress}%`}}/></div>}{run.error&&<small className="error-text">{run.error}</small>}</div><Badge tone={run.status==='completed'?'success':run.status==='failed'?'danger':'neutral'}>{run.status==='processing'?`${run.progress}%`:run.status}</Badge></div>)}</div>;
}

function Studio({data,connected,notify,refresh}: Props) {
  const [sourceId,setSourceId]=useState(()=>sessionStorage.getItem('zenith.source')||''); const [instruction,setInstruction]=useState(()=>sessionStorage.getItem('zenith.instruction')||'');
  const [capability,setCapability]=useState<Capability>(()=>{const value=sessionStorage.getItem('zenith.capability');return value==='traffic'||value==='machine_activity'?value:'zone';});const [points,setPoints]=useState<Point[]>([]);
  const [dwell,setDwell]=useState('2');const [name,setName]=useState('Loading bay'); const [recipient,setRecipient]=useState('');
  const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState('');const [proposal,setProposal]=useState('');
  const [threshold,setThreshold]=useState('0.03');const [video,setVideo]=useState('');
  const [detector,setDetector]=useState(()=>detectorPreset('zone'));
  const [review,setReview]=useState(false);
  const vision=data.status?.vision;
  useEffect(()=>setReview(false),[sourceId,vision?.provider,vision?.model,vision?.available,connected]);
  useEffect(()=>{setDetector(detectorPreset(capability));setConfirmed(false);},[capability]);
  const source=data.sources.find(x=>x.id===sourceId);
  useEffect(()=>{if(sourceId)sessionStorage.setItem('zenith.source',sourceId);},[sourceId]);
  useEffect(()=>{sessionStorage.setItem('zenith.capability',capability);},[capability]);
  useEffect(()=>{if(!sourceId&&data.sources.length)setSourceId(data.sources[0].id);},[sourceId,data.sources]);
  useEffect(()=>{setPoints([]);setConfirmed(false);setVideo('');},[sourceId,capability]);
  useEffect(()=>()=>{if(video)URL.revokeObjectURL(video);},[video]);
  async function upload(file:File|undefined) {
    if(!file)return;if(file.size>(data.status?.max_upload_mb||100)*1024*1024){notify('Clip exceeds the upload limit.');return;}
    setBusy('upload');try{const body=new FormData();body.append('file',file);const item=await json<Source>('/sources',{method:'POST',body});setSourceId(item.id);refresh();notify('Video uploaded. Draw and confirm its monitoring region.');}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  async function propose() {
    setBusy('proposal');try{const result=await json<{capability:Capability;dwell_seconds:number;model:string;warnings:string[]}>('/proposals',{method:'POST',body:JSON.stringify({instruction})});setCapability(result.capability);setDwell(String(result.dwell_seconds));setProposal(`${result.model}. ${result.warnings.join(' ')}`);setConfirmed(false);}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  async function run() {
    if(!detector.vehicle_classes.length){notify('Select at least one vehicle class.');return;}
    setBusy('run');try{await json('/runs',{method:'POST',body:JSON.stringify({source_id:sourceId,
      ...(review&&vision?.available?{vision_provider:vision.provider,vision_consent:vision.provider==='nvidia'}:{}),
      rule:{capability,name,instruction,points,dwell_seconds:Number(dwell),motion_threshold:Number(threshold),...detector,recipient,confirmed}})});setReview(false);refresh();notify('Analysis queued. Keep the backend worker running.');}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  async function openVideo() {
    setBusy('video');try{const blob=await(await request(`/sources/${sourceId}/video`)).blob();setVideo(URL.createObjectURL(blob));}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  const enough=capability==='traffic'?points.length===2:points.length>=3;
  return <><Heading eyebrow="CONFIGURE → CONFIRM → ANALYZE" title="Tell Zenith what to watch.">Turn a supported instruction into an editable monitoring rule. You approve it before it runs.</Heading>
    <DetectorSettings capability={capability} options={detector} onChange={options=>{setDetector(options);setConfirmed(false);}}/>
    <div className="studio-grid"><div className="studio-main"><section className="panel"><div className="panel-heading"><div><h2><span className="step-number">01</span> Choose your footage</h2><p>Short, fixed-camera clips work best. <a href="#demos">Choose an example →</a></p></div><Badge>{source?.input_type==='sample'?'SAMPLE INPUT':'UPLOADED INPUT'}</Badge></div><div className="source-controls"><label>Source video<select value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Select an uploaded or sample clip</option>{data.sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.duration.toFixed(1)}s</option>)}</select></label><label className={`button secondary upload-button ${!connected||busy?'disabled':''}`}><Upload size={16}/>{busy==='upload'?'Uploading…':'Upload video'}<input type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm" disabled={!connected||!!busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label></div>
      <div className="video-stage">{source?<>
        <ProtectedImage path={`/sources/${source.id}/preview`} alt="First source frame for monitoring geometry"/>
        <svg role="img" aria-label="Click to draw zone or line" className="geometry" viewBox={`0 0 ${source.width} ${source.height}`} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();if(points.length<(capability==='traffic'?2:12)){setPoints([...points,[(e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height]]);setConfirmed(false);}}}>
          {points.length>1&&(capability==='traffic'?<polyline points={points.map(p=>`${p[0]*source.width},${p[1]*source.height}`).join(' ')}/>:<polygon points={points.map(p=>`${p[0]*source.width},${p[1]*source.height}`).join(' ')}/>)}
          {points.map((p,i)=><circle key={`${i}-${p}`} cx={p[0]*source.width} cy={p[1]*source.height} r={source.width/120}/>)}
        </svg><span className="video-label">{source.input_type==='sample'?'SAMPLE PREVIEW':'PREVIEW'} · {source.name}</span>
      </>:<div className="video-empty"><Camera size={40}/><h3>Your video goes here</h3><p>Choose a licensed example in Demo Footage,<br/>or upload your own permitted-use clip.</p><span>MP4 / MOV / AVI / MKV / WebM · {data.status?.max_upload_mb||100} MB max</span></div>}</div>
      <div className="geometry-toolbar"><span>{capability==='traffic'?'Click two endpoints for a counting line.':'Click at least three points around the region.'} <strong>{points.length} points</strong></span><div><button className="text-button" onClick={()=>{setPoints(points.slice(0,-1));setConfirmed(false);}}>Undo</button><button className="text-button" onClick={()=>{setPoints([]);setConfirmed(false);}}>Clear</button>{source&&<button className="text-button" disabled={!!busy} onClick={()=>void openVideo()}>Play original</button>}</div></div>
      {source&&<details className="coordinate-editor"><summary>Keyboard-accessible geometry editor</summary><p>Normalized coordinates, one x,y pair per line. Values range from 0 to 1.</p><textarea aria-label="Zone coordinates" key={`${sourceId}-${capability}-${points.length}`} defaultValue={points.map(p=>p.join(', ')).join('\n')} onBlur={e=>{const rows=e.target.value.trim().split('\n').filter(Boolean).map(line=>line.split(',').map(Number));if(rows.length<=12&&rows.every(p=>p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1))){setPoints(rows as Point[]);setConfirmed(false);}else notify('Coordinates must be x,y pairs between 0 and 1.');}}/></details>}
      {video&&<div className="original-player"><video controls src={video}/><button className="text-button" onClick={()=>setVideo('')}>Close original video</button></div>}</section>
      <section className="panel instruction-panel"><div className="panel-heading"><div><h2><span className="step-number">02</span> Describe the instruction</h2><p>A constrained parser proposes supported rules. It does not inspect the scene.</p></div><Sparkles size={21}/></div><textarea value={instruction} onChange={e=>setInstruction(e.target.value)} maxLength={2000} placeholder="Draw boxes around people and email the supervisor if anyone stays inside the loading bay for more than two seconds." aria-label="Plain-English monitoring instruction"/><div className="prompt-examples">{['Alert if anyone stays inside for two seconds.','Count vehicles crossing this line.','Observe visible machine activity.'].map(text=><button key={text} onClick={()=>setInstruction(text)}>{text}</button>)}</div><div className="instruction-bottom"><span>Supported capabilities only · no autonomous actions</span><button className="button primary" disabled={!connected||!!busy||instruction.length<5} onClick={()=>void propose()}><Sparkles size={15}/>{busy==='proposal'?'Interpreting…':'Propose a rule'}</button></div>{proposal&&<div className="info-note">{proposal}</div>}</section>
    </div><div className="studio-side"><section className="panel rule-panel"><div className="panel-heading"><div><h2><span className="step-number">03</span> Review your rule</h2><p>Nothing runs until you confirm.</p></div></div><label>Capability<select value={capability} onChange={e=>{setCapability(e.target.value as Capability);setProposal('');}}>{Object.entries(capabilityLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Zone / rule name<input value={name} onChange={e=>{setName(e.target.value);setConfirmed(false);}} maxLength={100}/></label><label>{capability==='traffic'?'Reserved dwell setting (not used for counting)':'Minimum sustained duration (seconds)'}<input type="number" min="0.2" max="120" step="0.2" value={dwell} onChange={e=>{setDwell(e.target.value);setConfirmed(false);}}/></label>{capability==='machine_activity'&&<label>Motion fraction threshold (experimental)<input type="number" min="0.001" max="0.9" step="0.001" value={threshold} onChange={e=>{setThreshold(e.target.value);setConfirmed(false);}}/></label>}<label>Notification recipient<select value={recipient} onChange={e=>{setRecipient(e.target.value);setConfirmed(false);}}><option value="">No notification</option>{data.status?.recipients.map(r=><option key={r} value={r}>{r}</option>)}</select></label><div className="model-card"><Cpu size={19}/><div><small>ANALYSIS ENGINE</small><strong>{capability==='machine_activity'?'OpenCV region motion':'YOLOv8 Nano + ByteTrack'}</strong><span>{capability==='machine_activity'?'Activity proxy · not electrical state':'Pretrained detection · Python event rules'}</span></div></div>{capability==='machine_activity'&&<div className="warning-note">Stationary powered equipment can look inactive. People, shadows and camera movement can look like operation. Do not use this as an on/off sensor.</div>}<label className="checkbox"><input type="checkbox" checked={confirmed} disabled={!enough} onChange={e=>setConfirmed(e.target.checked)}/><span>I reviewed the region, rule and notification recipient.</span></label>{vision?.available&&<label className="checkbox">
      <input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)}/>
      <span>{vision.provider==='nvidia'
        ? 'I have permission to send evidence from this clip to NVIDIA for model review.'
        : 'Review saved incident frames with the local vision model.'} Up to {vision.auto_limit} incidents per run.</span>
    </label>}<button className="button primary full" disabled={!connected||!!busy||!source||!confirmed||!enough||!name.trim()} onClick={()=>void run()}>{busy==='run'?<LoaderCircle size={17} className="spin"/>:<MonitorPlay size={17}/>} Run analysis</button><p className="small-note">Real file inference. No fabricated sample results. Keep the worker running.</p></section><div className="side-note"><Clock3 size={20}/><h3>Source time, not upload time.</h3><p>Evidence is anchored to its position in the video. Processing time is recorded separately.</p></div></div></div>
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
      <p><strong>Limitations</strong> {review.limitations}</p>
      <small>{review.model} · {review.frame_count} evidence frame(s)</small>
    </>}
    {pending&&<p>{review.status==='queued'?'Review queued. It runs after video analysis.':'Reviewing saved evidence frames.'}</p>}
    {review?.status==='failed'&&<p>{review.error}</p>}
    {(!review||review.status==='not_requested')&&<p>{vision?.available?'Review the saved frames with the configured model.':vision?.detail||'Vision review is unavailable.'}</p>}
    {vision?.available&&!pending&&event.frames.length>0&&<>
      {vision.provider==='nvidia'&&<label className="checkbox">
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        <span>I have permission to send this incident’s evidence frames to NVIDIA.</span>
      </label>}
      <button className="button secondary" type="button" disabled={!connected||busy||(vision.provider==='nvidia'&&!consent)} onClick={()=>void requestReview()}>
        {busy?'Queueing…':review?.status==='completed'||review?.status==='failed'?'Run review again':'Request review'}
      </button>
    </>}
  </section>;
}

function Incidents({data,connected,notify,refresh}: Props) {
  const [filter,setFilter]=useState('all');const [selected,setSelected]=useState('');const [busy,setBusy]=useState(false);const [note,setNote]=useState('');
  useEffect(()=>{
    if(!selected)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>('.modal');
    const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, select, a[href]')||[]);
    focusable()[0]?.focus();
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setSelected('');return;}
      if(event.key!=='Tab')return;
      const controls=focusable();const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keyboard);
    const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',keyboard);document.body.style.overflow=previousOverflow;previous?.focus();};
  },[selected]);
  const events=data.events.filter(e=>filter==='all'||e.operator_status===filter);const event=data.events.find(e=>e.id===selected);
  async function act(action:string){if(!event)return;setBusy(true);try{await json(`/events/${event.id}/acknowledge`,{method:'POST',body:JSON.stringify({action,note})});setNote('');refresh();notify('Operator decision recorded.');}catch(e){notify((e as Error).message);}finally{setBusy(false);}}
  return <><Heading eyebrow="OBSERVATIONS, NOT ASSUMPTIONS" title="A clear record of what happened.">Review the source evidence, record a decision, and keep people in control.</Heading><div className="tab-row">{[['all','All observations'],['suspected','Needs review'],['acknowledged','Acknowledged'],['confirmed','Confirmed'],['dismissed','Dismissed']].map(([id,label])=><button className={filter===id?'selected':''} key={id} onClick={()=>setFilter(id)}>{label}</button>)}</div><section className="panel">{events.length?<div className="incident-list">{events.map(e=><button className="incident-row" key={e.id} onClick={()=>{setSelected(e.id);setNote('');}}>{e.frames.length?<ProtectedImage path={`/events/${e.id}/evidence/${e.frames[0]}`} alt="Incident evidence"/>:<span className="empty-icon"><ShieldCheck/></span>}<div><div className="incident-title"><strong>{e.title}</strong><Badge tone={e.operator_status==='suspected'?'warning':'success'}>{e.operator_status}</Badge></div><p>{e.source_name} · source {e.source_seconds.toFixed(2)}s</p><small>{date(e.created)}</small></div><ArrowUpRight size={18}/></button>)}</div>:<Empty icon={ShieldCheck} title="No observations in this view">Rule-generated events will appear here after real footage is analyzed. An empty list is not a safety guarantee.</Empty>}</section>
    <section className="panel section-gap"><div className="panel-heading"><div><h2>Notification outbox</h2><p>Email state is separate from an operator’s acknowledgement.</p></div><Badge>{data.status?.email_mode==='configured'?'Provider configured':'Preview mode'}</Badge></div>{data.notifications.length?<div className="notification-list">{data.notifications.map(n=><details key={n.id}><summary><Bell size={17}/><span>{n.subject}<small>{n.recipient}</small></span><Badge tone={n.status==='sent'?'success':'neutral'}>{n.status}</Badge></summary><pre>{n.text}</pre><p>{n.delivery||n.error||'Preview does not mean sent. No delivery webhook is enabled in this MVP.'}</p></details>)}</div>:<div className="inline-empty">No notification tasks. Configure an approved recipient before running a rule.</div>}</section>
    {event&&<div className="modal-backdrop" onClick={()=>setSelected('')}><section className="modal" role="dialog" aria-modal="true" aria-label="Incident review" onClick={e=>e.stopPropagation()}><div className="panel-heading"><div><Badge tone="warning">RULE OBSERVATION</Badge><h2>{event.title}</h2><p>{event.source_name} · source {event.source_seconds.toFixed(2)}s</p></div><button className="icon-button" aria-label="Close incident review" onClick={()=>setSelected('')}><X/></button></div><div className="evidence-grid">{event.frames.map(frame=><figure key={frame}><ProtectedImage path={`/events/${event.id}/evidence/${frame}`} alt={`${frame.includes('before')?'Before':frame.includes('after')?'After':'During'} event evidence`}/><figcaption>{frame.includes('before')?'Before':frame.includes('after')?'After':'During'}</figcaption></figure>)}</div><p>{event.detail}</p><IncidentVision key={event.id} event={event} vision={data.status?.vision} connected={connected} notify={notify} refresh={refresh}/><label>Action note<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} placeholder="What did you verify? What action was taken?"/></label><div className="action-row"><button className="button primary" disabled={!connected||busy} onClick={()=>void act('acknowledged')}><Check size={16}/> Acknowledge</button><button className="button secondary" disabled={!connected||busy} onClick={()=>void act('confirmed')}>Confirm observation</button><button className="button secondary" disabled={!connected||busy} onClick={()=>void act('dismissed')}>Dismiss</button></div><div className="history">{event.history.map(h=><p key={`${h.at}-${h.action}`}><strong>{h.action}</strong> · {date(h.at)}<br/>{h.note}</p>)}</div></section></div>}
  </>;
}

function Carbon({data,connected,notify,refresh,requestedRunId}:Props & {requestedRunId:string}) {
  const [kind,setKind]=useState('electricity');const [busy,setBusy]=useState(false);const [runId,setRunId]=useState('');
  const [proxy,setProxy]=useState(false);
  const [metered,setMetered]=useState(false);
  const linkedRun=data.runs.find(run=>run.id===requestedRunId&&run.status==='completed'&&run.rule.capability!=='zone');
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
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=new FormData(e.currentTarget);const values=Object.fromEntries(form);setBusy(true);try{
    await json('/carbon',{method:'POST',body:JSON.stringify({name:values.name,kind,quantity:Number(values.quantity||0),metered_kwh:useMeter?Number(values.metered_kwh):null,factor:Number(values.factor),factor_source:values.factor_source,basis:values.basis,hours:kind==='electricity'?Number(values.hours||1):1,load_fraction:kind==='electricity'?Number(values.load_fraction||1):1,distance_km:kind==='traffic'?Number(values.distance_km):1,run_id:runId||null,vehicle_class:kind==='traffic'&&runId?values.vehicle_class:null,accept_activity_proxy:!useMeter&&proxy})});refresh();notify('Carbon estimate saved with its inputs and provenance.');
  }catch(error){notify((error as Error).message);}finally{setBusy(false);}}
  const equipment=data.carbon.filter(x=>x.kind!=='traffic').reduce((s,x)=>s+x.kg,0);const road=data.carbon.filter(x=>x.kind==='traffic').reduce((s,x)=>s+x.kg,0);
  const candidates=data.runs.filter(r=>r.status==='completed'&&r.rule.capability===(kind==='traffic'?'traffic':'machine_activity'));
  return <><Heading eyebrow="BUILT-IN CARBON ACCOUNTING" title="Every estimate needs a basis.">Electricity, fuel and traffic. Make activity visible—and keep emissions assumptions explicit.</Heading><div className="carbon-hero"><div><span className="eyebrow">OPERATIONAL ESTIMATES</span><h2>From machine runtime<br/>to your road segment.</h2><p>CCTV can observe activity. It cannot measure fuel chemistry,<br className="desktop-break"/> grid emissions or actual electrical consumption.</p></div><Leaf size={90} strokeWidth={1}/></div><div className="stat-grid carbon-stats"><section className="stat-card"><div className="stat-top">Equipment & fuel<Zap size={20}/></div><strong>{data.carbon.some(x=>x.kind!=='traffic')?number(equipment):'—'} <em>kg CO₂e</em></strong><small>Electricity and fuel estimates</small></section><section className="stat-card"><div className="stat-top">Road traffic<Activity size={20}/></div><strong>{data.carbon.some(x=>x.kind==='traffic')?number(road):'—'} <em>kg CO₂</em></strong><small>Vehicle-kilometre estimates</small></section><section className="stat-card"><div className="stat-top">Saved activity entries<FileText size={20}/></div><strong>{data.carbon.length}</strong><small>Not deduplicated · avoid overlapping entries</small></section></div>
    <div className="carbon-layout"><section className="panel carbon-form"><div className="panel-heading"><div><h2>Add an activity estimate</h2><p>Bring a factor from a credible, applicable source.</p></div><Plus size={20}/></div><div className="tab-row">{[['electricity','Electric equipment'],['fuel','Fuel consumption'],['traffic','Road traffic']].map(([id,label])=><button key={id} className={kind===id?'selected':''} onClick={()=>{setKind(id);setRunId('');setProxy(false);setMetered(false);}}>{label}</button>)}</div><form key={`${kind}:${runId}`} onSubmit={save}><label>Equipment / activity name<input name="name" defaultValue={selectedRun?.source_name.slice(0,100)||''} required maxLength={100} placeholder={kind==='electricity'?'e.g. Loading-bay conveyor':kind==='fuel'?'e.g. Backup generator':'e.g. Gate 01 · cars'}/></label>{kind!=='fuel'&&<label>Activity source<select value={runId} onChange={e=>{setRunId(e.target.value);setProxy(false);}}><option value="">Operator / meter / operating log</option>{candidates.map(r=><option key={r.id} value={r.id}>{r.source_name} · {r.id.slice(0,8)}</option>)}</select></label>}{kind==='traffic'&&runId&&<label>Vehicle class<select name="vehicle_class">{['car','motorcycle','bus','truck'].map(c=><option key={c} value={c}>{c} ({selectedRun?.counts[c] ?? 0})</option>)}</select></label>}
      {kind==='electricity'&&<label>Electricity input<select value={metered?'meter':'runtime'}
        onChange={event=>{setMetered(event.target.value==='meter');setProxy(false);}}>
        <option value="runtime">Power × runtime</option><option value="meter">Metered energy (kWh)</option>
      </select></label>}
      <div className="form-grid">{useMeter?<label>Metered energy (kWh)<input name="metered_kwh" type="number" min="0" max="1000000000000" step="any" required/></label>:<label>{kind==='electricity'?'Rated / measured power (kW)':kind==='fuel'?'Fuel consumed (litres)':'Vehicle count'}<input name="quantity" type="number" min="0" max="1000000000000" step="any" required={!runId||kind!=='traffic'} disabled={!!runId&&kind==='traffic'} placeholder={runId&&kind==='traffic'?'From selected run':'Enter known activity'}/></label>}{kind==='electricity'&&!useMeter&&<label>Operating time (hours)<input name="hours" type="number" min="0" max="10000000" step="any" required={!runId} disabled={!!runId} placeholder={runId?'From activity proxy':'From meter / log'}/></label>}{kind==='traffic'&&<label>Segment distance (km)<input name="distance_km" type="number" min="0.000001" max="1000000" step="any" required placeholder="Configured road segment"/></label>}{kind==='electricity'&&!useMeter&&<label>Load fraction (0–1)<input name="load_fraction" type="number" min="0.000001" max="1" step="any" required placeholder="Measured or assumed; document below"/></label>}<label>{kind==='electricity'?'Factor (kg CO₂e/kWh)':kind==='fuel'?'Factor (kg CO₂e/litre)':'Factor (g CO₂/vehicle-km)'}<input name="factor" type="number" min="0.000000001" max="1000000000" step="any" required placeholder="No default factor assumed"/></label></div><label>Factor source & applicability<input name="factor_source" required minLength={3} maxLength={1000} placeholder="Source URL / document, year, region, fuel or vehicle class"/></label><label>Activity basis & assumptions<textarea name="basis" required minLength={3} maxLength={1000} placeholder="Runtime source, load assumption, operating interval, fuel type, accounting boundary and uncertainty…"/></label>{kind==='electricity'&&!useMeter&&runId&&<label className="checkbox"><input type="checkbox" required checked={proxy} onChange={e=>setProxy(e.target.checked)}/><span>I accept an unvalidated visible-motion proxy for runtime. It does not establish on/off state or power consumption.</span></label>}<button className="button primary" type="submit" disabled={!connected||busy}><Leaf size={16}/>{busy?'Saving…':'Save carbon estimate'}</button></form></section><aside><section className="formula-card"><span className="eyebrow">THE CALCULATION, NOT A BLACK BOX</span><h3>{kind==='electricity'?'Electric equipment':kind==='fuel'?'Fuel consumption':'Road traffic'}</h3><div className="formula">{useMeter?<>Metered kWh × Factor</>:kind==='electricity'?<>Power × Runtime<br/>× Load × Factor</>:kind==='fuel'?<>Litres consumed<br/>× Fuel factor</>:<>Count × Distance<br/>× Class factor ÷ 1,000</>}</div><p>{useMeter?'Use the metered energy for the documented interval.':kind==='electricity'?'kW × hours = kWh. Multiply by a sourced electricity factor in kg CO₂e/kWh.':kind==='fuel'?'Use litres actually consumed or a documented engineering estimate. On/off time alone is not fuel volume.':'Calculate separately for each class. Use factors in grams CO₂ per vehicle-kilometre.'}</p></section><div className="warning-note section-gap"><strong>A runtime is not a measurement of emissions.</strong><p>Visual motion can be caused by people or lighting. A stationary machine may still consume power. For reliable on/off state use PLC, smart-meter or operator data.</p></div><div className="side-note"><ShieldCheck size={21}/><h3>Boundaries matter.</h3><p>These entries are activity estimates, not a complete industrial carbon inventory. Do not combine overlapping entries, CO₂-only and CO₂e totals, or incompatible factor boundaries.</p></div></aside></div>
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
  return <><Heading eyebrow="AN EVIDENCE TRAIL YOU CAN SHARE" title="Take the full picture with you.">Export saved observations, decisions, vehicle counts and transparent carbon calculations.</Heading><div className="reports-grid"><section className="panel report-config"><div className="panel-heading"><div><h2>Build your report</h2><p>Reports use saved backend records, not dashboard screenshots.</p></div><FileText size={22}/></div><label>Scope<select value={runId} onChange={e=>setRunId(e.target.value)}><option value="">Entire operator workspace</option>{data.runs.map(r=><option key={r.id} value={r.id}>{r.source_name} · {r.id.slice(0,8)}</option>)}</select></label><div className="report-includes">{['Run status and analysis coverage','Suspected events and available evidence','Operator decisions and action notes','Vehicle class counts and activity runtime','Carbon formulas, sources and assumptions','Explicit unavailable-feature disclosures'].map(text=><div key={text}><Check size={17}/>{text}</div>)}</div><div className="action-row"><button className="button primary" disabled={!connected||!!busy} onClick={()=>void exportReport('pdf')}><ArrowDownToLine size={17}/>{busy==='pdf'?'Generating…':'Download PDF'}</button><button className="button secondary" disabled={!connected||!!busy} onClick={()=>void exportReport('csv')}><ArrowDownToLine size={17}/> Export CSV</button></div><p className="small-note">Run-scoped exports include only carbon entries explicitly linked to that run.</p></section><div className="report-preview"><div className="paper"><div className="paper-brand">zenith.</div><span>OPERATIONS / EVIDENCE REPORT</span><h2>Clarity, documented.</h2><p>Safety observations<br/>Activity & carbon estimates</p><div className="paper-line"/><div className="paper-line short"/><div className="paper-metrics"><span><ShieldCheck size={21}/><small>Evidence</small></span><span><Leaf size={21}/><small>Estimates</small></span></div><div className="paper-line"/><div className="paper-line short"/><div className="paper-footer">ILLUSTRATIVE COVER · NOT A GENERATED REPORT</div></div></div></div></>;
}

function HowItWorks() {
  const steps=[
    {icon:Upload,title:'Bring your footage',text:'Upload a short, permitted-use video. Zenith saves a private source and decodes a preview. This MVP does not connect directly to cameras.'},
    {icon:Sparkles,title:'Describe & confirm',text:'A constrained English parser suggests one supported capability. You draw the exact zone or counting line, choose a duration and approved recipient, then confirm.'},
    {icon:Cpu,title:'Detect, track & apply rules',text:'The worker uses YOLOv8 Nano and ByteTrack for people and vehicles. Python checks zone dwell or a finite line crossing. Equipment mode uses pixel motion, not an on/off model.'},
    {icon:ShieldCheck,title:'Inspect the observation',text:'The rule stores a suspected event and source-timestamped frames. Before and after frames are included only when available. You acknowledge, confirm or dismiss it.'},
    {icon:Leaf,title:'Estimate with documented factors',text:'Road counts or equipment runtime can supply activity data. You provide power/fuel data and applicable emission factors. Formulas, units, sources and uncertainty remain attached.'},
    {icon:FileText,title:'Notify & document',text:'Approved contacts produce an email preview by default. Optional Resend configuration enables actual sends. Download PDF or CSV from protected saved records.'},
  ];
  return <><Heading eyebrow="THE SEPARATE EXPLAINER" title="Understand what happens inside.">No hidden claims. Here is what this version does, where the models stop, and where you decide.</Heading><section className="how-intro"><div><Badge tone="hero-badge">HUMAN-CONFIRMED MONITORING</Badge><h2>Language sets the intention.<br/>Rules trigger the observation.<br/><span>People make the decision.</span></h2></div><div className="how-orbit"><Camera size={48}/><span>VIDEO → EVIDENCE</span></div></section><div className="how-steps">{steps.map(({icon:Icon,title,text},i)=><section className="panel how-step" key={title}><div className="how-step-top"><span className="stat-icon mint"><Icon size={22}/></span><span>0{i+1}</span></div><h2>{title}</h2><p>{text}</p></section>)}</div><section className="panel section-gap"><div className="panel-heading"><div><h2>What is available—and what is not</h2><p>The product vision is larger than this first build.</p></div><ShieldCheck size={23}/></div><div className="capability-table"><div><strong>Capability</strong><strong>This version</strong></div>{[
      ['People in a confirmed zone','Real detector + tracking + dwell rule; footage validation still required'],['Vehicle counting','Real class counts and two line-side directions; camera calibration still required'],['Machine operation','Experimental visible-motion proxy or operator-supplied activity; not true on/off sensing'],['Plain-English rules','Constrained local parser; not a preview-inspecting vision agent'],['AI evidence review','Optional NVIDIA or local model interpretation of saved incident frames'],['Possible collapse / PPE / crowd / exit obstruction','Not enabled; dedicated models and representative footage needed'],['Live cameras & health alerts','Not enabled; file-analysis MVP only'],['Email delivery','Preview by default; optional Resend sending, no delivery webhooks'],['Hosting','Laptop primary; optional temporary Colab launcher, no uptime guarantee'],['Safety certification / emissions compliance','Neither claimed nor established'],
    ].map(([a,b])=><div key={a}><strong>{a}</strong><span>{b}</span></div>)}</div></section></>;
}

function Settings({data,connected,notify,refresh}:Props) {
  const [base,setBase]=useState(connection().base);const [key,setKey]=useState(connection().key);const [busy,setBusy]=useState(false);
  const [probe,setProbe]=useState<VisionStatus|null>(null);
  const [probing,setProbing]=useState(false);
  const vision=data.status?.vision;
  useEffect(()=>setProbe(null),[connected,vision?.provider,vision?.model]);
  async function checkVision() {
    setProbing(true);
    try {
      setProbe(await json<VisionStatus>('/vision/status'));
    } catch(error) {
      notify((error as Error).message);
    } finally {
      setProbing(false);
    }
  }
  async function apply(e:FormEvent){e.preventDefault();setBusy(true);const previous=connection();setProbe(null);try{if(base){const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use an HTTPS origin, or a loopback HTTP origin, without a path or credentials.');}if(key.length<24)throw new Error('Enter the operator key generated by the backend.');sessionStorage.setItem('zenith.base',base.replace(/\/$/,''));sessionStorage.setItem('zenith.key',key);await json('/status');refresh();notify('Backend connected. Operator access verified.');}catch(e){sessionStorage.setItem('zenith.base',previous.base);sessionStorage.setItem('zenith.key',previous.key);notify((e as Error).message);}finally{setBusy(false);}}
  return <><Heading eyebrow="YOUR COMPUTE. YOUR WORKSPACE." title="Connect where you run.">Use the laptop backend first. Switch to a temporary Colab endpoint when appropriate.</Heading><div className="settings-grid"><section className="panel settings-form"><div className="panel-heading"><div><h2>Backend connection</h2><p>The key stays in this browser tab’s session storage.</p></div><Badge tone={connected?'success':'neutral'}>{connected?'Connected':'Disconnected'}</Badge></div><form onSubmit={apply}><label>API origin<input type="url" value={base} onChange={e=>setBase(e.target.value)} placeholder="Blank = this dashboard’s server · or https://your-tunnel.ngrok-free.app"/></label><p className="small-note">Leave blank when opening the dashboard from the Colab notebook or running locally. On Vercel, paste the HTTPS origin printed by the notebook.</p><label>Operator API key<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} required minLength={24} placeholder="From data/operator.key or ZENITH_API_KEY"/></label><div className="action-row"><button className="button primary" disabled={busy} type="submit"><Radio size={17}/>{busy?'Connecting…':'Verify & connect'}</button><button type="button" className="button secondary" onClick={()=>{sessionStorage.removeItem('zenith.key');setKey('');refresh();notify('Browser disconnected. Backend records remain saved.');}}>Disconnect</button></div></form></section><section className="panel health-panel"><div className="panel-heading"><div><h2>Service readiness</h2><p>Actual connected-backend state.</p></div><Activity size={21}/></div>{[
    ['API & database',connected?'Connected':'Not connected',connected],['Analysis worker',data.status?.worker_online&&connected?'Heartbeat fresh':'No fresh heartbeat',!!data.status?.worker_online&&connected],['Email',connected&&data.status?.email_mode==='configured'?'Provider configured':'Preview only',false],['Vision model',connected&&vision?.configured?`${vision.provider} · ${vision.model}`:'Off or unavailable',!!(connected&&vision?.available)],['Live camera intake','Not implemented',false],
  ].map(([label,value,ok])=><div className="health-row" key={String(label)}><span>{label}</span><span><span className={`status-dot ${ok?'on':''}`}/>{value}</span></div>)}
    {connected&&vision&&<div className="small-note">
      <p>{vision.detail}</p>
      {vision.configured&&<button className="button secondary" type="button" disabled={probing} onClick={()=>void checkVision()}>{probing?'Checking…':'Check model connection'}</button>}
      {probe&&<p role="status">{probe.reachable===true?'Reachable. ':probe.reachable===false?'Unreachable. ':''}{probe.detail}</p>}
    </div>}
    </section></div><div className="hosting-grid"><section className="panel hosting-card"><span className="stat-icon mint"><MonitorPlay size={23}/></span><Badge tone="success">RECOMMENDED</Badge><h2>Your laptop</h2><p>Run the API and worker locally with SQLite, or use Docker Compose with PostgreSQL. Keep source files and evidence on your disk.</p><code>npm run dev<br/>.venv/bin/python -m uvicorn backend.main:app<br/>.venv/bin/python -m backend.worker</code><small>Setup commands are in README.md. Bind locally unless protected public access is intentional.</small></section><section className="panel hosting-card"><span className="stat-icon peach"><Cpu size={23}/></span><Badge>OPTIONAL / TEMPORARY</Badge><h2>Google Colab</h2><p>Open the dashboard link printed by the notebook and enter your operator key. To use Vercel, enter the tunnel origin too.</p><code>notebooks/Zenith_Colab.ipynb</code><small>Runtimes and GPUs are not guaranteed. Free Colab restricts primarily using a separate web UI. Read docs/COLAB.md and provider policy; it is not persistent SaaS hosting.</small></section></div></>;
}
