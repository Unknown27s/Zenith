import { useEffect, useState, type FormEvent } from 'react';
import { json } from './api';

export type SavedFactor = {id:string; name:string; kind:string; factor:number; source:string; region:string; year:number; vehicle_class:string|null};

export default function FactorLibrary({kind,connected,onSelect,notify}: {
  kind:string; connected:boolean; onSelect:(item:SavedFactor|null)=>void; notify:(message:string)=>void;
}) {
  const [items,setItems] = useState<SavedFactor[]>([]);
  const [busy,setBusy] = useState(false);
  const [selected,setSelected] = useState('');
  useEffect(()=>{
    let active=true;
    if (connected) void json<SavedFactor[]>('/carbon/factors').then(rows=>{if(active)setItems(rows);}).catch(()=>{});
    return ()=>{active=false;};
  },[connected]);
  useEffect(()=>{setSelected('');onSelect(null);},[kind]);
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
      onSelect(factor);
      target.reset();
      notify('Factor saved with source, region, year and applicable class.');
    } catch(error) {notify((error as Error).message);}
    finally {setBusy(false);}
  }
  const available = items.filter(item=>item.kind===kind);
  return <section className="panel section-gap factor-library"><div className="panel-heading"><div><h2>Saved site factors</h2>
    <p>Use a factor appropriate to this activity. No default numeric emissions factor is supplied.</p></div></div>
    <label>Select a saved factor<select value={selected} onChange={e=>{
      setSelected(e.target.value);onSelect(items.find(item=>item.id===e.target.value)||null);
    }}><option value="">Enter factor manually</option>{available.map(item=><option key={item.id} value={item.id}>{item.name} · {item.region} {item.year}{item.vehicle_class?` · ${item.vehicle_class}`:''} · {item.factor}</option>)}</select></label>
    <details><summary>Add a sourced factor for {kind}</summary><form onSubmit={event=>void add(event)}>
      <label>Name<input name="name" required minLength={2} maxLength={100} placeholder="Grid electricity / diesel / passenger car"/></label>
      <div className="form-grid"><label>Region or site<input name="region" required minLength={2} maxLength={100}/></label>
        <label>Publication year<input name="year" type="number" required min="1900" max="2100"/></label></div>
      {kind==='traffic'&&<label>Vehicle class<select name="vehicle_class">{['car','motorcycle','bus','truck'].map(name=><option key={name} value={name}>{name}</option>)}</select></label>}
      <label>Factor ({kind==='traffic'?'g CO₂/vehicle-km':kind==='fuel'?'kg CO₂e/litre':'kg CO₂e/kWh'})<input name="factor" required type="number" step="any" min="0.000000001"/></label>
      <label>Original source (URL or document citation)<input name="source" required minLength={3} maxLength={1000}/></label>
      <button className="button secondary" disabled={!connected||busy} type="submit">Save factor</button>
    </form></details>
  </section>;
}
