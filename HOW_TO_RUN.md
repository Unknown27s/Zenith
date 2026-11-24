# How to run Zenith

## Quick start on another computer

Download/extract this repository (or clone it), open a terminal in its folder, then run:

```sh
python start.py
```

On Linux/macOS the command may be `python3 start.py`. On Windows with the Python launcher it may be `py -3.12 start.py`.

### Prerequisites
- **Python 3.12**, or **uv** installed so the launcher can obtain Python 3.12.
- **Node.js 22+** when running from source. The portable ZIP already includes the built frontend and does not need Node unless rebuilding.
- Internet and sufficient disk space for the first ML dependency/model downloads. CPU inference is the default; no NVIDIA GPU or NVIDIA API key is required.

The launcher prepares `.venv`, builds/uses the website, initializes the selected database and starts the API plus analysis worker. Nothing is installed into global Python site-packages. Initial setup can take several minutes.

Open **http://127.0.0.1:8000/#demos**. The browser should open automatically. Initially the loopback-only laptop app connects using a short-lived HttpOnly session cookie, without revealing the permanent operator key. Once separate operator keys have been created in Settings, automatic local access is disabled for every user: use each user's own key instead. Manually launched or remote backends also require a key. For Connection Settings:
1. Leave **API origin blank** for this same-origin laptop setup.
2. Open `data/operator.key` privately and copy its contents into the **operator key** field. If `.env` sets `ZENITH_API_KEY`, use that value instead.
3. Click **Verify & connect**. A fresh worker heartbeat means the analysis process is available.

Before public tunnelling, run `python start.py --require-key` (or `--local --require-key`) to disable local automatic sessions. Remote/public hosts never receive automatic local access; exact-origin checks and loopback restrictions apply. This is still a single-operator demonstration, not production multi-tenant auth.

The operator key is not your NVIDIA or Supabase key. Keep all private keys out of screenshots and chat. **Ctrl+C** in the launcher terminal stops its API and worker.

## If your configured cloud database is unavailable

```sh
python start.py --local
```

This explicitly uses local SQLite without changing the `DATABASE_URL` saved in `.env`. Cloud records are not copied into SQLite and local records are not silently migrated to the cloud. If port 8000 is already occupied, stop your previous Zenith terminal or choose a different port:

```sh
python start.py --local --port 8003
```

Then open **http://127.0.0.1:8003**. Do not run duplicate workers against the same database while presenting.

## Try one example per supported input

Open **Demo Footage** in the sidebar. Three actual short source excerpts are included:

| Example | Duration | Analysis |
|---|---:|---|
| People crossing a street | 3.67 s | YOLO26 Nano + ByteTrack; person-only demonstration zone/dwell rule |
| Vehicles at an interchange | 12 s | YOLO26 Nano + ByteTrack; selected vehicle classes and a finite crossing line |
| A screw conveyor | 5.8 s | OpenCV region-motion proxy; **not** electrical ON/OFF recognition |

Each card has playback, download, source credit/license and **Use in studio**. The source footage is not pre-generated detection output. Credits and adaptation terms are in `public/examples/ATTRIBUTION.md` and accompany the public assets. The people clip depicts normal street activity; the proposed region is a fictional demo zone, not evidence of an actual access violation.

1. Connect the backend, then click **Use in studio** on an example.
2. Describe the rule in **Describe what to detect** and click **Propose rule**. Zenith samples frames from the clip and proposes a region, gate and detector settings; a configured vision model is used only when available and, for hosted providers, explicitly allowed. Review the proposal and its uncertainties. Manual adjustment is optional: use Clear and click to change the geometry, or Reset suggestion to restore the fallback. Proposed geometry is not scene understanding or camera calibration.
3. Choose the capability and inspect the input-specific analysis settings. Presets are starting values, not calibrated accuracy claims:
   - People: confidence 0.35, 640 px, IoU 0.7, requested 8 FPS, person class only.
   - Traffic: confidence 0.25, 960 px, IoU 0.6, requested 10 FPS, selected car/motorcycle/bus/truck classes.
   - Equipment: region-motion fraction and sustained duration; generic YOLO vehicle/person weights do not classify machine power state.
4. Review the name, dwell/threshold, settings and approved notification recipient. Confirm the configuration.
5. Click **Run analysis**. The actual model/worker runs on the source frames. Inference size/confidence/FPS/IoU/class selection are stored with the run and included in its report. Detector accuracy still requires scene-specific review.
6. Inspect **Incidents & evidence**, record an operator action, and download a report. An alert/count is only shown if the real rule produces it; no particular outcome is guaranteed by an example link.

You can also upload permitted MP4/MOV/AVI/MKV/WebM clips (default 100 MB / 180 s limit). In Studio, **Open camera → Record short clip** captures up to 12 seconds from a local browser camera on HTTPS or localhost; stop to upload it and close the camera after use. It is not unattended CCTV/RTSP streaming. Describe one supported rule, review the proposed line or region and its uncertainties, confirm it, then run analysis. **Video findings → select a video** opens its own analysis page with the saved summary, timestamp timeline, source playback, evidence thumbnails, crossing annotations and PDF/CSV reports for each run. Mark false crossings with a reason; raw detector counts and previously saved carbon estimates remain unchanged for audit. Incident observations can be dismissed with an operator note in **Incidents & evidence**. The optional NVIDIA sampled-frame summary requires backend sharing permission and explicit per-run consent; rule output summaries work without AI. The vision review checkbox appears in Studio and camera setup whenever a provider is configured. If it is disabled, the checkbox shows the backend reason (for example hosted frame sharing is off or the provider key is missing); set `VISION_PROVIDER` and, for hosted providers, `VISION_SEND_TO_THIRD_PARTY=true` in `.env`, then restart the API and worker to enable it. Additional Kaggle dataset links remain in Demo Footage, with size/license caveats.

### Saved YouTube cameras and per-camera rules

Open **Cameras & live streams**, add a permitted YouTube livestream, then **Open camera & rule**. The page starts with an optional **live detection preview**: sampled boxes that create no clips, counts, findings or alerts. Each camera has its own **Incident rule & clip analysis** panel: monitoring type, rule name, sustained duration, cooldown, advanced detector settings, notification recipients, and the road/zone geometry drawn on that camera's own preview. Changing these fields affects only that camera. Click **Save rule** to store the rule without starting capture; **Start clip analysis** also stores it and begins recording short clips. A saved camera never auto-resumes after a restart. The **What is happening on this camera** checklist and **Next step** line show what is saved, running or still missing.

When a traffic camera completes a clip, **Carbon from this camera** appears below its rule. Choose the completed run, vehicle class and a published or saved class-specific factor; the server uses that run's saved counts and excludes operator-reviewed false-positive crossings. Camera counting uses one line, so enter the road distance represented by that clip in the carbon panel. Preview shows the formula and source before you save to the ledger. Counts are per clip, not a continuous total, and preview boxes alone do not create counts. Until a traffic clip completes, the panel names the actual blocker: no saved rule, a non-traffic rule, a clip still processing, or no completed clip.

## Carbon and machine ON/OFF

Open **Carbon & energy**:
- Electric equipment: power × runtime × load fraction × sourced grid factor.
- Fuel: documented litres × sourced fuel factor.
- Traffic: class count × segment distance × sourced class-specific factor.
- Saved camera: after a completed traffic clip, use **Carbon from this camera** in that camera's workspace. It uses the run's saved counts and segment distance, and excludes operator-reviewed false-positive crossings.
- Operator machine log: record **ON / OFF / UNKNOWN** with a basis note; logged ON time accrues until the next declaration. Record UNKNOWN when observation stops. This is not automatic state sensing.

Common reference factors are built in for electricity (India CEA 2023, US eGRID 2022, EU EEA 2023, IEA world 2023), fuels (diesel, petrol, LPG) and traffic per vehicle-kilometre (car, motorcycle, bus, truck). They are generic published values, not site measurements: choosing one fills the form and keeps its source, region, year and note visible, but nothing is saved automatically and the reference ID is never stored as a saved factor. Check the value against your supplier, meter, fuel record or vehicle mix before relying on the result, and prefer a saved site-specific factor where one exists. Add the applicable source, units, activity basis and uncertainty. CCTV motion is not proof of electrical power, fuel use or emissions. CO₂ and CO₂e estimates are labelled separately.

**Saved site factors:** In Carbon & energy, save a factor with its original citation, region, year, unit implied by activity kind, and vehicle class for traffic. Select it in the calculator. The server uses the saved factor value (not a modified browser number) and verifies the traffic class matches. A linked run supplies counts or a clearly labelled runtime proxy; a real meter or fuel record still needs operator input. Run `python scripts/smoke_carbon.py` for an offline check of the reference list, authentication and preview math.

## RTSP/IP camera or HTTPS HLS stream on this laptop (optional)

Keep the RTSP URL and password **server-side only** in `.env`; do not paste them into the browser, a chat, or frontend build variables:

```dotenv
ZENITH_RTSP_URL=rtsp://YOUR_CAMERA_HOST:554/YOUR_PRIVATE_STREAM_PATH
ZENITH_STORAGE_LIMIT_MB=500
```

Alternatively use `ZENITH_CAMERA_URL=https://YOUR_PERMISSIONED_STREAM/playlist.m3u8` for an HTTPS HLS stream. `ZENITH_CAMERA_URL` takes precedence over `ZENITH_RTSP_URL`. Only explicit RTSP/RTSPS ports and HTTPS `.m3u8` paths are accepted. A publicly reachable prerecorded test stream can validate network ingestion, but is **not a live security camera**.

For a no-credential **prerecorded test** (not CCTV), use `ZENITH_CAMERA_URL=https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` temporarily, or run `python scripts/smoke_stream.py` to test it against an isolated temporary database. The sample is [Big Buck Bunny](https://peach.blender.org/), © Blender Foundation, CC BY 3.0, hosted by Mux for HLS playback testing. It is not packaged as a Zenith example, and it cannot validate camera uptime or traffic counting. Remove the URL or set your own permitted stream after testing.

Restart API and worker. In Studio, click **Get preview frame** (requires access to your stream), check the visible rule geometry, describe one supported rule, confirm it, then click **Start clip analysis**. It records approximately 12-second clips for queued worker analysis; stop from Studio when done. The recording and queue stop at 30 source clips, three pending jobs, or the per-operator source storage limit. A failed connection retries with capped backoff from five seconds up to 60 seconds. There are no low-latency alerts, automatic deletion, distributed leader election, or validated camera reconnect guarantees. One API process and one network stream are supported; the backend-only URL is never returned in API responses. The existing browser webcam can still record short clips without network setup.

## Separate laptop operator keys and backup

In **Settings → Local operator access**, the administrator can issue a unique key for each operator. Copy it immediately and use it in that operator's Connection Settings. Records are isolated by operator; revoke a key to stop access, not to erase its records. Once any key is issued, automatic local sessions stop working. This is local key-based access, not Supabase Auth or hardened public multi-tenant hosting.

Stop the API, worker and RTSP camera before backing up. For a SQLite laptop, run:

```sh
python scripts/backup_local.py artifacts/private-zenith-backup.zip
```

The archive includes a SQLite snapshot, locally stored source clips/evidence and `data/operator.key` if present. With PostgreSQL, install `pg_dump` first; the same command exports the configured private schema. The ZIP is **unencrypted and sensitive**: store it securely, encrypt it before moving it, and back up `ZENITH_API_KEY` separately if it was set in `.env`. It does not include `.env`. Restore requires stopping services and restoring the database and media together; PostgreSQL restore has not been tested. `python scripts/smoke_video.py` runs a real packaged traffic clip in an isolated temporary SQLite database; `python scripts/smoke_services.py` checks local keys, saved factors and an offline SQLite backup.

## Supabase database (optional)

Local SQLite works without a Supabase account. To configure Supabase, privately edit `.env` using the exact **Connect → Session pooler** details from your dashboard:

```dotenv
DATABASE_URL=postgresql+psycopg://DASHBOARD_USER:ENCODED_PASSWORD@EXACT_POOLER_HOST:5432/postgres?sslmode=require
DATABASE_SCHEMA=zenith_private
```

Do not use the placeholder host literally. Percent-encode reserved characters in the password. Standard `postgresql://` URLs are normalized to the installed psycopg driver; Supabase connections require SSL in the backend. A publishable/anon key is not the database password.

The private schema must not be exposed through Supabase's public Data API. Supabase Auth/Storage browser adapters are **not implemented**. Evidence still resides on the backend disk. See `docs/DEPLOYMENT.md` for connection, security and migration caveats. A failing hostname/password blocks cloud startup; use `--local` deliberately rather than silently falling back.

## NVIDIA key (optional evidence review)

Store it privately in backend `.env`:

```dotenv
NVIDIA_API_KEY=YOUR_PRIVATE_API_CATALOG_KEY
VISION_PROVIDER=nvidia
VISION_SEND_TO_THIRD_PARTY=false
```

Get an API Catalog key at https://build.nvidia.com/ from an image-capable model's **Get API Key** option. No `VITE_` or `NEXT_PUBLIC_` prefix for this secret. Restart the API and worker, then use **Settings → Run health checks** to check access without sending images. To enable hosted review, set `VISION_SEND_TO_THIRD_PARTY=true` on the backend and restart; the operator must separately consent on each run or incident. Do not enable this for footage without sharing permission. Local YOLO works without the key. A vision LLM does not replace timestamps, tracking, event rules or sourced carbon calculations. See `docs/VISION_API.md`.

`GET /api/health` checks only that the API process responds; `GET /api/ready` checks that the configured application database and its tables are reachable (HTTP 503 if not). The Settings page separately shows database and worker state. A Supabase project URL and publishable key are **not** `DATABASE_URL`; use the private PostgreSQL connection string described above. Never place it in the browser.

## Alert notifications (Telegram or email)

An alert is created only when a confirmed rule observation is saved. Detection alone does not message anyone.

### YouTube live resolution

Saved YouTube inputs use yt-dlp first, preferring video-only HLS up to 720p
(audio is not required for YOLO). Resolver/format failures automatically try
Streamlink's live HLS resolver. Both dependencies are in `backend/requirements.txt`;
restart the launcher after updating so it installs them. The fallback has a
30-second timeout (`STREAMLINK_TIMEOUT`); yt-dlp defaults to 45 seconds
(`YT_DLP_TIMEOUT`). Signed stream URLs stay on the backend.
If a stream fails to open, the cached URL is discarded and retries back off
from 5 seconds up to 60 seconds, so an expired signed link is resolved fresh
without repeatedly re-running the resolver.
Private/restricted, bot-check, rate-limited, ended and non-live results do not
trigger fallback. Streamlink is not a way to bypass provider restrictions.
An optional `YOUTUBE_COOKIES_FILE` is used by both resolvers.
This does not add support for arbitrary webcam websites in the saved-input UI.
Direct server-configured RTSP/HLS inputs do not need either resolver.

**Telegram (recommended for phones)**

1. Create a bot with **@BotFather** and copy its token. If a token is ever exposed, run `/revoke` in @BotFather and use the new one.
2. Open your bot, press **Start**, and send it any message. A bot cannot message a chat that has never started it.
3. Find the chat ID without printing the token:

```sh
.venv/bin/python - <<'PY'
import os, httpx
from dotenv import load_dotenv
load_dotenv()
token = os.environ['TELEGRAM_BOT_TOKEN']
updates = httpx.get(f'https://api.telegram.org/bot{token}/getUpdates', timeout=15).json()
print([m['message']['chat'] for m in updates.get('result', []) if 'message' in m])
PY
```

Group chat IDs are negative (often `-100…`). Use the `id` value.

4. Add both values to the backend `.env`, then restart the API and worker:

```dotenv
TELEGRAM_BOT_TOKEN=NEW_TOKEN_FROM_BOTFATHER
ZENITH_TELEGRAM_CHATS=123456789
```

5. In **Settings → Service readiness**, press **Send test Telegram alert**. The backend reports the bot check and each chat result.

Recipients appear in Studio’s **Notification recipients** list as `Telegram · chat <id>`. Tick one or more channels per rule; the same event can go to Telegram and email together. The token never reaches the browser. Text alerts contain the event title, source name, video offset, rule name and the observation detail.

Set `TELEGRAM_SEND_EVIDENCE=true` to attach one saved “during” frame with `sendPhoto`. It is off by default because the frame leaves this machine. If Telegram rejects the photo permanently, the worker falls back to the text alert and records the reason.

Each rule has a **Repeat-alert cooldown** (default 300 s, set `0` to disable). Repeat observations for the same rule fingerprint inside the window do **not** create another outbox row, but the incident and evidence are still saved. The incident shows whether the alert was queued or suppressed and when the next alert is allowed. The fingerprint covers detection settings and geometry, not recipient choices. `failed` and `blocked` deliveries do not suppress later alerts.

Telegram has no idempotency key, so a worker crash immediately after sending could duplicate one alert. A failed send retries with backoff and ends as `failed` (permanent rejection) or `needs_reconciliation`.

**Email** uses Resend with `RESEND_API_KEY` and `ZENITH_FROM_EMAIL`, and `ZENITH_RECIPIENTS` for approved addresses. Without both keys the outbox stays in `preview`, which means **not sent**.

**WhatsApp** is not implemented. The WhatsApp Business Cloud API needs a Meta business account, a dedicated number, template approval and message policy compliance; that is a separate integration, not a config switch.

Alerts are not instant: a network camera records a short clip, then the worker analyses it. The base clip is `ZENITH_CAMERA_CLIP_SECONDS` (default 5 s); a zone or activity rule uses at least `dwell + 2 s` so the rule can actually fire. Expect notification delay of roughly clip length plus queue and inference time. True sub-second alerts would require in-process inference on every frame, which this app does not do.

## Portable archive

To produce a package for another machine:

```sh
npm run build
python scripts/package_portable.py
```

Share `artifacts/zenith-portable.zip`. The built UI and licensed example clips are included; `.env`, operator keys, customer footage/evidence, databases, downloaded model weights and `.venv` are excluded. Extract and run `python start.py`. Python/uv and first-install network access are still needed. Windows/macOS startup is designed for but not verified on those platforms.

## Vercel and Colab

- **Vercel:** `vercel.json` deploys the frontend. Keep a persistent HTTPS backend/worker on a suitable host or an intentionally exposed laptop tunnel. Set public `VITE_API_BASE_URL` to that backend origin and allow the exact Vercel origin in backend `ZENITH_ORIGINS`. Never put database/provider secrets in frontend build variables. Vercel is not hosting this worker or local evidence database. No deployment has been performed automatically.
- **Colab:** see `docs/COLAB.md` and `notebooks/Zenith_Colab.ipynb`. The code-only package excludes the licensed demo videos; download an example locally and upload it through the notebook. Observe Colab's interactive-compute policies. It is not persistent SaaS hosting.

## Other useful commands

```sh
python start.py --rebuild
python start.py --setup-only
python start.py --no-browser
```

No test cases or testing code are included. The actual build/runtime observations and remaining limitations are in `docs/BUILD_STATUS.md`.
