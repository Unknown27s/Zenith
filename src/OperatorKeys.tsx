import { useEffect, useState } from 'react';
import { connection, json } from './api';

type Operator = {id: string; label: string; enabled: boolean; created: number};

export default function OperatorKeys({notify}: {notify: (message: string) => void}) {
  const [operators,setOperators] = useState<Operator[]>([]);
  const [label,setLabel] = useState('');
  const [createdKey,setCreatedKey] = useState('');
  const [busy,setBusy] = useState(false);
  const adminKey = connection().key;
  async function refresh() {
    try { setOperators(await json<Operator[]>('/operators')); }
    catch(error) { notify((error as Error).message); }
  }
  useEffect(() => { if (adminKey) void refresh(); }, [adminKey]);
  async function create() {
    setBusy(true);
    try {
      const result = await json<{key:string}>('/operators', {method:'POST', body:JSON.stringify({label})});
      setCreatedKey(result.key);
      setLabel('');
      await refresh();
    } catch(error) { notify((error as Error).message); }
    finally {setBusy(false);}
  }
  async function revoke(id:string) {
    if (!window.confirm('Revoke this operator key? Existing records remain but the operator cannot log in.')) return;
    setBusy(true);
    try { await json(`/operators/${id}/revoke`, {method:'POST'}); await refresh(); }
    catch(error) {notify((error as Error).message);}
    finally {setBusy(false);}
  }
  if (!adminKey) return <section className="panel section-gap"><div className="panel-heading">
    <div><h2>Local operator access</h2><p>Enter your administrator key above and click Verify & connect before managing separate operator workspaces.</p></div>
  </div></section>;
  return <section className="panel section-gap"><div className="panel-heading"><div><h2>Local operator access</h2>
    <p>Administrator-only. Enter your administrator key in Settings before creating keys. Each operator receives a private workspace. Creating the first key disables automatic local sessions; keep your administrator key safe. This is not public multi-tenant hosting.</p>
  </div></div><div className="operator-keys">
    <label>Operator name<input maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Name for this laptop user"/></label>
    <button className="button secondary" type="button" disabled={busy||label.trim().length<2} onClick={()=>void create()}>Create private key</button>
    {createdKey&&<div className="warning-note"><p>Copy this key now. It will not be displayed again. Enter it in Connection & settings for that operator. Do not share it publicly.</p>
      <code className="operator-secret">{createdKey}</code><button className="text-button" type="button" onClick={()=>setCreatedKey('')}>Hide key</button></div>}
    {operators.map(row=><p key={row.id}><strong>{row.label}</strong> · {row.enabled?'Active':'Revoked'} · {new Date(row.created*1000).toLocaleString()}
      {row.enabled&&<button className="text-button" disabled={busy} type="button" onClick={()=>void revoke(row.id)}>Revoke</button>}</p>)}
  </div></section>;
}
