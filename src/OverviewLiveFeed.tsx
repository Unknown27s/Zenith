import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronRight, ExternalLink, Play, Radio, RefreshCw, Square, Video } from 'lucide-react';
import { json, request } from './api';
import type { SavedCamera } from './types';

export default function OverviewLiveFeed({
  connected,
  notify,
  refresh: appRefresh,
}: {
  connected: boolean;
  notify: (msg: string) => void;
  refresh: () => void;
}) {
  const [cameras, setCameras] = useState<SavedCamera[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [frame, setFrame] = useState('');
  const [fresh, setFresh] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState(true);
  const imageUrl = useRef('');
  const activeController = useRef<AbortController | null>(null);

  // 1. Load saved cameras
  useEffect(() => {
    if (!connected) {
      setCameras([]);
      setSelectedId('');
      return;
    }
    const controller = new AbortController();
    async function loadCameras() {
      try {
        const rows = await json<SavedCamera[]>('/cameras', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setCameras(rows);
        if (rows.length > 0 && (!selectedId || !rows.some(c => c.id === selectedId))) {
          setSelectedId(rows[0].id);
          setEnabled(rows[0].live.active);
        }
      } catch {
        /* Handled gracefully */
      }
    }
    void loadCameras();
    return () => controller.abort();
  }, [connected]);

  const selectedCamera = cameras.find(c => c.id === selectedId);

  // Sync enabled state when selected camera changes
  useEffect(() => {
    if (selectedCamera) {
      setEnabled(selectedCamera.live.active);
      setFrame('');
      setFresh(null);
      setError('');
    }
  }, [selectedCamera?.id]);

  // If not enabled and camera has no frame yet, load a single snapshot as cover
  useEffect(() => {
    if (!connected || !selectedCamera || enabled || frame) return;
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    async function loadSnapshot() {
      try {
        const response = await request(`/cameras/${selectedCamera!.id}/preview`, {
          signal: controller.signal,
        });
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
        imageUrl.current = url;
        setFrame(url);
      } catch {
        /* Ignore snapshot error */
      }
    }
    void loadSnapshot();
    return () => controller.abort();
  }, [selectedCamera?.id, enabled, connected]);

  // Frame polling when live stream is enabled
  useEffect(() => {
    if (!enabled || !connected || !selectedCamera) return;
    const controller = new AbortController();
    let timer: number;
    const endpoint = `/cameras/${selectedCamera.id}/live`;

    async function pollFrame() {
      try {
        const response = await request(`${endpoint}/frame`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const old = imageUrl.current;
        imageUrl.current = url;
        const capturedAt = Number(response.headers.get('X-Captured-At'));
        setFrame(url);
        setFresh(capturedAt > 0 ? capturedAt * 1000 : Date.now());
        setError('');
        if (old) URL.revokeObjectURL(old);
      } catch (failure) {
        if (!controller.signal.aborted) {
          const msg = (failure as Error).message;
          if ((msg.includes('No fresh annotated frame') || msg.includes('503')) && !fresh) {
            setError('');
          } else {
            setError(msg);
          }
        }
      }
      if (!controller.signal.aborted) {
        timer = window.setTimeout(pollFrame, 500);
      }
    }

    void pollFrame();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, connected, selectedCamera?.id]);

  useEffect(() => () => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
  }, []);

  async function toggleLive(start: boolean) {
    if (!selectedCamera) return;
    setBusy(true);
    setError('');
    const endpoint = `/cameras/${selectedCamera.id}/live`;
    try {
      await json(`${endpoint}/${start ? 'start' : 'stop'}`, { method: 'POST' });
      setEnabled(start);
      if (start) {
        setFresh(null);
      }
      appRefresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel live-overview-panel">
      <div className="panel-heading">
        <div className="live-feed-title">
          <span className={`live-feed-pulse ${enabled && fresh ? 'on' : ''}`} aria-hidden="true" />
          <div>
            <h2>Live camera monitoring</h2>
            <p>Direct view of active camera streams and real-time YOLO object detections.</p>
          </div>
        </div>
        <div className="live-feed-header-actions">
          {cameras.length > 1 && (
            <label className="live-camera-select">
              <span className="sr-only">Switch camera</span>
              <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                {cameras.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedCamera && (
            <a className="button secondary text-button" href={`#cameras/${selectedCamera.id}`}>
              Full camera workspace <ChevronRight size={14} />
            </a>
          )}
        </div>
      </div>

      {selectedCamera ? (
        <div className="overview-video-container">
          <div className="overview-video-viewport">
            {frame ? (
              <img src={frame} alt={`Live feed from ${selectedCamera.name}`} className="overview-video-frame" />
            ) : (
              <div className="overview-video-placeholder">
                <Video size={48} />
                <p>
                  {enabled
                    ? 'Connecting to stream and buffering YOLO inference…'
                    : 'Click "Start live feed" below to begin live detection stream.'}
                </p>
              </div>
            )}

            {/* Overlaid badges */}
            <div className="overview-overlay-top">
              <span className="overview-cam-name">
                <Camera size={13} /> {selectedCamera.name}
              </span>
              <span className={`overview-status-tag ${enabled && fresh ? 'live' : ''}`}>
                {enabled
                  ? fresh
                    ? '● LIVE · ≤2 FPS'
                    : 'CONNECTING…'
                  : 'STANDBY'}
              </span>
            </div>

            {selectedCamera.live.detections !== undefined && enabled && fresh && (
              <div className="overview-overlay-bottom">
                <span>
                  {selectedCamera.live.detections} object{selectedCamera.live.detections === 1 ? '' : 's'} in frame
                </span>
              </div>
            )}
          </div>

          <div className="overview-video-bar">
            <div className="overview-video-actions">
              <button
                className={`button ${enabled ? 'secondary' : 'primary'}`}
                disabled={!connected || busy}
                onClick={() => void toggleLive(!enabled)}
              >
                {busy ? (
                  <RefreshCw size={15} className="spin" />
                ) : enabled ? (
                  <Square size={15} />
                ) : (
                  <Play size={15} />
                )}
                {busy ? 'Processing…' : enabled ? 'Pause stream' : 'Start live feed'}
              </button>

              <span className="overview-feed-meta">
                {error
                  ? error
                  : fresh
                  ? `Decoded at ${new Date(fresh).toLocaleTimeString()}`
                  : enabled
                  ? 'Initializing stream & neural network…'
                  : 'Stream in standby'}
              </span>
            </div>

            <div className="overview-video-side-links">
              <a className="text-link" href="#cameras">
                All cameras ({cameras.length})
              </a>
              <a className="text-link" href={`#cameras/${selectedCamera.id}`}>
                Configure rules & Telegram alerts →
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="overview-video-empty">
          <div className="overview-empty-art">
            <Radio size={36} />
          </div>
          <div>
            <h3>No camera feeds connected</h3>
            <p>
              Add a YouTube livestream URL to watch live detections and monitor activity directly from this overview.
            </p>
          </div>
          <a className="button primary" href="#cameras">
            <Camera size={16} /> Add camera stream
          </a>
        </div>
      )}
    </section>
  );
}
