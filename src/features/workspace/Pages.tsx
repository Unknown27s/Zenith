import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, BookOpen, Boxes, Camera, Check, ChevronRight, CircleHelp, Clock3, Cpu, FileText, Film, Leaf, LoaderCircle, Menu, MonitorPlay, Plus, Radio, Settings2, ShieldCheck, Sparkles, Upload, X, Zap } from 'lucide-react';
import { connection, download, ensureLocalSession, json, request } from '../../api';
import type { Capability, CarbonEntry, CarbonEstimate, Data, Incident, Page, Point, RuleProposal, Run, Source, VisionStatus } from '../../types';
import EquipmentPanel from '../../EquipmentPanel';
import DemoLibrary from '../../DemoLibrary';
import RunVideo from '../../RunVideo';
import DetectorSettings, { detectorPreset } from '../../DetectorSettings';
import { suggestedPoints } from '../../geometry';
import VideoFindings from '../../VideoFindings';
import CameraCapture from '../../CameraCapture';
import NetworkCamera from '../../NetworkCamera';
import CamerasPage from '../../CamerasPage';
import OperatorKeys from '../../OperatorKeys';
import HealthPanel from '../../HealthPanel';
import DemoSetup from '../../DemoSetup';
import FactorLibrary, { type SavedFactor } from '../../FactorLibrary';
import OverviewLiveFeed from '../../OverviewLiveFeed';
import { analysisModes, runLink, runStatus } from '../../workflow';

const number = (n: number) => new Intl.NumberFormat('en-IN', {maximumFractionDigits:3}).format(n);
const date = (n: number) => new Date(n*1000).toLocaleString();
// Telegram recipients are stored as telegram:<chat id>.
const recipientLabel = (value: string) => value.startsWith('telegram:') ? 'Telegram · chat ' + value.slice(9) : value;

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

interface Props {data: Data;connected:boolean;notify:(message:string)=>void;refresh:()=>void}

export function Overview({data,connected,notify,refresh}: Props) {
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
    <OverviewLiveFeed connected={connected} notify={notify} refresh={refresh}/>
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
      {(run.status==='processing'||run.status==='queued')&&<small>{run.stage||runStatus(run)}</small>}
      {run.status==='processing'&&<progress aria-label="Analysis progress" value={run.progress} max={100}/>}
      {run.error&&<small className="error-text">{run.error}</small>}
    </div>
    <Badge tone={run.status==='completed'?'success':run.status==='failed'?'danger':'neutral'}>{runStatus(run)}</Badge>
  </a>)}</div>;
}

export function Studio({data,connected,notify,refresh,selectedSourceId}: Props & {selectedSourceId:string}) {
  const [sourceId,setSourceId]=useState(()=>selectedSourceId||sessionStorage.getItem('zenith.source')||''); const [instruction,setInstruction]=useState(()=>sessionStorage.getItem('zenith.instruction')||'');
  const [capability,setCapability]=useState<Capability>(()=>{const value=sessionStorage.getItem('zenith.capability');return value==='traffic'||value==='machine_activity'||value==='action'?value:'zone';});const [points,setPoints]=useState<Point[]>([]);
  const [dwell,setDwell]=useState('2');const [name,setName]=useState(''); const [recipients,setRecipients]=useState<string[]>([]); const [cooldown,setCooldown]=useState('300');
  const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState('');
  const [proposalResult,setProposalResult]=useState<RuleProposal|null>(null);
  const [proposalConsent,setProposalConsent]=useState(false);
  const appliedProposal=useRef<{capability:Capability}|null>(null);
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
  const source=data.sources.find(x=>x.id===sourceId);
  useEffect(()=>{if(sourceId)sessionStorage.setItem('zenith.source',sourceId);},[sourceId]);
  useEffect(()=>{sessionStorage.setItem('zenith.capability',capability);},[capability]);
  useEffect(()=>{if(!sourceId&&data.sources.length)setSourceId(data.sources[0].id);},[sourceId,data.sources]);
  useEffect(()=>{
    if(appliedProposal.current?.capability===capability){
      appliedProposal.current=null;
      setConfirmed(false);
      setFormError('');
      setVideo('');
      return;
    }
    setDetector(detectorPreset(capability));
    const proposed=sourceId?suggestedPoints(capability,source?.example_id):[];
    setPoints(proposed);
    const sampleSegment=capability==='traffic'&&proposed.length===4;
    setSegment(sampleSegment);
    setMetres(sampleSegment?'50':'');
    setConfirmed(false);
    setFormError('');
    setVideo('');
    setProposalResult(null);
  },[sourceId,capability,source?.example_id]);
  useEffect(()=>()=>{if(video)URL.revokeObjectURL(video);},[video]);
  async function upload(file:File|undefined) {
    if(!file)return;if(file.size>(data.status?.max_upload_mb||100)*1024*1024){notify('Clip exceeds the upload limit.');return;}
    setBusy('upload');try{const body=new FormData();body.append('file',file);const item=await json<Source>('/sources',{method:'POST',body});setSourceId(item.id);refresh();notify('Video uploaded. Review the suggested region or line before confirming.');}catch(e){notify((e as Error).message);}finally{setBusy('');}
  }
  async function propose() {
    setBusy('proposal');
    setProposalResult(null);
    try {
      const hosted=!!(vision?.available&&vision.provider==='nvidia'&&proposalConsent);
      const local=!!(vision?.available&&vision.provider==='local');
      const provider=hosted?'nvidia':local?'local':undefined;
      const result=await json<RuleProposal>('/proposals',{method:'POST',signal:AbortSignal.timeout(185000),body:JSON.stringify({
        instruction,
        ...(sourceId?{source_id:sourceId}:{}),
        ...(provider?{vision_provider:provider,vision_consent:provider==='nvidia'?proposalConsent:false}:{}),
      })});
      const changed=result.capability!==capability;
      if(changed)appliedProposal.current={capability:result.capability};
      setCapability(result.capability);
      if(result.points)setPoints(result.points);
      setDwell(String(result.dwell_seconds));
      if(result.motion_threshold!==undefined)setThreshold(String(result.motion_threshold));
      if(result.action_confidence!==undefined)setActionConfidence(String(result.action_confidence));
      setDetector(current=>({...current,
        ...(result.confidence!==undefined?{confidence:result.confidence}:{}),
        ...(result.image_size!==undefined?{image_size:result.image_size}:{}),
        ...(result.iou_threshold!==undefined?{iou_threshold:result.iou_threshold}:{}),
        ...(result.analysis_fps!==undefined?{analysis_fps:result.analysis_fps}:{}),
        ...(result.vehicle_classes?.length?{vehicle_classes:result.vehicle_classes}:{}),
      }));
      if(result.capability==='traffic'){
        setSegment(result.points?.length===4);
        if(result.points?.length===2)setMetres('');
      }
      if(result.name&&!name.trim())setName(result.name);
      setProposalResult(result);
      setConfirmed(false);
    } catch(e) {
      setProposalResult(null);
      notify((e as Error).message);
    } finally {setBusy('');}
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
  return <><Heading eyebrow="MONITORING" title="Start an analysis">Describe the rule in plain English, then review Zenith’s proposed region and settings.</Heading>
    <section className="panel instruction-panel instruction-primary">
      <div className="panel-heading"><div><h2><Sparkles size={21}/> Describe what to detect</h2><p>Zenith samples frames from the selected clip and proposes a region, gate and detector settings. Drawing is optional.</p></div>{source&&<Badge>{source.input_type==='sample'?'Sample':'Upload'}</Badge>}</div>
      <textarea value={instruction} onChange={e=>{setInstruction(e.target.value);setConfirmed(false);}} maxLength={2000}
        placeholder="Alert when someone stays in the loading bay for more than 10 seconds." aria-label="Plain-English monitoring instruction"/>
      {vision?.available&&vision.provider==='nvidia'&&<label className="checkbox proposal-consent"><input type="checkbox" checked={proposalConsent} onChange={e=>setProposalConsent(e.target.checked)}/><span>Use the hosted NVIDIA vision model for this proposal. It receives one sampled frame and returns a draft geometry. Leave unchecked to use only the local detector.</span></label>}
      {!sourceId&&<p className="info-note proposal-consent">Select a source clip to propose geometry. Without one, only the analysis type and duration can be suggested.</p>}
      <div className="instruction-bottom">
        <span>A proposal is a reviewable draft, not camera calibration or scene understanding.</span>
        <button className="button primary" disabled={!connected||!!busy||instruction.trim().length<5} onClick={()=>void propose()}><Sparkles size={15}/>{busy==='proposal'?'Proposing…':'Propose rule'}</button>
      </div>
      {proposalResult&&<div className="proposal-summary">
        <div className="info-note">
          <strong>{proposalResult.parser||'Proposal'}</strong>{proposalResult.model?` · ${proposalResult.model}`:''}
          {proposalResult.rationale&&<p>{proposalResult.rationale}</p>}
          <small>Applied to the rule panel. Review the geometry and settings, then confirm before running.</small>
        </div>
        {!!proposalResult.uncertainties?.length&&<ul>{proposalResult.uncertainties.map((item,i)=><li key={i}>{item}</li>)}</ul>}
        {!!proposalResult.warnings?.length&&<div className="warning-note">{proposalResult.warnings.join(' ')}</div>}
      </div>}
    </section>
    <fieldset className="workspace-modes">
      <legend>Analysis type</legend>
      {(Object.keys(analysisModes) as Capability[]).map(mode=><label className="workspace-mode" key={mode}>
        <input type="radio" name="analysis-mode" value={mode} checked={mode===capability}
          onChange={()=>{setCapability(mode);}}/>
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
      </div></div>{capability==='machine_activity'&&<div className="warning-note">Stationary powered equipment can look inactive. People, shadows and camera movement can look like operation. Do not use this as an on/off sensor.</div>}<label className="checkbox"><input type="checkbox" checked={confirmed} disabled={!enough} onChange={e=>setConfirmed(e.target.checked)}/><span>I reviewed the region, rule and notification recipients.</span></label>{vision&&<label className="checkbox">
      <input type="checkbox" checked={review} disabled={!vision.available} onChange={e=>setReview(e.target.checked)}/>
       <span>{vision.available
         ? <>{vision.provider!=='local'
             ? `I have permission to send sampled frames and incident evidence from this clip to ${vision.provider==='typesafe'?'TypeSafe (experimental image review)':'NVIDIA'} for advisory review.`
             : 'Summarize sampled video frames and review saved incident evidence with the local vision model.'} Up to {vision.auto_limit} incidents per run.</>
         : `Vision review is configured but not available: ${vision.detail||'check Settings'}.`}</span>
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
        <span>I have permission to send this incident’s evidence frames to {vision.provider==='typesafe'?'TypeSafe (experimental image review)':'NVIDIA'}.</span>
      </label>}
      <button className="button secondary" type="button" disabled={!connected||busy||(vision.provider!=='local'&&!consent)} onClick={()=>void requestReview()}>
        {busy?'Queueing…':review?.status==='completed'||review?.status==='failed'?'Run review again':'Request review'}
      </button>
    </>}
  </section>;
}

export function Incidents({data,connected,notify,refresh,selectedId}: Props & {selectedId:string}) {
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
    <section className="panel section-gap"><div className="panel-heading"><div><h2>Notification outbox</h2><p>Delivery state is separate from an operator’s acknowledgement.</p></div><Badge>{data.status?.channels?.telegram?.configured?'Telegram configured':data.status?.email_mode==='configured'?'Email configured':'Preview mode'}</Badge></div>{data.notifications.length?<div className="notification-list">{data.notifications.map(n=><details key={n.id}><summary><Bell size={17}/><span>{n.subject}<small>{recipientLabel(n.recipient)}</small></span><Badge tone={n.status==='sent'?'success':'neutral'}>{n.status}</Badge></summary><pre>{n.text}</pre><p>{n.delivery||n.error||'Preview does not mean sent. Configure Telegram or email, then verify with a test alert.'}</p></details>)}</div>:<div className="inline-empty">No notification tasks yet. Tasks appear when a confirmed rule produces an observation and a recipient is approved.</div>}</section>
    {event&&<div className="modal-backdrop" onClick={closeModal}><section className="modal" role="dialog" aria-modal="true" aria-label="Incident review" onClick={e=>e.stopPropagation()}><div className="panel-heading"><div><Badge tone="warning">RULE OBSERVATION</Badge><h2>{event.title}</h2><p>{event.source_name} · source {event.source_seconds.toFixed(2)}s</p></div><button className="icon-button" aria-label="Close incident review" onClick={closeModal}><X/></button></div><div className="evidence-grid">{event.frames.map(frame=><figure key={frame}><ProtectedImage path={`/events/${event.id}/evidence/${frame}`} alt={`${frame.includes('before')?'Before':frame.includes('after')?'After':'During'} event evidence`}/><figcaption>{frame.includes('before')?'Before':frame.includes('after')?'After':'During'}</figcaption></figure>)}</div><p>{event.detail}</p>{event.alert?.status==='suppressed'&&<div className="info-note">Alert suppressed for {event.alert.cooldown_seconds}s after the previous alert for this rule. The incident and evidence were kept.{event.alert.suppressed_until?` Next alert allowed after ${date(event.alert.suppressed_until)}.`:''}</div>}{event.alert?.status==='queued'&&<div className="info-note">Alert queued to {event.alert.recipients?.length||0} recipient(s). Delivery state is in the notification outbox.</div>}<IncidentVision key={event.id} event={event} vision={data.status?.vision} connected={connected} notify={notify} refresh={refresh}/><label>Action note<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} placeholder="What did you verify? What action was taken?"/></label><div className="action-row"><button className="button primary" disabled={!connected||busy} onClick={()=>void act('acknowledged')}><Check size={16}/> Acknowledge</button><button className="button secondary" disabled={!connected||busy} onClick={()=>void act('confirmed')}>Confirm observation</button><button className="button secondary" disabled={!connected||busy} onClick={()=>void act('dismissed')}>Dismiss</button></div><div className="history">{event.history.map(h=><p key={`${h.at}-${h.action}`}><strong>{h.action}</strong> · {date(h.at)}<br/>{h.note}</p>)}</div></section></div>}
  </>;
}

export function Carbon({data,connected,notify,refresh,requestedRunId}:Props & {requestedRunId:string}) {
  const [kind,setKind]=useState<'electricity'|'fuel'|'traffic'>('electricity');
  const [metered,setMetered]=useState(false);
  const [sourceMode,setSourceMode]=useState<'manual'|'run'>('manual');
  const [runId,setRunId]=useState('');

  const [factor,setFactor]=useState<SavedFactor|null>(null);
  const [manualFactor,setManualFactor]=useState('');
  const [manualSource,setManualSource]=useState('');

  const [activityName,setActivityName]=useState('');
  const [quantity,setQuantity]=useState('');
  const [hours,setHours]=useState('');
  const [meteredKwh,setMeteredKwh]=useState('');
  const [loadFraction,setLoadFraction]=useState('0.85');
  const [distanceKm,setDistanceKm]=useState('1');
  const [vehicleClass,setVehicleClass]=useState<'car'|'motorcycle'|'bus'|'truck'>('car');

  const [basis,setBasis]=useState('');
  const [proxy,setProxy]=useState(false);

  const [busy,setBusy]=useState(false);
  const [previewing,setPreviewing]=useState(false);
  const [preview,setPreview]=useState<CarbonEstimate|null>(null);
  const [estimateError,setEstimateError]=useState('');
  const previewRevision=useRef(0);

  function clearPreview(){
    previewRevision.current+=1;
    setPreview(null);
    setEstimateError('');
  }

  // Handle incoming link or candidate run pre-selection
  const selectedRun=data.runs.find(run=>run.id===runId);

  useEffect(()=>{
    if(!requestedRunId)return;
    const run=data.runs.find(r=>r.id===requestedRunId&&r.status==='completed');
    if(!run)return;
    if(run.rule.capability==='traffic'){
      setKind('traffic');
      setSourceMode('run');
      setRunId(run.id);
      setActivityName(run.source_name);
      setVehicleClass('car');
      setQuantity(String(run.counts?.car ?? 0));
      if(run.rule.segment_metres)setDistanceKm((run.rule.segment_metres/1000).toString());
    }else if(run.rule.capability==='machine_activity'){
      setKind('electricity');
      setSourceMode('run');
      setRunId(run.id);
      setActivityName(run.source_name);
      setMetered(false);
      setHours(((run.activity_seconds||0)/3600).toFixed(4));
    }
  },[requestedRunId]);

  useEffect(()=>{
    if(!selectedRun)return;
    setActivityName(selectedRun.source_name);
    if(kind==='traffic'){
      const cnt=selectedRun.counts?.[vehicleClass] ?? 0;
      setQuantity(String(cnt));
      if(selectedRun.rule.segment_metres)setDistanceKm((selectedRun.rule.segment_metres/1000).toString());
    }else if(kind==='electricity'&&sourceMode==='run'){
      setHours(((selectedRun.activity_seconds||0)/3600).toFixed(4));
    }
  },[selectedRun?.id,kind,vehicleClass,sourceMode]);

  useEffect(()=>{
    if(factor?.vehicle_class&&kind==='traffic'){
      setVehicleClass(factor.vehicle_class as 'car'|'motorcycle'|'bus'|'truck');
    }
  },[factor,kind]);

  function handleUseEquipment(eqName:string,eqHours:number){
    setKind('electricity');
    setMetered(false);
    setSourceMode('manual');
    setRunId('');
    setActivityName(eqName);
    setHours(eqHours.toFixed(4));
    setBasis(`Logged runtime (${eqHours.toFixed(2)} h) from facility machine operation log.`);
    const el=document.getElementById('carbon-calculator-top');
    if(el)el.scrollIntoView({behavior:'smooth'});
    notify(`Applied ${eqName} runtime (${eqHours.toFixed(2)} h) to calculator.`);
  }

  // Active factor values
  const effectiveFactor=factor?factor.factor:(Number(manualFactor)||0);
  const effectiveSource=factor?`${factor.source} · ${factor.region} · ${factor.year}`:manualSource;
  const factorUnit=kind==='traffic'?'g CO₂/vehicle-km':kind==='fuel'?'kg CO₂e/litre':'kg CO₂e/kWh';

  // Live real-time math
  const numQuantity=Number(quantity||0);
  const numHours=Number(hours||0);
  const numLoad=Number(loadFraction||1);
  const numMetered=Number(meteredKwh||0);
  const numDist=Number(distanceKm||1);

  let liveKg=0;
  let liveEquation='';
  if(kind==='electricity'){
    if(metered){
      liveKg=numMetered*effectiveFactor;
      liveEquation=`${numMetered} kWh × ${effectiveFactor} ${factorUnit}`;
    }else{
      liveKg=numQuantity*numHours*numLoad*effectiveFactor;
      liveEquation=`${numQuantity} kW × ${numHours} h × ${numLoad} load × ${effectiveFactor} ${factorUnit}`;
    }
  }else if(kind==='fuel'){
    liveKg=numQuantity*effectiveFactor;
    liveEquation=`${numQuantity} L × ${effectiveFactor} ${factorUnit}`;
  }else if(kind==='traffic'){
    liveKg=(numQuantity*numDist*effectiveFactor)/1000;
    liveEquation=`${numQuantity} vehicles × ${numDist} km × ${effectiveFactor} ${factorUnit} ÷ 1,000`;
  }

  const quantitySummary=kind==='traffic'
    ? `${sourceMode==='run'&&selectedRun?(selectedRun.counts[vehicleClass]??0):numQuantity} ${vehicleClass} vehicles`
    : kind==='electricity'
      ? metered?`${numMetered} metered kWh`:`${numQuantity} kW × ${numHours} h × ${numLoad} load`
      : `${numQuantity} litres`;
  const activityKind=kind==='traffic'?'Road traffic':kind==='fuel'?'Fuel combustion':'Electric equipment';

  function getPayload(){
    return JSON.stringify({
      name:activityName.trim()||(selectedRun?selectedRun.source_name:`${kind} estimate`),
      kind,
      quantity:kind==='traffic'&&sourceMode==='run'&&selectedRun?(selectedRun.counts[vehicleClass]??0):numQuantity,
      metered_kwh:kind==='electricity'&&metered?numMetered:null,
      factor:effectiveFactor,
      factor_id:factor&&!factor.preset?factor.id:null,
      factor_source:effectiveSource,
      basis:basis.trim()||(selectedRun?`Calculated from CCTV analysis of ${selectedRun.source_name}`:'Operator documented activity'),
      hours:kind==='electricity'&&!metered?(sourceMode==='run'&&selectedRun?(selectedRun.activity_seconds||0)/3600:numHours||1):1,
      load_fraction:kind==='electricity'&&!metered?numLoad||1:1,
      distance_km:kind==='traffic'?(sourceMode==='run'&&selectedRun?.rule.segment_metres?selectedRun.rule.segment_metres/1000:numDist||1):1,
      run_id:sourceMode==='run'?runId||null:null,
      vehicle_class:kind==='traffic'?(vehicleClass||factor?.vehicle_class||null):null,
      accept_activity_proxy:kind==='electricity'&&!metered&&sourceMode==='run'?proxy:false,
    });
  }

  const manualSourceMissing=!factor&&effectiveFactor>0&&manualSource.trim().length<3;
  const runMissing=sourceMode==='run'&&kind!=='fuel'&&!selectedRun;
  const proxyMissing=kind==='electricity'&&!metered&&sourceMode==='run'&&!!selectedRun&&!proxy;
  const canCalculate=connected&&!busy&&!previewing&&effectiveFactor>0&&!manualSourceMissing&&!runMissing&&!proxyMissing&&!!activityName.trim()&&basis.trim().length>=3;

  async function submitCalculation(save:boolean){
    if(!effectiveFactor||effectiveFactor<=0){
      setEstimateError('Select or enter a positive emission factor in Step 2.');
      return;
    }
    if(manualSourceMissing){
      setEstimateError('Add the source, region and year for the manual factor in Step 2.');
      return;
    }
    if(runMissing){
      setEstimateError('Choose a completed CCTV run in Step 1, or switch the activity data source to Manual Log / Meter.');
      return;
    }
    if(!activityName.trim()){
      setEstimateError('Give this activity a name in Step 4.');
      return;
    }
    if(basis.trim().length<3){
      setEstimateError('Describe how the activity quantity was measured in Step 4.');
      return;
    }
    if(proxyMissing){
      setEstimateError('Accept the visible-motion proxy disclaimer before saving.');
      return;
    }

    setEstimateError('');
    if(save)setBusy(true);else setPreviewing(true);
    const revision=++previewRevision.current;

    try{
      const body=getPayload();
      const result=await json<CarbonEstimate>(save?'/carbon':'/carbon/preview',{method:'POST',body});
      if(save){
        clearPreview();
        refresh();
        notify('Carbon estimate saved to activity ledger.');
      }else if(revision===previewRevision.current){
        setPreview(result);
      }
    }catch(error){
      if(save||revision===previewRevision.current)setEstimateError((error as Error).message);
    }finally{
      if(save)setBusy(false);else setPreviewing(false);
    }
  }

  const equipment=data.carbon.filter(x=>x.kind!=='traffic').reduce((s,x)=>s+x.kg,0);
  const road=data.carbon.filter(x=>x.kind==='traffic').reduce((s,x)=>s+x.kg,0);
  const candidates=data.runs.filter(r=>r.status==='completed'&&r.rule.capability===(kind==='traffic'?'traffic':'machine_activity'));

  return <>
    <Heading eyebrow="BUILT-IN CARBON ACCOUNTING" title="Carbon & emissions accounting">
      Transparent, auditable calculation pipeline for equipment power, fuel consumption, and vehicle road traffic.
    </Heading>

    <div className="stat-grid carbon-stats" id="carbon-calculator-top">
      <section className="stat-card">
        <div className="stat-top">Equipment & electricity<Zap size={20}/></div>
        <strong>{data.carbon.some(x=>x.kind!=='traffic')?number(equipment):'—'} <em>kg CO₂e</em></strong>
        <small>Electricity & stationary fuel estimates</small>
      </section>
      <section className="stat-card">
        <div className="stat-top">Road traffic<Activity size={20}/></div>
        <strong>{data.carbon.some(x=>x.kind==='traffic')?number(road):'—'} <em>kg CO₂</em></strong>
        <small>Vehicle-kilometre travel estimates</small>
      </section>
      <section className="stat-card">
        <div className="stat-top">Saved ledger entries<FileText size={20}/></div>
        <strong>{data.carbon.length}</strong>
        <small>Saved with source, formula & assumptions</small>
      </section>
    </div>

    <div className="carbon-layout">
      <section className="panel carbon-form">
        <div className="panel-heading">
          <div>
            <h2>Calculate emission estimate</h2>
            <p>Four sections: activity and source, documented factor, quantities, then preview and save.</p>
          </div>
          <Leaf size={22}/>
        </div>

        {/* Stepper Pipeline Header */}
        <div className="carbon-stepper-header">
          <div className="stepper-step active">
            <span className="stepper-step-num">01</span>
            <div className="stepper-step-info">
              <span className="stepper-step-title">Activity & Source</span>
              <span className="stepper-step-sub">{kind === 'electricity' ? 'Electricity' : kind === 'fuel' ? 'Fuel' : 'Traffic'}</span>
            </div>
          </div>
          <div className={`stepper-step ${effectiveFactor > 0 ? 'active' : ''}`}>
            <span className="stepper-step-num">02</span>
            <div className="stepper-step-info">
              <span className="stepper-step-title">Emission Factor</span>
              <span className="stepper-step-sub">{effectiveFactor > 0 ? `${effectiveFactor} ${factorUnit}` : 'Choose factor'}</span>
            </div>
          </div>
          <div className={`stepper-step ${liveKg > 0 ? 'active' : ''}`}>
            <span className="stepper-step-num">03</span>
            <div className="stepper-step-info">
              <span className="stepper-step-title">Parameters & Math</span>
              <span className="stepper-step-sub">{liveKg > 0 ? `${liveKg.toFixed(2)} kg` : 'Input parameters'}</span>
            </div>
          </div>
          <div className={`stepper-step ${preview ? 'active' : ''}`}>
            <span className="stepper-step-num">04</span>
            <div className="stepper-step-info">
              <span className="stepper-step-title">Audit & Commit</span>
              <span className="stepper-step-sub">{preview ? 'Verified' : 'Verify & save'}</span>
            </div>
          </div>
        </div>

        <form onSubmit={e=>{e.preventDefault();}} onChange={clearPreview} className="carbon-pipeline">
          {/* STEP 1: ACTIVITY & SOURCE */}
          <div className="carbon-step-box">
            <div className="carbon-step-header">
              <span className="step-circle-badge">01</span>
              <div>
                <h3>Step 1: Choose Activity Category & Data Source</h3>
                <p>Select what is generating emissions and where the activity data originates.</p>
              </div>
            </div>

            <div className="tab-row" style={{marginBottom: 0}}>
              {[
                ['electricity','⚡ Electric equipment'],
                ['fuel','⛽ Fuel consumption'],
                ['traffic','🚗 Road traffic']
              ].map(([id,label])=>(
                <button
                  key={id}
                  type="button"
                  className={kind===id?'selected':''}
                  onClick={()=>{
                    setKind(id as 'electricity'|'fuel'|'traffic');
                    setRunId('');
                    setSourceMode('manual');
                    setProxy(false);
                    setMetered(false);
                    setFactor(null);
                    setManualFactor('');
                    setManualSource('');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {kind==='electricity' && (
              <div style={{display:'flex',gap:'12px',flexDirection:'column'}}>
                <label>Electricity calculation method
                  <select value={metered?'meter':'runtime'} onChange={e=>{setMetered(e.target.value==='meter');setProxy(false);}}>
                    <option value="runtime">⚡ Power × Runtime (kW × Operating hours)</option>
                    <option value="meter">📊 Total Metered Energy (kWh from meter or utility bill)</option>
                  </select>
                </label>
              </div>
            )}

            {kind!=='fuel' && (
              <div>
                <label style={{marginBottom:'8px'}}>Activity data source</label>
                <div className="carbon-source-toggle">
                  <button
                    type="button"
                    className={`source-card-btn ${sourceMode==='manual'?'selected':''}`}
                    onClick={()=>{setSourceMode('manual');setRunId('');setProxy(false);}}
                  >
                    <div className="source-card-top">
                      <span>📝 Manual Log / Meter</span>
                      {sourceMode==='manual'&&<Check size={14}/>}
                    </div>
                    <p>Enter known operational hours, utility meter readings, or road survey counts.</p>
                  </button>

                  <button
                    type="button"
                    className={`source-card-btn ${sourceMode==='run'?'selected':''}`}
                    onClick={()=>{setSourceMode('run');setProxy(false);}}
                  >
                    <div className="source-card-top">
                      <span>📹 CCTV Video Run</span>
                      {sourceMode==='run'&&<Check size={14}/>}
                    </div>
                    <p>Auto-fill from completed computer vision analysis or optical motion proxy.</p>
                  </button>
                </div>
              </div>
            )}

            {sourceMode==='run'&&kind!=='fuel'&&(
              <label>Select analyzed video run
                <select value={runId} onChange={e=>{setRunId(e.target.value);setProxy(false);}}>
                  <option value="">Choose a completed run…</option>
                  {candidates.map(r=><option key={r.id} value={r.id}>{r.source_name} · ID: {r.id.slice(0,8)} ({new Date(r.created).toLocaleDateString()})</option>)}
                </select>
              </label>
            )}

            {kind==='traffic'&&sourceMode==='run'&&selectedRun&&(
              <div>
                <label style={{marginBottom:'8px'}}>Select vehicle class (detected count)</label>
                <div className="vehicle-class-pill-row">
                  {(['car','motorcycle','bus','truck'] as const).map(c=>(
                    <button
                      key={c}
                      type="button"
                      className={`vehicle-class-pill ${vehicleClass===c?'selected':''}`}
                      onClick={()=>{setVehicleClass(c);setQuantity(String(selectedRun.counts?.[c]??0));}}
                    >
                      <span style={{textTransform:'capitalize'}}>{c}</span>
                      <span className="count-badge">{selectedRun.counts?.[c] ?? 0}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* STEP 2: EMISSION FACTOR */}
          <div className="carbon-step-box">
            <div className="carbon-step-header">
              <span className="step-circle-badge">02</span>
              <div>
                <h3>Step 2: Sourced Emission Factor</h3>
                <p>Pick a published national/regional reference preset, choose a saved factor, or enter a custom value.</p>
              </div>
            </div>

            <FactorLibrary kind={kind} connected={connected} onSelect={setFactor} notify={notify} embedded={true}/>

            {!factor && (
              <div className="form-grid" style={{marginTop:'10px'}}>
                <label>Manual emission factor ({factorUnit})
                  <input
                    type="number"
                    step="any"
                    min="0.000000001"
                    value={manualFactor}
                    onChange={e=>setManualFactor(e.target.value)}
                    placeholder={`e.g. ${kind==='traffic'?'145':kind==='fuel'?'2.68':'0.71'}`}
                  />
                </label>
                <label>Factor source citation & applicability
                  <input
                    value={manualSource}
                    onChange={e=>setManualSource(e.target.value)}
                    placeholder="e.g. CEA Baseline 2023, DEFRA 2024, or EPA eGRID"
                  />
                </label>
              </div>
            )}

            {effectiveFactor > 0 && (
              <div className="factor-active-card">
                <div className="factor-active-meta">
                  <span className="badge success">FACTOR SELECTED</span>
                  <strong>{effectiveSource || 'Source not documented yet'}</strong>
                  <small>{manualSourceMissing ? 'Add a source citation below before saving.' : `Applicable unit: ${factorUnit}`}</small>
                </div>
                <div className="factor-active-val">{effectiveFactor} <small>{factorUnit}</small></div>
              </div>
            )}
          </div>

          {/* STEP 3: PARAMETERS & LIVE MATH */}
          <div className="carbon-step-box">
            <div className="carbon-step-header">
              <span className="step-circle-badge">03</span>
              <div>
                <h3>Step 3: Activity Quantities & Parameters</h3>
                <p>Provide the operational measurements. The transparent arithmetic updates in real-time below.</p>
              </div>
            </div>

            <div className="form-grid">
              {kind==='electricity' && metered ? (
                <label>Total metered energy (kWh)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={meteredKwh}
                    onChange={e=>setMeteredKwh(e.target.value)}
                    placeholder="From electric meter reading"
                    required
                  />
                </label>
              ) : (
                <label>{kind==='electricity'?'Rated / measured power (kW)':kind==='fuel'?'Fuel consumed (Litres)':'Vehicle count'}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={e=>setQuantity(e.target.value)}
                    disabled={kind==='traffic'&&sourceMode==='run'}
                    placeholder={kind==='traffic'&&sourceMode==='run'?'From selected CCTV run':'e.g. 15.5'}
                    required
                  />
                </label>
              )}

              {kind==='electricity'&&!metered&&(
                <label>Operating runtime (hours)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={hours}
                    onChange={e=>setHours(e.target.value)}
                    disabled={sourceMode==='run'}
                    placeholder={sourceMode==='run'?'From video motion proxy':'e.g. 4.5'}
                    required
                  />
                </label>
              )}

              {kind==='electricity'&&!metered&&(
                <label>Average load fraction (0.01 – 1.0)
                  <input
                    type="number"
                    min="0.01"
                    max="1"
                    step="0.01"
                    value={loadFraction}
                    onChange={e=>setLoadFraction(e.target.value)}
                    placeholder="e.g. 0.85 (for 85% load)"
                    required
                  />
                </label>
              )}

              {kind==='traffic'&&(
                <label>Road segment distance (km)
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={distanceKm}
                    onChange={e=>setDistanceKm(e.target.value)}
                    placeholder="e.g. 1.0"
                    required
                  />
                </label>
              )}
            </div>

            {/* Live Interactive Math Preview */}
            <div className="live-math-chip">
              <div className="live-math-top">
                <span>⚡ Real-time formula breakdown</span>
                <span>{kind==='traffic'?'CO₂ (Road)':'CO₂e (GHG Scope 1 & 2)'}</span>
              </div>
              <div className="live-math-equation">
                {liveEquation || 'Enter quantities and factor above to preview formula'}
              </div>
              <div className="live-math-result">
                <strong>{new Intl.NumberFormat('en-IN',{maximumFractionDigits:4}).format(liveKg)}</strong>
                <span>kg {kind==='traffic'?'CO₂':'CO₂e'}</span>
              </div>
            </div>
          </div>

          {/* STEP 4: AUDIT TRAIL & COMMIT */}
          <div className="carbon-step-box">
            <div className="carbon-step-header">
              <span className="step-circle-badge">04</span>
              <div>
                <h3>Step 4: Audit Documentation & Ledger Commitment</h3>
                <p>Record identifying details, accounting boundaries, and commit to the permanent ledger.</p>
              </div>
            </div>

            <label>Equipment / activity name
              <input
                value={activityName}
                onChange={e=>setActivityName(e.target.value)}
                required
                maxLength={100}
                placeholder={kind==='electricity'?'e.g. Loading-bay conveyor #2':kind==='fuel'?'e.g. Backup diesel generator #1':'e.g. Main Gate Entry · Passenger Cars'}
              />
            </label>

            <label>Activity basis & methodology assumptions
              <textarea
                value={basis}
                onChange={e=>setBasis(e.target.value)}
                required
                minLength={3}
                maxLength={1000}
                placeholder="Explain runtime documentation, load factor rationale, meter serial number, fuel receipt date, boundary exclusions…"
              />
            </label>

            {kind==='electricity'&&!metered&&sourceMode==='run'&&runId&&(
              <label className="checkbox">
                <input type="checkbox" required checked={proxy} onChange={e=>setProxy(e.target.checked)}/>
                <span>I accept an unvalidated visible-motion proxy for runtime. It does not establish on/off state or electrical power draw.</span>
              </label>
            )}

            <div className="carbon-save-summary">
              <div><span>READY TO SAVE</span><strong>{activityName.trim() || 'Name this activity in Step 4'}</strong></div>
              <dl>
                <div><dt>Activity</dt><dd>{activityKind}</dd></div>
                <div><dt>Quantity</dt><dd>{quantitySummary}</dd></div>
                <div><dt>Factor</dt><dd>{effectiveFactor > 0 ? `${effectiveFactor} ${factorUnit}` : 'Not selected'}</dd></div>
                <div><dt>Source</dt><dd>{effectiveSource || 'Not documented'}</dd></div>
                <div><dt>Live result</dt><dd>{new Intl.NumberFormat('en-IN',{maximumFractionDigits:4}).format(liveKg)} kg</dd></div>
              </dl>
              <p>Nothing is saved until you click <strong>Save to activity ledger</strong>. Preview asks the server to recalculate and show the exact formula first.</p>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="button primary"
                disabled={!canCalculate}
                onClick={()=>void submitCalculation(false)}
              >
                <Sparkles size={16}/>{previewing?'Calculating…':'Preview formula (not saved)'}
              </button>

              <button
                type="button"
                className="button secondary"
                disabled={!canCalculate}
                onClick={()=>void submitCalculation(true)}
              >
                <Leaf size={16}/>{busy?'Saving…':'Save to activity ledger'}
              </button>
            </div>

            {estimateError&&<p className="error-text" role="alert">{estimateError}</p>}

            {preview&&(
              <div className="info-note workspace-estimate carbon-preview-result" role="status">
                <span className="badge warning">Preview only — not saved</span>
                <strong>Server preview: {new Intl.NumberFormat('en-IN',{maximumFractionDigits:6}).format(preview.kg)} kg {preview.kind==='traffic'?'CO₂':'CO₂e'}</strong>
                <p><code>{preview.formula}</code></p>
                <p><strong>Source:</strong> {preview.factor_source} · <strong>Coverage:</strong> {preview.coverage}</p>
                <p className="small-note">Saving commits this exact server calculation to the ledger.</p>
              </div>
            )}
          </div>
        </form>
      </section>

      {/* Aside Guidance & Formula Reference */}
      <aside>
        <section className="formula-card">
          <span className="eyebrow">TRANSPARENT ACCOUNTING</span>
          <h3>{kind==='electricity'?'Electric equipment':kind==='fuel'?'Fuel combustion':'Road vehicle traffic'}</h3>
          <div className="formula">
            {metered?<>Metered kWh × Factor</>:kind==='electricity'?<>Power (kW) × Hours<br/>× Load × Factor</>:kind==='fuel'?<>Litres consumed<br/>× Fuel factor</>:<>Vehicles × Distance (km)<br/>× Class factor ÷ 1,000</>}
          </div>
          <p>
            {metered
              ?'Use verified metered kWh for the documented billing or operating interval.'
              :kind==='electricity'
              ?'Power (kW) multiplied by operating hours gives kilowatt-hours. Factor converts to kg CO₂e.'
              :kind==='fuel'
              ?'Use litres actually combusted from tank logs or receipts. Multiply by fuel emission factor.'
              :'Calculate separately for each class using factor in grams CO₂ per vehicle-kilometre.'}
          </p>
        </section>

        <div className="warning-note section-gap">
          <strong>Optical motion is not an electrical power meter.</strong>
          <p>Visual motion can be caused by ambient lighting or personnel. A stationary machine may still draw idle power. For verified industrial accounting, pair CCTV with smart-meter readings or operator logs.</p>
        </div>

        <div className="side-note">
          <ShieldCheck size={21}/>
          <h3>Boundaries & Standards</h3>
          <p>These entries are activity estimates for operational tracking. Do not mix Scope 1 direct fuel with Scope 2 indirect electricity, or combine CO₂-only with CO₂e totals without proper tagging.</p>
        </div>
      </aside>
    </div>

    {/* Video evidence if CCTV run is selected */}
    {selectedRun&&(
      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Video evidence for selected run</h2>
            <p>{selectedRun.source_name} · Run ID: {selectedRun.id}</p>
          </div>
          <Film size={20}/>
        </div>
        <RunVideo key={selectedRun.id} run={selectedRun} events={data.events}/>
      </section>
    )}

    {/* Connected Machine Operation Log */}
    <EquipmentPanel connected={connected} notify={notify} onUseEquipment={handleUseEquipment}/>

    {/* Activity Ledger */}
    <section className="panel section-gap">
      <div className="panel-heading">
        <div>
          <h2>Activity ledger</h2>
          <p>Each entry maintains its audited mathematical formula, emission factor citation, and basis notes.</p>
        </div>
        <Badge>{data.carbon.length} entries</Badge>
      </div>

      {data.carbon.length?(
        <div className="ledger">
          {data.carbon.map(entry=>(
            <details key={entry.id}>
              <summary>
                <span className="stat-icon green"><Leaf size={18}/></span>
                <span>
                  <strong>{entry.name}</strong>
                  <small>{entry.kind} · {date(entry.created)}</small>
                </span>
                <strong>{number(entry.kg)} kg <small>{entry.kind==='traffic'?'CO₂':'CO₂e'}</small></strong>
              </summary>
              <div>
                <code>{entry.formula}</code>
                <p><strong>Factor citation:</strong> {entry.factor_source}</p>
                <p><strong>Activity basis:</strong> {entry.basis}</p>
                <p><strong>Coverage:</strong> {entry.coverage}</p>
                {entry.run_id&&<a className="text-link" href={`#carbon/${encodeURIComponent(entry.run_id)}`}>Open linked video →</a>}
              </div>
            </details>
          ))}
        </div>
      ):(
        <Empty icon={Leaf} title="No factors. No invented footprint.">
          Use the four sections above to calculate and save your first documented activity estimate.
        </Empty>
      )}
    </section>
  </>;
}

export function Reports({data,connected,notify}:Props) {
  const [runId,setRunId]=useState('');const [busy,setBusy]=useState('');
  async function exportReport(format:string){setBusy(format);try{await download(`/reports/${format}${runId?`?run_id=${encodeURIComponent(runId)}`:''}`,`zenith-report.${format}`);notify('Report downloaded.');}catch(e){notify((e as Error).message);}finally{setBusy('');}}
  return <><Heading eyebrow="AN EVIDENCE TRAIL YOU CAN SHARE" title="Take the full picture with you.">Export saved observations, decisions, vehicle counts and transparent carbon calculations.</Heading><div className="reports-grid"><section className="panel report-config"><div className="panel-heading"><div><h2>Build your report</h2><p>Reports use saved backend records, not dashboard screenshots.</p></div><FileText size={22}/></div><label>Scope<select value={runId} onChange={e=>setRunId(e.target.value)}><option value="">Entire operator workspace</option>{data.runs.map(r=><option key={r.id} value={r.id}>{r.rule.name ? `${r.rule.name} (${r.source_name})` : r.source_name} · {r.id.slice(0,8)}</option>)}</select></label><div className="report-includes">{['Run status and analysis coverage','Suspected events and available evidence','Operator decisions and action notes','Vehicle class counts and activity runtime','Carbon formulas, sources and assumptions','Explicit unavailable-feature disclosures'].map(text=><div key={text}><Check size={17}/>{text}</div>)}</div><div className="action-row"><button className="button primary" disabled={!connected||!!busy} onClick={()=>void exportReport('pdf')}><ArrowDownToLine size={17}/>{busy==='pdf'?'Generating…':'Download PDF'}</button><button className="button secondary" disabled={!connected||!!busy} onClick={()=>void exportReport('csv')}><ArrowDownToLine size={17}/> Export CSV</button></div><p className="small-note">Run-scoped exports include only carbon entries explicitly linked to that run.</p></section><div className="report-preview"><div className="paper"><div className="paper-brand">zenith.</div><span>OPERATIONS / EVIDENCE REPORT</span><h2>Clarity, documented.</h2><p>Safety observations<br/>Activity & carbon estimates</p><div className="paper-line"/><div className="paper-line short"/><div className="paper-metrics"><span><ShieldCheck size={21}/><small>Evidence</small></span><span><Leaf size={21}/><small>Estimates</small></span></div><div className="paper-line"/><div className="paper-line short"/><div className="paper-footer">ILLUSTRATIVE COVER · NOT A GENERATED REPORT</div></div></div></div></>;
}

