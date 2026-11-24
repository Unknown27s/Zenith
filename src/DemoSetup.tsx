import { Camera, Cpu, Send } from 'lucide-react';
import type { Status } from './types';

export default function DemoSetup({status, connected}: {status: Status | null; connected: boolean}) {
  return <section className="panel demo-setup section-gap">
    <div className="panel-heading"><div><h2>YouTube + vision review + Telegram setup</h2>
      <p>Server-side configuration stays private. The dashboard controls preview, rules, consent and tests.</p></div></div>
    <div className="demo-setup-grid">
      <article><Camera size={21}/><h3>1. Connect a stream</h3>
        <p>Paste YouTube livestream URLs directly into Cameras & live streams. Save named inputs and open a separate YOLO preview and rule page for each. No environment edit or restart is required.</p>
        <a className="text-link" href="#cameras">Add cameras & open previews →</a>
        <p>For credentialed RTSP/HLS input, backend environment configuration and Studio controls remain available.</p>
      </article>
      <article><Cpu size={21}/><h3>2. Optional vision review</h3>
        <p>{connected && status?.vision?.configured ? `${status.vision.provider} · ${status.vision.model}` : 'YOLO triggers work without a vision provider. Enable vision review for advisory evidence decisions.'}</p>
        <pre><code>{'VISION_PROVIDER=typesafe\nTYPESAFE_API_KEY=your_private_key\nTYPESAFE_MODEL=jev-1.14.0\nVISION_SEND_TO_THIRD_PARTY=true\nVISION_MAX_FRAMES=3'}</code></pre>
        <p>Restart API and worker. Explicitly approve evidence sharing before starting stream analysis. Hosted image review is experimental; it never suppresses the original alert.</p>
      </article>
      <article><Send size={21}/><h3>3. Enable Telegram alerts</h3>
        <p>{connected && status?.channels?.telegram.configured ? `${status.channels.telegram.chats} chat(s) approved · evidence photos ${status.channels.telegram.evidence ? 'enabled' : 'off'}.` : 'Create a bot with @BotFather, then press Start in each approved chat.'}</p>
        <pre><code>{'TELEGRAM_BOT_TOKEN=your_private_token\nZENITH_TELEGRAM_CHATS=your_numeric_chat_id\nTELEGRAM_SEND_EVIDENCE=true'}</code></pre>
        <p>Restart API and worker. Select the Telegram recipient in Studio and set a repeat-alert cooldown. Use the administrator-only test button above to send a labelled setup message.</p>
      </article>
    </div>
    <p className="demo-setup-note">Edit the private backend <code>.env</code> file—not browser build variables. Never paste keys into monitoring instructions. Stream capture uses bounded clips: playback delay, capture gaps and per-clip tracking resets can miss events. Each test and incident needs human verification.</p>
  </section>;
}
