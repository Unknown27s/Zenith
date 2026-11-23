import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';

// Browser camera example: short, manually started clips. No unattended RTSP ingestion.
export default function CameraCapture({onClip, disabled}: {onClip: (file: File) => void; disabled: boolean}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const saveOnStop = useRef(false);
  const [mode,setMode] = useState<'off'|'preview'|'recording'>('off');
  const [error,setError] = useState('');

  function stop(save = false) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    saveOnStop.current = save;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setMode('off');
  }
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    saveOnStop.current = false;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function open() {
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' ||
          !MediaRecorder.isTypeSupported('video/webm'))
        throw new Error('Camera recording needs a supported browser on HTTPS or localhost.');
      const camera = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
      stream.current = camera;
      if (video.current) {
        video.current.srcObject = camera;
        await video.current.play();
      }
      setMode('preview');
    } catch (failure) {
      stop();
      setError((failure as Error).message);
    }
  }
  function record() {
    if (!stream.current) return;
    const chunks: Blob[] = [];
    const capture = new MediaRecorder(stream.current, {mimeType:'video/webm'});
    capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    capture.onstop = () => {
      const blob = new Blob(chunks, {type:'video/webm'});
      if (saveOnStop.current && blob.size) onClip(new File([blob], `camera-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`, {type:'video/webm'}));
    };
    recorder.current = capture;
    capture.start();
    setMode('recording');
    timer.current = window.setTimeout(() => stop(true), 12_000);
  }
  return <div className="camera-capture">
    <div className="action-row">
      {mode === 'off' ? <button className="button secondary" type="button" disabled={disabled} onClick={() => void open()}><Camera size={16}/> Open camera</button>
        : <><button className="button primary" type="button" disabled={disabled || mode === 'recording'} onClick={record}>
          {mode === 'recording' ? 'Recording (max 12s)…' : 'Record short clip'}</button>
          <button className="button secondary" type="button" onClick={() => stop(mode === 'recording')}>{mode === 'recording' ? 'Stop & upload' : 'Close camera'}</button></>}
    </div>
    <video ref={video} playsInline muted className={mode === 'off' ? 'camera-hidden' : 'camera-preview'}/>
    {error && <p role="alert" className="error-text">{error}</p>}
    <p className="small-note">Local camera preview only; a recording is uploaded when stopped. No continuous stream, remote CCTV connector, or automatic actions.</p>
  </div>;
}
