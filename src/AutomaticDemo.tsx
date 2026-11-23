import { useEffect, useRef, useState } from 'react';
import { MonitorPlay } from 'lucide-react';
import { connection, json } from './api';
import RunVideo, { carbonLink } from './RunVideo';
import type { Capability, CarbonEstimate, Incident, Point, Run, Source } from './types';
import { suggestedPoints } from './geometry';

const demoSteps: {
  id: string; title: string; capability: Capability; points: Point[]; dwell: number; confidence: number; segmentMetres?: number;
}[] = [
  {id:'people-zone', title:'Safety zone', capability:'zone',
    points:suggestedPoints('zone','people-zone'), dwell:.2, confidence:.15},
  {id:'traffic-counting', title:'Traffic crossings', capability:'traffic',
    points:suggestedPoints('traffic','traffic-counting'), dwell:2, confidence:.25, segmentMetres:50},
  {id:'equipment-activity', title:'Equipment activity', capability:'machine_activity',
    points:suggestedPoints('machine_activity','equipment-activity'), dwell:.4, confidence:.25},
];
const actionSteps = [
  {id:'boxing-training', title:'Boxing training', capability:'action', points:[], dwell:2, confidence:.25},
  {id:'staged-fall', title:'Staged fall', capability:'action', points:[], dwell:2, confidence:.25},
] satisfies typeof demoSteps;
const classFactors: Record<string, number> = {car:180, motorcycle:100, bus:900, truck:650};
const factorSource = 'Illustrative demo factor. Replace with a documented factor for your vehicle, fuel or site.';
type DemoResult = {run: Run; events: Incident[]};
type DemoInput = {
  name: string; kind: 'traffic' | 'electricity' | 'fuel'; quantity: number; factor: number; basis: string;
  run_id?: string; vehicle_class?: string; distance_km?: number; load_fraction?: number;
  metered_kwh?: number; accept_activity_proxy?: boolean;
};

function preview(input: DemoInput, signal: AbortSignal) {
  return json<CarbonEstimate>('/carbon/preview', {
    method:'POST', body:JSON.stringify({...input,factor_source:factorSource}), signal,
  });
}

async function waitForRun(id: string, signal: AbortSignal, onProgress: (run: Run) => void, checkConnection: () => void) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    checkConnection();
    const run = await json<Run>(`/runs/${id}`, {signal});
    onProgress(run);
    if (run.status === 'completed') return run;
    if (run.status === 'failed') throw new Error(run.error || 'Video analysis failed.');
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }
  throw new Error('The worker is taking longer than expected. Check the run in Monitoring studio.');
}

export default function AutomaticDemo({connected, workerOnline, actionReady, refresh}: {
  connected: boolean; workerOnline: boolean; actionReady: boolean; refresh: () => void;
}) {
  const steps: typeof demoSteps = actionReady ? [...demoSteps, ...actionSteps] : demoSteps;
  const active = useRef<AbortController | null>(null);
  const [results,setResults] = useState<DemoResult[]>([]);
  const [estimates,setEstimates] = useState<CarbonEstimate[]>([]);
  const [stage,setStage] = useState<number | null>(null);
  const [processing,setProcessing] = useState<Run | null>(null);
  const [error,setError] = useState('');
  const [finished,setFinished] = useState(false);

  useEffect(() => () => active.current?.abort(), []);

  async function start() {
    if (active.current) return;
    const controller = new AbortController();
    const signal = controller.signal;
    active.current = controller;
    const initial = connection();
    function checkConnection() {
      const current = connection();
      if (current.base !== initial.base || current.key !== initial.key) {
        throw new Error('The backend connection changed. Run the demo again after connecting.');
      }
    }
    setResults([]);
    setEstimates([]);
    setFinished(false);
    setError('');
    try {
      const completed: Run[] = [];
      for (const [index,step] of steps.entries()) {
        checkConnection();
        setStage(index);
        setProcessing(null);
        const source = await json<Source>(`/sources/sample/${step.id}`, {method:'POST', signal});
        const queued = await json<Run>('/runs', {
          method:'POST', signal, body: JSON.stringify({source_id:source.id, rule:{
            capability:step.capability, name:`Demo · ${step.title}`, points:step.points,
            dwell_seconds:step.dwell, confidence:step.confidence, analysis_fps:6,
            motion_threshold:.006, segment_metres:step.segmentMetres ?? null, confirmed:true,
          }}),
        });
        refresh();
        const run = await waitForRun(queued.id,signal,setProcessing,checkConnection);
        checkConnection();
        const events = await json<Incident[]>(`/runs/${run.id}/events`,{signal});
        completed.push(run);
        setResults(previous => [...previous,{run,events}]);
      }
      checkConnection();
      setStage(steps.length);
      const [,traffic,equipment] = completed;
      const trafficClasses = Object.keys(classFactors).filter(name => traffic.counts[name] > 0);
      const roadInputs: DemoInput[] = trafficClasses.map(name => ({
        name:`Road traffic · ${name}`,kind:'traffic',run_id:traffic.id,vehicle_class:name,quantity:0,
        distance_km:.05,factor:classFactors[name],basis:'Completed traversals. The 50 m demo segment is an illustrative assumption.',
      }));
      const inputs: DemoInput[] = [...roadInputs,
        {name:'Conveyor · video runtime estimate',kind:'electricity',run_id:equipment.id,quantity:1.5,
          load_fraction:.6,factor:.7,accept_activity_proxy:true,
          basis:'The clip supplies motion runtime. Power and load are illustrative.'},
        {name:'Conveyor · direct meter example',kind:'electricity',quantity:0,metered_kwh:.25,factor:.7,
          basis:'Illustrative meter reading of 0.25 kWh.'},
        {name:'Generator · fuel example',kind:'fuel',quantity:4,factor:2.7,
          basis:'Illustrative consumption of 4 litres.'},
      ];
      setEstimates(await Promise.all(inputs.map(input => preview(input, signal))));
      setFinished(true);
    } catch (failure) {
      if (!signal.aborted) setError((failure as Error).message);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setStage(null);
        if (!signal.aborted) refresh();
      }
    }
  }

  return <section className="panel automatic-demo" aria-label="Automatic demo">
    <div className="panel-heading">
      <div><h2>Automatic demo</h2><p>Run the example clips and see how traffic counts and equipment activity feed carbon estimates.</p></div>
      <MonitorPlay size={23}/>
    </div>
    <button className="button primary" type="button" disabled={!connected || !workerOnline || stage !== null}
      onClick={() => void start()}>{stage !== null ? 'Running demo…' : finished ? 'Run demo again' : 'Run automatic demo'}</button>
    {(!connected || !workerOnline) && <p className="small-note">Connect a backend with an active worker to run the demo.</p>}
    <p className="small-note">Uses the bundled clips and real analysis. Carbon previews use illustrative inputs, stay outside the ledger, and use no hosted vision credits.</p>
    {!actionReady && <p className="small-note">Upload the checkpoint in <a href="#settings">Settings</a> to include the boxing and fall clips.</p>}
    {stage !== null && <p role="status">{stage < steps.length
      ? "Step " + (stage + 1) + " of " + (steps.length + 1) + " · " + steps[stage].title + (processing ? " · " + processing.progress + "%" : "")
      : "Step " + (steps.length + 1) + " of " + (steps.length + 1) + " · Calculating carbon previews"}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {results.map(({run,events}) => <section key={run.id} className="demo-result">
      <h3>{run.rule.name}</h3>
      {(run.rule.capability === 'zone'||run.rule.capability === 'action') && <p>{events.length} rule observation(s) · <a href="#incidents">Open incident evidence</a></p>}
      {run.rule.capability === 'machine_activity' && <p>{run.activity_seconds?.toFixed(2)} seconds of visible motion</p>}
      <RunVideo run={run} events={events}/>
      {(run.rule.capability === 'traffic'||run.rule.capability === 'machine_activity') && <a className="text-link" href={carbonLink(run)}>Calculate carbon from this run →</a>}
    </section>)}
    {finished && <div className="demo-result">
      <h3>Carbon estimate previews</h3>
      {estimates.map(item => <details className="demo-estimate" key={item.name}>
        <summary><strong>{item.name}</strong> · {new Intl.NumberFormat('en-IN',{maximumFractionDigits:6}).format(item.kg)} kg {item.kind === 'traffic' ? 'CO₂' : 'CO₂e'}</summary>
        <p>{item.formula}</p><p>{item.basis}</p><p>{item.factor_source}</p>
      </details>)}
    </div>}
  </section>;
}
