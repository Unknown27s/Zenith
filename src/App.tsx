import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Cpu,
  FileText,
  Film,
  Leaf,
  LoaderCircle,
  Menu,
  MonitorPlay,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { connection, ensureLocalSession, json } from './api';
import type { CarbonEntry, Data, Incident, Page, Run, Source } from './types';
import DemoLibrary from './DemoLibrary';
import VideoFindings from './VideoFindings';
import CamerasPage from './CamerasPage';
import OperatorKeys from './OperatorKeys';
import HealthPanel from './HealthPanel';
import DemoSetup from './DemoSetup';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { Carbon, Incidents, Overview, Reports, Studio } from './features/workspace/Pages';

const titles: Record<Page, string> = {
  overview: 'Workspace overview',
  studio: 'Monitoring studio',
  cameras: 'Cameras & live streams',
  videos: 'Video findings',
  demos: 'Demo footage library',
  incidents: 'Incidents & evidence',
  carbon: 'Carbon & energy',
  reports: 'Reports',
  how: 'How Zenith works',
  settings: 'Health & settings',
};

const empty: Data = { status: null, sources: [], runs: [], events: [], carbon: [], notifications: [] };

function routePage(route: string): Page {
  const [page] = route.split('/');
  return Object.hasOwn(titles, page) ? (page as Page) : 'overview';
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Heading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}

interface Props {
  data: Data;
  connected: boolean;
  notify: (message: string) => void;
  refresh: () => void;
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1));
  const page = routePage(route);
  const [, selectedId = '', selectedAnalysisId = ''] = route.split('/');
  const [data, setData] = useState<Data>(empty);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const workspaceConnection = useRef(connection());
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  const notify = useCallback((message: string) => setNotice(message), []);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);

  const navigate = useCallback((targetPage: Page) => {
    window.location.hash = `#${targetPage}`;
  }, []);

  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash.slice(1));
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  useEffect(() => {
    document.title = `${titles[page] || 'Workspace'} · Zenith`;
  }, [page]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 6500);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const current = connection();
    if (current.base !== workspaceConnection.current.base || current.key !== workspaceConnection.current.key) {
      workspaceConnection.current = current;
      setData(empty);
      setConnected(false);
      setConnecting(true);
    }
    let active = true;
    let timer: number;
    const controller = new AbortController();
    const load = async () => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
        if (!connection().base) await ensureLocalSession(signal);
        if (connection().base && !connection().key)
          throw new Error('Enter the operator key in Connection Settings for this remote backend.');
        const [status, sources, runs, events, carbon, notifications] = await Promise.all([
          json<Data['status']>('/status', { signal }),
          json<Source[]>('/sources', { signal }),
          json<Run[]>('/runs', { signal }),
          json<Incident[]>('/events', { signal }),
          json<CarbonEntry[]>('/carbon', { signal }),
          json<Data['notifications']>('/notifications', { signal }),
        ]);
        if (active) {
          setData({ status, sources, runs, events, carbon, notifications });
          setConnected(true);
          setConnecting(false);
          setFailure('');
        }
      } catch (error) {
        if (active) {
          setConnected(false);
          setConnecting(false);
          setFailure((error as Error).message);
        }
      }
      if (active) timer = window.setTimeout(load, 4000);
    };
    void load();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [revision]);

  const props: Props = { data, connected, notify, refresh };

  const unackCount = data.events.filter((e) => e.operator_status !== 'acknowledged').length;

  return (
    <DashboardLayout
      currentPage={page}
      onNavigate={navigate}
      connected={connected}
      unacknowledgedIncidentsCount={unackCount}
      isAdmin={!!data.status?.is_admin}
      workerOnline={!!data.status?.worker_online}
    >
      {!connected && page !== 'settings' && (
        <div className="bg-warning-container border border-warning text-on-warning-container rounded-md p-gutter-md flex items-center justify-between gap-gutter-md" role="status">
          <div className="flex items-center gap-gutter-sm">
            <Radio size={16} />
            <span className="font-body text-body-sm">
              {connecting ? 'Connecting to the workspace…' : failure || 'Backend connection inactive.'}
            </span>
          </div>
          {!connecting && (
            <button
              type="button"
              onClick={() => navigate('settings')}
              className="inline-flex items-center gap-gutter-xs font-label text-label-md text-on-warning-container hover:underline cursor-pointer"
            >
              <span>Connection settings</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}

      {page === 'overview' && <Overview {...props} />}

      {page === 'studio' && <Studio key={selectedId} {...props} selectedSourceId={selectedId} />}

      {page === 'incidents' && <Incidents key={selectedId} {...props} selectedId={selectedId} />}

      {page === 'reports' && <Reports {...props} />}

      {page === 'cameras' && <CamerasPage {...props} selectedId={selectedId} />}

      {page === 'videos' && (
        <VideoFindings
          data={data}
          connected={connected}
          refresh={refresh}
          notify={notify}
          selectedSourceId={selectedId}
          selectedRunId={selectedAnalysisId}
        />
      )}

      {page === 'demos' && <DemoLibrary
        actionReady={!!data.status?.models?.action.checkpoint_present}
        connected={connected}
        workerOnline={!!data.status?.worker_online}
        notify={notify}
        refresh={refresh}
      />}

      {page === 'carbon' && <Carbon {...props} requestedRunId={selectedId} />}

      {page === 'how' && <HowItWorks />}

      {page === 'settings' && <Settings {...props} />}

      {notice && (
        <div
          className="fixed bottom-6 right-6 z-50 bg-primary text-on-primary px-gutter-lg py-gutter-md rounded-lg shadow-lg flex items-center gap-gutter-md font-body text-body-sm"
          role="status"
        >
          <Activity size={18} />
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
            className="cursor-pointer hover:opacity-80"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </DashboardLayout>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Upload,
      title: 'Bring your footage',
      text: 'Upload a short permitted clip, or add a permitted camera livestream in Cameras & live streams. Zenith keeps sources private and decodes a preview.',
    },
    {
      icon: Sparkles,
      title: 'Describe & confirm',
      text: 'A constrained English parser selects a supported capability. Zenith samples frames and proposes a region, gate and settings. Review the geometry, duration and approved recipients, then confirm.',
    },
    {
      icon: Cpu,
      title: 'Detect, track & apply rules',
      text: 'The worker uses the configured YOLO detector and ByteTrack for people and vehicles. Python checks zone dwell, line crossings, or posture collapse.',
    },
    {
      icon: ShieldCheck,
      title: 'Inspect the observation',
      text: 'The rule records suspected events with source-timestamped frames. A multi-frame sequence gives clear visual evidence for human review.',
    },
    {
      icon: Leaf,
      title: 'Estimate with documented factors',
      text: 'Road counts supply activity data. Formulas, measured distance and the selected emission factors remain attached with transparent calculations.',
    },
    {
      icon: FileText,
      title: 'Notify & document',
      text: 'Approved contacts receive alerts through the channels the backend reports as configured. Download PDF or CSV audit summaries directly from saved records.',
    },
  ];

  return (
    <div className="flex flex-col gap-gutter-xl w-full">
      <Heading
        eyebrow="THE EXPLAINER"
        title="Understand what happens inside"
      >
        No hidden claims. Here is what this version does, where the models stop, and where operators decide.
      </Heading>

      <section className="bg-primary text-on-primary p-gutter-xl rounded-lg flex flex-col md:flex-row items-center justify-between gap-gutter-xl shadow-xs">
        <div className="flex flex-col gap-gutter-sm max-w-xl">
          <span className="font-label text-label-sm text-primary-border uppercase font-semibold">
            Human-Confirmed Monitoring
          </span>
          <h2 className="font-headline text-headline-lg font-semibold">
            Language sets the intention.<br />
            Rules trigger the observation.<br />
            <span className="text-secondary-container">People make the decision.</span>
          </h2>
        </div>
        <div className="w-28 h-28 rounded-full border-2 border-primary-border flex flex-col items-center justify-center gap-1 text-on-primary">
          <Camera size={36} />
          <span className="font-mono text-mono-sm font-semibold">VIDEO &rarr; EVIDENCE</span>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter-lg">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <section
            className="bg-surface-container-lowest border border-outline-variant rounded-lg p-gutter-lg flex flex-col gap-gutter-md shadow-xs"
            key={title}
          >
            <div className="flex items-center justify-between">
              <span className="w-10 h-10 rounded bg-primary-container text-primary flex items-center justify-center">
                <Icon size={22} />
              </span>
              <span className="font-mono text-mono-md text-on-surface-variant font-semibold">
                0{i + 1}
              </span>
            </div>
            <h2 className="font-title text-title-md text-on-surface font-semibold">{title}</h2>
            <p className="font-body text-body-sm text-on-surface-variant leading-relaxed">{text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function Settings({ data, connected, notify, refresh }: Props) {
  const [base, setBase] = useState(connection().base);
  const [key, setKey] = useState(connection().key);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const models = data.status?.models;

  async function installModel(file: File | undefined) {
    if (!file) return;
    setInstalling(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await json('/models/action', { method: 'POST', body });
      refresh();
      notify('Fight and fall checkpoint installed.');
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setInstalling(false);
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const previous = connection();
    try {
      if (base) {
        const url = new URL(base);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol !== 'https:') ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== '/'
        ) {
          throw new Error('Use an HTTPS origin, or a loopback HTTP origin, without a path or credentials.');
        }
      }
      if (key.length < 24) throw new Error('Enter the operator key generated by the backend.');
      sessionStorage.setItem('zenith.base', base.replace(/\/$/, ''));
      sessionStorage.setItem('zenith.key', key);
      await json('/status');
      refresh();
      notify('Backend connected. Operator access verified.');
    } catch (e) {
      sessionStorage.setItem('zenith.base', previous.base);
      sessionStorage.setItem('zenith.key', previous.key);
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-gutter-xl w-full">
      <Heading
        eyebrow="CONNECTIONS & DIAGNOSTICS"
        title="Health & settings"
      >
        Check service connections, configure your demo and manage analysis models.
      </Heading>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter-lg items-start">
        <section className="bg-surface-container-lowest border border-outline-variant rounded-lg p-gutter-xl flex flex-col gap-gutter-lg shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-gutter-xs">
              <h2 className="font-headline text-headline-md text-on-surface font-semibold">
                Backend connection
              </h2>
              <p className="font-body text-body-sm text-on-surface-variant">
                The key stays in this browser tab’s session storage.
              </p>
            </div>
            <span
              className={`px-gutter-sm py-gutter-xs rounded-full font-label text-label-sm font-semibold ${
                connected
                  ? 'bg-success-container text-on-success-container'
                  : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <form onSubmit={apply} className="flex flex-col gap-gutter-md">
            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-on-surface font-medium">API origin</span>
              <input
                type="url"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="Blank = this dashboard’s server · or https://your-backend.url"
                className="rounded border border-outline-variant px-gutter-md py-gutter-sm font-body text-body-sm outline-none focus:border-primary"
              />
              <span className="font-body text-body-sm text-on-surface-variant">
                Leave blank when running locally or on loopback.
              </span>
            </label>

            <label className="flex flex-col gap-gutter-xs">
              <span className="font-label text-label-md text-on-surface font-medium">Operator API key</span>
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                minLength={24}
                placeholder="From data/operator.key or ZENITH_API_KEY"
                className="rounded border border-outline-variant px-gutter-md py-gutter-sm font-body text-body-sm outline-none focus:border-primary"
              />
            </label>

            <div className="flex items-center gap-gutter-sm pt-gutter-sm">
              <button
                type="submit"
                disabled={busy}
                className="px-gutter-lg py-gutter-sm rounded bg-primary text-on-primary font-label text-label-lg hover:opacity-90 transition-opacity cursor-pointer font-semibold shadow-xs disabled:opacity-50"
              >
                {busy ? 'Connecting…' : 'Verify & connect'}
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.removeItem('zenith.key');
                  setKey('');
                  refresh();
                  notify('Browser disconnected. Backend records remain saved.');
                }}
                className="px-gutter-lg py-gutter-sm rounded bg-surface-container-lowest border border-outline-variant text-on-surface font-label text-label-lg hover:bg-surface-container-low transition-colors cursor-pointer font-medium"
              >
                Disconnect
              </button>
            </div>
          </form>
        </section>

        <HealthPanel status={data.status} connected={connected} refresh={refresh} />
      </div>

      <DemoSetup status={data.status} connected={connected} />

      {connected && (
        <section className="bg-surface-container-lowest border border-outline-variant rounded-lg p-gutter-xl flex flex-col gap-gutter-lg shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-gutter-xs">
              <h2 className="font-headline text-headline-md text-on-surface font-semibold">
                Analysis models
              </h2>
              <p className="font-body text-body-sm text-on-surface-variant">
                Used by the connected analysis worker.
              </p>
            </div>
            <Cpu size={22} className="text-on-surface-variant" />
          </div>

          <div className="flex items-center justify-between py-gutter-sm border-t border-outline-variant font-body text-body-sm">
            <span>Zone, live preview &amp; traffic</span>
            <span className="font-mono text-mono-sm text-on-surface font-semibold">
              {models ? `${models.traffic.detector} · ${models.traffic.tracker}` : 'Backend has not reported a model'}
            </span>
          </div>
          <div className="flex items-center justify-between py-gutter-sm border-t border-outline-variant font-body text-body-sm">
            <span>Fight and fall</span>
            <span className="font-mono text-mono-sm text-on-surface font-semibold">
              {models
                ? `${models.action.detector} · ${models.action.checkpoint_present ? models.action.classifier : 'checkpoint not installed'}`
                : 'Backend has not reported a model'}
            </span>
          </div>
        </section>
      )}

      {connected && <TelegramPhotos data={data} connected={connected} notify={notify} refresh={refresh} />}

      {connected && data.status?.is_admin && <OperatorKeys notify={notify} />}
    </div>
  );
}

function TelegramPhotos({ data, notify, refresh }: Props) {
  const telegram = data.status?.channels?.telegram;
  const configured = !!telegram?.configured;
  const enabled = !!data.status?.preferences?.telegram_car_photos;
  const admin = !!data.status?.is_admin;
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await json('/preferences', {
        method: 'POST',
        body: JSON.stringify({ telegram_car_photos: next }),
      });
      refresh();
      notify(next ? 'Telegram vehicle photos enabled.' : 'Telegram vehicle photos disabled.');
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-lg p-gutter-xl flex flex-col gap-gutter-lg shadow-xs">
      <div className="flex items-start justify-between gap-gutter-md">
        <div className="flex flex-col gap-gutter-xs">
          <h2 className="font-headline text-headline-md text-on-surface font-semibold">
            Telegram vehicle photos
          </h2>
          <p className="font-body text-body-sm text-on-surface-variant">
            Send a detector frame when a Traffic &amp; CO₂ analysis first sees a vehicle.
          </p>
        </div>
        <span
          className={`px-gutter-sm py-gutter-xs rounded-full font-label text-label-sm font-semibold ${
            enabled
              ? 'bg-success-container text-on-success-container'
              : 'bg-surface-container text-on-surface-variant'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>

      <label
        className={`flex items-start gap-gutter-md rounded border border-outline-variant p-gutter-md ${
          configured && admin ? 'cursor-pointer hover:bg-surface-container-low' : 'opacity-70'
        }`}
      >
        <input
          type="checkbox"
          className="mt-1"
          checked={enabled}
          disabled={!configured || !admin || busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className="flex flex-col gap-gutter-xs">
          <span className="font-label text-label-lg text-on-surface font-medium">
            Send one photo per vehicle sighting
          </span>
          <span className="font-body text-body-sm text-on-surface-variant">
            Photos go only to the Telegram chats configured on this backend: the chats selected on the
            camera rule, or every configured chat when the rule selects none. Saved cameras honor the
            rule&apos;s repeat-alert cooldown. The photo is detector output, not a confirmed incident.
          </span>
        </span>
      </label>

      {!configured && (
        <p className="font-body text-body-sm text-on-surface-variant">
          Telegram is not configured. Set <code>TELEGRAM_BOT_TOKEN</code> and{' '}
          <code>ZENITH_TELEGRAM_CHATS</code> on the backend, then restart it before enabling photos.
        </p>
      )}
      {configured && !admin && (
        <p className="font-body text-body-sm text-on-surface-variant">
          Enter the administrator key in the connection panel to change outbound photo delivery.
        </p>
      )}
      {configured && (
        <p className="font-body text-body-sm text-on-surface-variant">
          {telegram?.chats ?? 0} configured Telegram chat{telegram?.chats === 1 ? '' : 's'}. Turning this
          off stops new photos and cancels queued photo notifications before delivery.
        </p>
      )}
    </section>
  );
}
