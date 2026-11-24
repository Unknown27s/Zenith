import { useEffect, useState } from 'react';
import { ArrowUpRight, Leaf } from 'lucide-react';
import { json } from './api';
import type { SavedFactor } from './FactorLibrary';
import type { CarbonEstimate, Run, SavedCamera } from './types';
import { runLink, analysisModes } from './workflow';

type VehicleClass = 'car' | 'motorcycle' | 'bus' | 'truck';
const classes: VehicleClass[] = ['car', 'motorcycle', 'bus', 'truck'];
type ReferenceFactor = SavedFactor & {note: string};

/** Per-camera carbon estimate from completed traffic counts. */
export default function CameraCarbon({camera, runs, connected, notify, refresh}: {
  camera: SavedCamera; runs: Run[]; connected: boolean;
  notify: (message: string) => void; refresh: () => void;
}) {
  const trafficRuns = runs.filter(run => run.status === 'completed' && run.rule.capability === 'traffic');
  const processingTraffic = runs.filter(run => (run.status === 'queued' || run.status === 'processing') && run.rule.capability === 'traffic');
  const savedRule = camera.last_rule;
  const [runId, setRunId] = useState('');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('car');
  const [references, setReferences] = useState<ReferenceFactor[]>([]);
  const [savedFactors, setSavedFactors] = useState<SavedFactor[]>([]);
  const [choice, setChoice] = useState('');
  const [manualFactor, setManualFactor] = useState('');
  const [manualSource, setManualSource] = useState('');
  const [distanceKm, setDistanceKm] = useState('1');
  const [basis, setBasis] = useState('Camera traffic counts. Review false crossings and detector accuracy before relying on this estimate.');
  const [preview, setPreview] = useState<CarbonEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!connected) return;
    let active = true;
    void json<ReferenceFactor[]>('/carbon/presets').then(rows => {
      if (active) setReferences(rows.filter(row => row.kind === 'traffic'));
    }).catch(() => {});
    void json<SavedFactor[]>('/carbon/factors').then(rows => {
      if (active) setSavedFactors(rows.filter(row => row.kind === 'traffic'));
    }).catch(() => {});
    return () => { active = false; };
  }, [connected]);

  const selectedRun = trafficRuns.find(run => run.id === runId) || null;

  useEffect(() => {
    setPreview(null); setError(''); setChoice('');
    if (!selectedRun) return;
    const counts = selectedRun.counts || {};
    const best = classes.reduce((current, name) =>
      (counts[name] || 0) > (counts[current] || 0) ? name : current, 'car' as VehicleClass);
    setVehicleClass(best);
    setDistanceKm(selectedRun.rule.segment_metres ? String(selectedRun.rule.segment_metres / 1000) : '1');
  }, [selectedRun?.id]);

  // A traffic factor is class-specific; never offer a car factor for a bus count.
  const availableReferences = references.filter(row => row.vehicle_class === vehicleClass);
  const availableSavedFactors = savedFactors.filter(row => row.vehicle_class === vehicleClass);
  const reference = availableReferences.find(row => choice === `reference:${row.id}`) || null;
  const saved = availableSavedFactors.find(row => choice === `saved:${row.id}`) || null;
  const factor = reference?.factor ?? saved?.factor ?? (choice === 'manual' ? Number(manualFactor) : 0);
  const factorSource = reference ? `${reference.source} · ${reference.region} · ${reference.year}`
    : saved ? `${saved.source} · ${saved.region} · ${saved.year}` : manualSource;
  const factorId = saved?.id || null;
  const factorReady = Number.isFinite(factor) && factor > 0 && factorSource.trim().length >= 3;
  const rawCount = selectedRun ? Number(selectedRun.counts?.[vehicleClass] || 0) : 0;
  const dismissed = selectedRun ? (selectedRun.crossings || []).filter(crossing =>
    crossing.vehicle_class === vehicleClass &&
    selectedRun.crossing_reviews?.[String(crossing.track_id)]?.action === 'false_positive').length : 0;
  const usedCount = Math.max(0, rawCount - dismissed);

  function estimateBody() {
    if (!selectedRun) throw new Error('Select a completed traffic analysis for this camera.');
    if (!factorReady) throw new Error('Choose a published or saved factor, or enter a manual factor and source.');
    if (!selectedRun.rule.segment_metres && !(Number(distanceKm) > 0)) throw new Error('Enter the segment distance for this run.');
    return JSON.stringify({
      name: `${camera.name} · ${vehicleClass} traffic`.slice(0, 100),
      kind: 'traffic',
      quantity: rawCount,
      factor,
      factor_id: factorId,
      factor_source: factorSource.slice(0, 1000),
      basis,
      hours: 1,
      load_fraction: 1,
      distance_km: selectedRun.rule.segment_metres ? selectedRun.rule.segment_metres / 1000 : Number(distanceKm),
      run_id: selectedRun.id,
      vehicle_class: vehicleClass,
      accept_activity_proxy: false,
    });
  }

  async function submit(save: boolean) {
    setBusy(true); setError('');
    try {
      const result = await json<CarbonEstimate>(save ? '/carbon' : '/carbon/preview', {method: 'POST', body: estimateBody()});
      if (save) {
        setPreview(null);
        refresh();
        notify(`Carbon estimate saved for ${camera.name}.`);
      } else {
        setPreview(result);
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel camera-carbon" id="camera-carbon">
    <div className="panel-heading"><div><h2><Leaf size={18}/> Carbon from this camera</h2>
      <p>Estimate road CO₂ from saved vehicle counts for {camera.name}. Counts belong to one completed clip, not a continuous total.</p></div></div>
    {!trafficRuns.length ? <div className="info-note">
      {!savedRule ? <>
        <strong>No rule is saved for this camera yet.</strong>
        <p>Set <strong>Monitoring type</strong> to <strong>Traffic & CO₂</strong>, save the rule, then start clip analysis. Carbon becomes available when a traffic clip completes.</p>
      </> : savedRule.capability !== 'traffic' ? <>
        <strong>This camera’s saved rule is {analysisModes[savedRule.capability]?.label || savedRule.capability}.</strong>
        <p>Carbon needs vehicle counts. Change <strong>Monitoring type</strong> to <strong>Traffic & CO₂</strong> above, save the rule, then start clip analysis.</p>
      </> : processingTraffic.length ? <>
        <strong>{processingTraffic.length} traffic clip{processingTraffic.length === 1 ? ' is' : 's are'} still processing.</strong>
        <p>Carbon becomes available when a clip completes. <a className="text-link" href="#videos">Open Video findings →</a></p>
      </> : <>
        <strong>The rule is Traffic & CO₂, but no clip has completed yet.</strong>
        <p>Start clip analysis above and wait for the first clip to finish. <a className="text-link" href="#camera-rule">Open the incident rule ↑</a></p>
      </>}
    </div> :
      <form onSubmit={event => {event.preventDefault(); void submit(false);}}>
        <div className="form-grid">
          <label>Completed traffic analysis<select value={runId} onChange={event => setRunId(event.target.value)} required>
            <option value="">Choose a run…</option>
            {trafficRuns.map(run => <option key={run.id} value={run.id}>
              {new Date(run.created * 1000).toLocaleString()} · {run.id.slice(0, 8)} · {Object.values(run.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0)} vehicles
            </option>)}
          </select></label>
          <label>Vehicle class<select value={vehicleClass} onChange={event => {setVehicleClass(event.target.value as VehicleClass); setChoice(''); setPreview(null);}}>
            {classes.map(name => <option key={name} value={name}>{name} ({selectedRun?.counts?.[name] ?? 0})</option>)}
          </select></label>
        </div>
        {selectedRun && <dl className="camera-carbon-counts">
          <div><dt>Raw {vehicleClass} count</dt><dd>{rawCount}</dd></div>
          <div><dt>Operator-reviewed false positives</dt><dd>{dismissed}</dd></div>
          <div><dt>Count used by the server</dt><dd>{usedCount}</dd></div>
          <div><dt>Road segment</dt><dd>{selectedRun.rule.segment_metres ? `${selectedRun.rule.segment_metres} m` : 'Not stored'}</dd></div>
        </dl>}
        {selectedRun && <p className="small-note">Raw counts stay unchanged. The server subtracts operator-reviewed false-positive crossings from this estimate. <a className="text-link" href={runLink(selectedRun)}>Review this run’s crossings <ArrowUpRight size={13}/></a></p>}
        {selectedRun && !selectedRun.rule.segment_metres && <label>Road distance represented by this clip (km)<input type="number" min="0.000001" max="1000000" step="any" value={distanceKm} onChange={event => {setDistanceKm(event.target.value); setPreview(null);}} required/><span className="small-note">Camera counting uses one line, so the distance is not stored in the rule. Enter it here for this estimate.</span></label>}
        {selectedRun && usedCount === 0 && <p className="small-note">This class has no usable counts in the selected run. Choose another class or run before saving.</p>}
        <label>Factor<select value={choice} onChange={event => {setChoice(event.target.value); setPreview(null);}} required>
          <option value="">Choose a factor…</option>
          <optgroup label="Published references (generic)">
            {availableReferences.map(row => <option key={row.id} value={`reference:${row.id}`}>{row.name} · {row.region} {row.year} · {row.factor} g/km</option>)}
          </optgroup>
          {availableSavedFactors.length > 0 && <optgroup label="Saved site factors">
            {availableSavedFactors.map(row => <option key={row.id} value={`saved:${row.id}`}>{row.name} · {row.region} {row.year} · {row.factor} g/km</option>)}
          </optgroup>}
          <option value="manual">Enter factor manually</option>
        </select></label>
        {choice === 'manual' && <div className="form-grid">
          <label>Factor (g CO₂/vehicle-km)<input type="number" min="0.000000001" step="any" value={manualFactor} onChange={event => {setManualFactor(event.target.value); setPreview(null);}} required/></label>
          <label>Factor source & applicability<input value={manualSource} maxLength={1000} onChange={event => {setManualSource(event.target.value); setPreview(null);}} placeholder="Source URL / document, year, region and vehicle class" required/></label>
        </div>}
        <label>Activity basis & assumptions<textarea value={basis} maxLength={1000} onChange={event => {setBasis(event.target.value); setPreview(null);}} required/></label>
        <div className="action-row">
          <button className="button primary" type="submit" disabled={!connected || busy || !selectedRun || !factorReady || usedCount === 0}><Leaf size={16}/>{busy ? 'Calculating…' : 'Preview carbon (not saved)'}</button>
          {preview && <button className="button secondary" type="button" disabled={!connected || busy} onClick={() => void submit(true)}>{busy ? 'Saving…' : 'Save this preview to ledger'}</button>}
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        {preview && <div className="info-note workspace-estimate camera-carbon-preview" role="status" aria-live="polite">
          <span className="badge warning">Preview only — not saved</span>
          <strong>{new Intl.NumberFormat('en-IN', {maximumFractionDigits: 8}).format(preview.kg)} kg CO₂</strong>
          <p>{preview.formula}</p><p>{preview.factor_source}</p><p>{preview.basis}</p>
          <p className="small-note">Saving commits this exact server calculation to the activity ledger.</p>
        </div>}
      </form>}
  </section>;
}
