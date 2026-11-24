import { useEffect, useState, type FormEvent } from 'react';
import { Clock3, Plus, Power, Settings2, Zap } from 'lucide-react';
import { json } from './api';

interface Equipment {
  id: string;
  name: string;
  state: 'on' | 'off' | 'unknown';
  state_since: number;
  logged_on_seconds: number;
  history: { from: string; to: string; at: number; note: string }[];
}

export default function EquipmentPanel({
  connected,
  notify,
  onUseEquipment,
}: {
  connected: boolean;
  notify: (message: string) => void;
  onUseEquipment?: (name: string, hours: number) => void;
}) {
  const [items, setItems] = useState<Equipment[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [state, setState] = useState('unknown');
  const [note, setNote] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: number;
    const controller = new AbortController();
    const load = async () => {
      if (!connected) { setItems([]); return; }
      try {
        const rows = await json<Equipment[]>('/equipment', {signal: controller.signal});
        if (active) setItems(rows);
      } catch { /* The main application connection banner handles connectivity. */ }
      if (active) timer = window.setTimeout(load, 5000);
    };
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [connected, revision]);

  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await json('/equipment', {method: 'POST', body: JSON.stringify({name})});
      setName(''); setRevision(x => x + 1); notify('Equipment registered with unknown state. No operation is assumed.');
    } catch (error) { notify((error as Error).message); }
    finally { setBusy(false); }
  }
  async function transition(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await json(`/equipment/${selected}/state`, {method: 'POST', body: JSON.stringify({state, note})});
      setSelected(''); setNote(''); setRevision(x => x + 1); notify('Operator-declared state recorded. This is not a CCTV or meter reading.');
    } catch (error) { notify((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel section-gap equipment-panel">
    <div className="panel-heading"><div><h2><Power size={17}/> Machine operation log</h2><p>Record ON / OFF / UNKNOWN from an operator’s observation. Not automatic on/off detection.</p></div><span className="badge">OPERATOR-DECLARED</span></div>
    <form className="equipment-add" onSubmit={add}><label>Register equipment<input value={name} onChange={e => setName(e.target.value)} maxLength={100} required placeholder="e.g. Compressor, kiln fan, generator…"/></label><button className="button secondary" disabled={!connected || busy || !name.trim()}><Plus size={16}/> Add equipment</button></form>
    {items.length ? <div className="equipment-grid">{items.map(item => <article className="equipment-card" key={item.id}>
      <div><span className="stat-icon mint"><Settings2 size={19}/></span><span className={`badge ${item.state === 'on' ? 'success' : 'neutral'}`}>{item.state.toUpperCase()}</span></div>
      <h3>{item.name}</h3><p>Declared {new Date(item.state_since * 1000).toLocaleString()}</p>
      <div className="equipment-runtime"><Clock3 size={15}/><strong>{(item.logged_on_seconds / 3600).toFixed(4)} h</strong> logged ON time</div>
      <p>Unknown periods are excluded. Use documented logged hours in the electricity calculator; power, load and a sourced factor are still required.</p>
      {onUseEquipment && item.logged_on_seconds > 0 && (
        <button
          type="button"
          className="button secondary full equipment-use-btn"
          style={{marginBottom: '8px', borderColor: '#b5d9b8', color: '#1f5933', fontWeight: 600}}
          onClick={() => onUseEquipment(item.name, Number((item.logged_on_seconds / 3600).toFixed(4)))}
          title="Send this machine runtime to the Carbon Calculator"
        >
          <Zap size={14}/> Use {(item.logged_on_seconds / 3600).toFixed(2)}h in Carbon Calc
        </button>
      )}
      <button className="button secondary full" disabled={!connected || busy} onClick={() => {setSelected(item.id); setState(item.state); setNote('');}}>Record state</button>
      {!!item.history.length && <details><summary>View transition history ({item.history.length})</summary>{[...item.history].reverse().map(h => <p key={`${h.at}-${h.to}`}><strong>{h.from} → {h.to}</strong> · {new Date(h.at * 1000).toLocaleString()}<br/>{h.note}</p>)}</details>}
    </article>)}</div> : <div className="inline-empty">No machines registered. All new assets begin with UNKNOWN state—not an assumed OFF state.</div>}
    {selected && <form onSubmit={transition} className="equipment-transition"><h3>Record an operator observation</h3><div className="form-grid"><label>Declared state<select value={state} onChange={e => setState(e.target.value)}><option value="on">ON</option><option value="off">OFF</option><option value="unknown">UNKNOWN / unable to verify</option></select></label><label>Observation basis<input value={note} onChange={e => setNote(e.target.value)} minLength={3} maxLength={500} required placeholder="e.g. Operator checked the control panel"/></label></div><p>Effective now, in server UTC. ON time accrues until the next declaration. Record UNKNOWN when monitoring stops; stale declarations can overstate runtime.</p><div className="action-row"><button className="button primary" disabled={busy}>Save declaration</button><button className="button secondary" type="button" onClick={() => setSelected('')}>Cancel</button></div></form>}
  </section>;
}
