export function connection() {
  return { base: (sessionStorage.getItem('zenith.base') ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''), key: sessionStorage.getItem('zenith.key') || '' };
}

let localSessionUntil = 0;
export async function ensureLocalSession(signal?: AbortSignal) {
  const {base, key} = connection();
  if (base || key || Date.now() < localSessionUntil) return;
  const response = await fetch('/api/local-session', {method:'POST', credentials:'same-origin', signal:signal || AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(response.status === 404 || response.status === 405
    ? 'An older backend is running. Restart it with python start.py --local.'
    : 'Local session is unavailable. Use the operator key in Connection Settings, or start the laptop app with python start.py --local.');
  localSessionUntil = Date.now() + 7*3600*1000;
}

export async function request(path: string, init: RequestInit = {}) {
  const { base, key } = connection();
  const headers = new Headers(init.headers);
  if (key) headers.set('Authorization', `Bearer ${key}`);
  headers.set('ngrok-skip-browser-warning', 'zenith');
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${base}/api${path}`, { ...init, headers, signal: init.signal || AbortSignal.timeout(120000) });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const error = await response.json();
      message = typeof error.detail === 'string' ? error.detail : error.detail?.map((x: {msg: string}) => x.msg).join('; ') || message;
    } catch { /* A proxy can return a non-JSON error page. */ }
    throw new Error(message);
  }
  return response;
}

export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json();
}

export async function download(path: string, name: string) {
  const blob = await (await request(path)).blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
