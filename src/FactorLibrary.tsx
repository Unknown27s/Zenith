import { useEffect, useState, type FormEvent } from 'react';
import { json } from './api';

export type SavedFactor = {id:string; name:string; kind:string; factor:number; source:string; region:string; year:number; vehicle_class:string|null; preset?:boolean; note?:string};
type ReferenceFactor = Omit<SavedFactor, 'preset'> & {note:string};

export default function FactorLibrary({kind,connected,onSelect,notify,embedded}: {
  kind:string; connected:boolean; onSelect:(item:SavedFactor|null)=>void; notify:(message:string)=>void; embedded?:boolean;
}) {
  const [items,setItems] = useState<SavedFactor[]>([]);
  const [references,setReferences] = useState<ReferenceFactor[]>([]);
  const [busy,setBusy] = useState(false);
  const [selected,setSelected] = useState('');
  const [referenceId,setReferenceId] = useState('');
  const [referenceNote,setReferenceNote] = useState('');
  useEffect(()=>{
    let active=true;
    if (connected) {
      void json<SavedFactor[]>('/carbon/factors').then(rows=>{if(active)setItems(rows);}).catch(()=>{});
      void json<ReferenceFactor[]>('/carbon/presets').then(rows=>{if(active)setReferences(rows);}).catch(()=>{});
    }
    return ()=>{active=false;};
  },[connected]);
  useEffect(()=>{setSelected('');setReferenceId('');setReferenceNote('');onSelect(null);},[kind]);
  async function add(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target=event.currentTarget;
    setBusy(true);
    try {
      const form = new FormData(target);
      const factor = await json<SavedFactor>('/carbon/factors',{method:'POST',body:JSON.stringify({
        name:form.get('name'),kind,source:form.get('source'),region:form.get('region'),
        year:Number(form.get('year')),factor:Number(form.get('factor')),
        vehicle_class:kind==='traffic'?form.get('vehicle_class'):null,
      })});
      setItems(previous=>[factor,...previous]);
      setSelected(factor.id);
      setReferenceId('');
      setReferenceNote('');
      onSelect(factor);
      target.reset();
      notify('Factor saved with source, region, year and applicable class.');
    } catch(error) {notify((error as Error).message);}
    finally {setBusy(false);}
  }
  const available = items.filter(item=>item.kind===kind);
  const availableReferences = references.filter(item=>item.kind===kind);
  function chooseReference(id:string) {
    setReferenceId(id);
    setSelected('');
    const item = availableReferences.find(entry=>entry.id===id)||null;
    setReferenceNote(item?.note||'');
    onSelect(item?{...item,preset:true}:null);
  }
  const content = (
    <>
      <div className="form-grid">
        {availableReferences.length>0&&<label>Standard reference preset (published)
          <select value={referenceId} onChange={e=>chooseReference(e.target.value)}>
            <option value="">Choose a published reference…</option>
            {availableReferences.map(item=><option key={item.id} value={item.id}>{item.name} · {item.region} {item.year} · {item.factor} ({kind==='traffic'?'g CO₂/v-km':kind==='fuel'?'kg CO₂e/L':'kg CO₂e/kWh'})</option>)}
          </select>
        </label>}
        <label>Saved site factor from library
          <select value={selected} onChange={e=>{
            setSelected(e.target.value);setReferenceId('');setReferenceNote('');
            onSelect(items.find(item=>item.id===e.target.value)||null);
          }}>
            <option value="">{referenceId ? 'Using reference preset' : 'Custom / enter factor manually'}</option>
            {available.map(item=><option key={item.id} value={item.id}>{item.name} · {item.region} {item.year}{item.vehicle_class?` · ${item.vehicle_class}`:''} · {item.factor}</option>)}
          </select>
        </label>
      </div>
      {referenceNote&&<p className="small-note" style={{margin:'6px 0 0'}}>ℹ️ {referenceNote} Verify this national/regional source matches your facility boundary.</p>}
      <details style={{marginTop: '10px'}}><summary>+ Register new custom factor to library</summary><form onSubmit={event=>void add(event)} style={{marginTop: '12px'}}>
        <label>Factor name<input name="name" required minLength={2} maxLength={100} placeholder="Grid electricity / diesel / passenger car"/></label>
        <div className="form-grid"><label>Region or facility<input name="region" required minLength={2} maxLength={100} placeholder="e.g. Tamil Nadu, India"/></label>
          <label>Publication year<input name="year" type="number" required min="1900" max="2100" defaultValue={new Date().getFullYear()}/></label></div>
        {kind==='traffic'&&<label>Vehicle class<select name="vehicle_class">{['car','motorcycle','bus','truck'].map(name=><option key={name} value={name}>{name}</option>)}</select></label>}
        <label>Emission factor ({kind==='traffic'?'g CO₂/vehicle-km':kind==='fuel'?'kg CO₂e/litre':'kg CO₂e/kWh'})<input name="factor" required type="number" step="any" min="0.000000001"/></label>
        <label>Original source citation or URL<input name="source" required minLength={3} maxLength={1000} placeholder="e.g. CEA Baseline 2023 or Utility Tariff Schedule"/></label>
        <button className="button secondary" disabled={!connected||busy} type="submit">{busy?'Saving…':'Save factor to library'}</button>
      </form></details>
    </>
  );

  if (embedded) {
    return <div className="factor-library-embedded">{content}</div>;
  }

  return <section className="panel section-gap factor-library">
    <div className="panel-heading">
      <div>
        <h2>Emission factors</h2>
        <p>Pick a published reference value or use a site-specific factor. Reference values are generic: selecting one fills and locks the factor and source fields so the published value is not altered. Choose “Enter factor manually” to enter your own.</p>
      </div>
    </div>
    {content}
  </section>;
}
