import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { json, request } from './api';
import type { SavedCamera } from './types';

export default function AnnotatedPreview({camera, connected, refresh, notify}: {
  camera: SavedCamera; connected: boolean; refresh: () => void; notify: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(camera.live.active);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frame, setFrame] = useState('');
  const [fresh, setFresh] = useState<number | null>(null);
  const [error, setError] = useState('');
  const imageUrl = useRef('');
  const endpoint = `/cameras/${camera.id}/live`;
  useEffect(() => {
    setEnabled(camera.live.active);
  }, [camera.live.active]);
  useEffect(() => {
    if (!enabled || !connected) return;
    const controller = new AbortController();
    let timer: number;
    async function load() {
      try {
        const response = await request(`${endpoint}/frame`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const old = imageUrl.current;
        imageUrl.current = url;
        const capturedAt = Number(response.headers.get('X-Captured-At'));
        setFrame(url); setFresh(capturedAt > 0 ? capturedAt*1000 : Date.now()); setError('');
        if (old) URL.revokeObjectURL(old);
      } catch (failure) {
        if (!controller.signal.aborted) {
          const msg = (failure as Error).message;
          // While the connector is resolving the stream and YOLO is warming up, 503 is expected startup buffering.
          if ((msg.includes('No fresh annotated frame') || msg.includes('503')) && !fresh) {
            setError('');
          } else {
            setError(msg);
          }
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(load, 500);
    }
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [enabled, connected, endpoint]);
  useEffect(() => () => { if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); }, []);

  async function control(start: boolean) {
    setBusy(true); setError('');
    try {
      await json(`${endpoint}/${start ? 'start' : 'stop'}`, {method: 'POST'});
      setEnabled(start);
      if (start) { setFrame(''); setFresh(null); }
      refresh();
    } catch (failure) { notify((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel annotated-preview">
    <div className="panel-heading"><div><h2>Live YOLO detection preview</h2>
      <p>Actual boxes on the same decoded frames—not an overlay on a separate YouTube player.</p></div>
      <span className="badge">{enabled ? camera.live.state : 'Preview stopped'}</span></div>
    <div className="annotated-stage">
      {frame ? <img src={frame} alt={`YOLO detections from ${camera.name}`}/> : <p>{enabled ? 'Connecting to stream and loading YOLO…' : 'Start the preview to see people and vehicle detections.'}</p>}
      <span>{!connected || error ? 'STALE / UNAVAILABLE' : enabled ? (fresh ? 'SAMPLED DETECTION PREVIEW · ≤2 FPS' : 'CONNECTING · BUFFERING FRAMES') : 'STOPPED · LAST FRAME ONLY'}</span>
    </div>
    <div className="annotated-controls">
      <label className="checkbox"><input type="checkbox" checked={permission} onChange={event => setPermission(event.target.checked)}/>
        I have permission to process this livestream.</label>
      <div className="action-row">
        <button className="button primary" disabled={!connected || busy || enabled || !permission} onClick={() => void control(true)}><Play size={15}/> Start YOLO preview</button>
        <button className="button secondary" disabled={!connected || busy || !enabled} onClick={() => void control(false)}><Square size={15}/> Stop YOLO preview</button>
      </div>
      <p role="status">{error || (fresh ? `Frame decoded by connector at ${new Date(fresh).toLocaleTimeString()}.` : enabled ? 'Connecting to stream and loading YOLO…' : 'No annotated frames received yet.')}
        {camera.live.detections !== undefined ? ` Latest frame: ${camera.live.detections} detected object(s).` : ''}</p>
      <p>Sampled preview, not full-frame-rate CCTV. {camera.live.model ? `Detector: ${camera.live.model}. ` : ''}
        Preview uses confidence 0.30 and 416-pixel inference; incident-rule settings are independent.
        YouTube adds delay; inference speed depends on hardware.
        Boxes are person/vehicle detections—not confirmed incidents. To produce evidence and Telegram alerts,
        start the separate confirmed rule below. At most two previews run at once; previews stop after 90 seconds without frame requests.</p>
    </div>
  </section>;
}
