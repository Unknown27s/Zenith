import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';

// Browser camera example: short, manually started clips. No unattended RTSP ingestion.
export default function CameraCapture({onClip, disabled}: {onClip: (file: File) => void; disabled: boolean}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recording = useRef<{capture: MediaRecorder; save: boolean} | null>(null);
  const timer = useRef<number | null>(null);
  const opening = useRef(0);
  const [mode,setMode] = useState<'off'|'opening'|'preview'|'recording'>('off');
  const [error,setError] = useState('');

  function stop(save = false) {
    opening.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (recording.current) {
      recording.current.save = save;
      if (recording.current.capture.state !== 'inactive') recording.current.capture.stop();
      recording.current = null;
    }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setMode('off');
  }
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    opening.current += 1;
    if (recording.current) {
      recording.current.save = false;
      if (recording.current.capture.state !== 'inactive') recording.current.capture.stop();
      recording.current = null;
    }
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function open() {
    const requestId = ++opening.current;
    setMode('opening');
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' ||
          !MediaRecorder.isTypeSupported('video/webm'))
        throw new Error('Camera recording needs a supported browser on HTTPS or localhost.');
      const camera = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
      if (requestId !== opening.current) {
        camera.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = camera;
      if (video.current) {
        video.current.srcObject = camera;
        await video.current.play();
      }
      if (requestId === opening.current) setMode('preview');
    } catch (failure) {
      if (requestId !== opening.current) return;
      stop();
      setError((failure as Error).message);
    }
  }
  function record() {
    if (!stream.current || recording.current) return;
    const chunks: Blob[] = [];
    let capture: MediaRecorder;
    try { capture = new MediaRecorder(stream.current, {mimeType:'video/webm'}); }
    catch (failure) { stop(); setError((failure as Error).message); return; }
    const session = {capture, save: false};
    capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    capture.onstop = () => {
      const blob = new Blob(chunks, {type:'video/webm'});
      if (session.save && blob.size) onClip(new File([blob], `camera-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`, {type:'video/webm'}));
    };
    capture.onerror = () => { stop(); setError('Camera recording failed. Try another browser or upload a clip.'); };
    recording.current = session;
    try { capture.start(); }
    catch (failure) { stop(); setError((failure as Error).message); return; }
    setMode('recording');
    timer.current = window.setTimeout(() => stop(true), 12_000);
  }
  return <div className="camera-capture">
    <div className="action-row">
      {mode === 'off' ? <button className="button secondary" type="button" disabled={disabled} onClick={() => void open()}><Camera size={16}/> Open camera</button>
        : <><button className="button primary" type="button" disabled={disabled || mode !== 'preview'} onClick={record}>
          {mode === 'opening' ? 'Waiting for camera permission…' : mode === 'recording' ? 'Recording (max 12s)…' : 'Record short clip'}</button>
          <button className="button secondary" type="button" onClick={() => stop(mode === 'recording')}>{mode === 'recording' ? 'Stop & upload' : 'Close camera'}</button></>}
    </div>
    <video ref={video} playsInline muted className={mode === 'off' ? 'camera-hidden' : 'camera-preview'}/>
    {error && <p role="alert" className="error-text">{error}</p>}
    <p className="small-note">Browser camera preview only. Record a short clip, upload it, then confirm a rule to run analysis. This preview does not run live YOLO detection.</p>
  </div>;
}
