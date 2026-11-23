# Zenith · Evidence-led CCTV & carbon workspace

[![Deploy frontend with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FUnknown27s%2FZenith&env=VITE_API_BASE_URL&envDescription=Public%20HTTPS%20backend%20origin%20only%3B%20never%20put%20API%20keys%20here&envLink=https%3A%2F%2Fgithub.com%2FUnknown27s%2FZenith%2Fblob%2Fmain%2Fdocs%2FDEPLOYMENT.md)

**Vercel deploys the frontend only.** Set `VITE_API_BASE_URL` to your persistent HTTPS FastAPI backend's origin, and add your exact Vercel site origin to backend `ZENITH_ORIGINS`. Keep the API/worker and evidence storage running separately. Never add NVIDIA keys, database passwords or operator keys as frontend build variables. See [deployment instructions](docs/DEPLOYMENT.md).

Laptop-first React + FastAPI application with real file-analysis worker, private evidence and transparent operational carbon estimates. Isolated smoke scripts are available in `scripts/smoke_video.py` and `scripts/smoke_services.py`.

**Start here: [HOW_TO_RUN.md](HOW_TO_RUN.md)** — prerequisites, one-command startup, demo videos, input-specific YOLO settings, Supabase/NVIDIA secrets and deployment limits.

## One-command start / share with another computer

```sh
python start.py
```

Requires Python 3.12 or `uv`, plus Node.js 22+ if the UI needs building. The portable ZIP includes the UI build and does not need Node at runtime. The launcher prepares local dependencies, starts API + worker, and serves the full website at `http://127.0.0.1:8000`. Leave API origin blank there. Initial ML downloads can be large; this is not a dependency-free executable.

Create a shareable release with `npm run build` followed by `python scripts/package_portable.py`; share `artifacts/zenith-portable.zip`. Secrets, recordings, databases and installed dependencies are excluded. See [deployment and Supabase setup](docs/DEPLOYMENT.md).

Vercel frontend configuration is included, **not deployed**. Supabase is the recommended hosted database path, **not connected**; its Auth/Storage integrations are future work. Demo dataset links are available in the website's **Demo Footage** option; see [sources and reuse caveats](docs/DEMO_FOOTAGE.md). NVIDIA vision API findings are in [docs/VISION_API.md](docs/VISION_API.md).

## Run on your laptop

Use Python **3.12** for the ML dependency stack (rather than the system Python 3.14). CPU inference works; performance is hardware-dependent.

```sh
npm install
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch torchvision --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/bin/python -r backend/requirements.txt
cp .env.example .env
.venv/bin/python scripts/run_local.py
```

Open **http://127.0.0.1:5173/#settings**. Leave API origin blank for the Vite proxy. Read `data/operator.key` locally and enter it in the key field. If `ZENITH_API_KEY` is set in `.env`, use that instead. Do not publish either secret. Ctrl+C stops the launcher.

For a production frontend build: `npm run build`, then `npm run preview` (port 4173). The Vite development proxy applies to development; for preview enter `http://127.0.0.1:8000` as the API origin. The backend CORS list allows these loopback origins. Docker serves a same-origin `/api` proxy.

### Lighter API-only startup
To use the carbon ledger, operator equipment log and reports before installing ML dependencies, install `backend/requirements-api.txt` in a Python 3.12 environment and run `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`, alongside `npm run dev`. Video upload requires the full dependencies; inference also requires a running worker. The UI shows the missing worker instead of pretending analysis is available.

### GPU option
The commands above intentionally install CPU PyTorch. For a laptop NVIDIA GPU, choose the correct PyTorch/CUDA distribution for your installed driver instead; no GPU or driver compatibility is assumed. Colab uses its installed PyTorch when compatible.

## Pages
- **Overview:** actual sources, observations, crossings and separate equipment/traffic carbon summaries. Honest empty states; no fabricated stats.
- **Monitoring studio:** upload permitted-use clips or record a short browser-camera clip (HTTPS/localhost), inspect the suggested zone/line, describe what to watch, confirm and run. Browser camera capture is not continuous CCTV ingestion.
- **Video findings:** an individual page for each video with its analysis, timeline, evidence, crossing corrections, source playback and downloadable per-run reports. Optional NVIDIA/local vision summaries inspect sampled frames only with configured sharing and explicit per-run consent.
- **Demo footage:** Kaggle dataset/download links with file sizes, reuse/citation caveats and feature-availability disclosures.
- **Incidents & evidence:** source-timestamped frames, decision history and notification outbox.
- **Carbon & energy:** electricity/equipment, fuel and vehicle-class estimates with source provenance.
- **Reports:** PDF with available evidence and CSV; workspace or single-run scope.
- **How It Works:** separate explainer option, including actual limitations.
- **Connection & settings:** local/Colab backend selection, worker heartbeat and integration readiness.

For a laptop-only RTSP/IP camera or permissioned HTTPS HLS stream, set `ZENITH_RTSP_URL` or `ZENITH_CAMERA_URL` in the backend environment and restart, then use **Studio → Preview stream → Start stream analysis** with a confirmed rule. This opt-in, single-process connector captures bounded clips for delayed analysis; it is not an always-on alerting service. Browser webcam recording remains available without network setup. See [HOW_TO_RUN.md](HOW_TO_RUN.md) for source/storage limits and privacy precautions.

The administrator can issue separate local operator keys in Settings; source and report access are scoped by key. Once any key is issued, automatic local sessions are disabled. Saved site factors keep region, year, class and citation; server-side calculations use the saved value. Stop services and run `scripts/backup_local.py` for an offline sensitive database/media archive. This local key scheme, backup script and bounded capture do **not** constitute public production multi-tenancy or an uptime guarantee.

## First real run
1. Choose one of the licensed source excerpts in **Demo Footage**, or upload a short fixed-camera clip (max 100 MB / 180 seconds by default). Additional original footage still requires your consent/reuse review. Bundled clips are demonstration sources, not validated rule outcomes.
2. For a person-zone instruction, choose **Restricted-zone dwell**; click a polygon around the area. Use at least three non-crossing points. A keyboard coordinate editor is also available.
3. Confirm the dwell threshold, geometry, name and configured recipient. Click **Run analysis**.
4. Detector weights download on their first run. To cache the default zone, traffic, and pose models before a demo, run:
   `.venv/bin/python -c "from ultralytics import YOLO; YOLO('yolov8n.pt'); YOLO('yolo11n.pt'); YOLO('yolo11n-pose.pt')"`
5. Inspect the run history and source evidence. An alert only appears if the actual detector/tracker and rule produce it. No promise is made of one alert without representative footage calibration.

## Traffic CO₂ and fight/fall notebooks

- [Traffic CO₂ Colab](notebooks/Zenith_Traffic_CO2_Colab.ipynb) runs the standalone two-gate demo. In Studio, choose traffic analysis and enable **Count complete road segment traversals**. Draw Gate A, then Gate B, left to right. Enter the measured road distance in metres. Completed two-gate runs carry their distance into carbon estimates. Enter a documented class factor in g CO₂ per vehicle-km. Demo Footage supplies an illustrative 50 m distance and factors for preview.
- [Fight and fall training Colab](notebooks/Zenith_CCTV_AutoTrain_Colab.ipynb) exports **zenith_cctv_action.pt**. Connect using the administrator key and upload the file in **Settings → Analysis models**. Alternatively put it in **data/models/zenith_cctv_action.pt** under the shared data directory or set **ZENITH_ACTION_MODEL** to a worker-visible path. The worker uses YOLO11 Pose plus the trained Transformer. The upload validates the checkpoint format and model architecture. The notebook's first reported test detected 15 of 29 fights and 8 of 22 falls. Review all model observations using the original footage.
- Demo Footage includes a fixed-camera motorway segment, boxing training and a staged fall. The two action clips join the automatic demo once an action checkpoint is configured. Boxing training tests a look-alike scenario. Action results are clip-based, including during bounded camera capture.

## Built-in carbon—industrial and road activity
No numeric factors are shipped as though universally valid. Enter an applicable source, year/region/fuel and activity basis.

| Kind | Formula | Notes |
|---|---|---|
| Electricity / electric equipment | kW × hours × load fraction × kg CO₂e/kWh | Use metered energy or documented power/load/runtime; grid factors vary |
| Fuel | litres consumed × kg CO₂e/litre | On/off duration alone is insufficient; document fuel and boundary |
| Traffic | class count × distance km × g CO₂/vehicle-km ÷ 1000 | Class-specific factor and road-segment distance required |

Electric equipment runtime can come from operator/meter logs, or an **explicitly accepted experimental visible-motion proxy** from an equipment analysis run. Motion is **not** on/off detection: powered stationary machinery can appear inactive, and people/shadows can appear active. Stationary generators and hidden motors require operator/PLC/smart-meter data. No claim of supporting every industry/process, direct CO₂ sensing, Scope 1/2 completeness or compliance certification.

The Carbon page also has an **operator-declared machine operation register**: register an asset (initial state UNKNOWN), record ON/OFF/UNKNOWN with an observation note, and view accumulated logged-ON hours and transition history. Time accrues until the next declaration; record UNKNOWN when observation ends. Stale ON declarations can overstate runtime. This is not automatic CCTV state sensing. Copy documented hours into the electricity calculator with an appropriate load basis; no power or emissions are inferred merely from ON status.

CO₂-only traffic estimates and CO₂e equipment estimates are not merged into one misleading total. Ledger entries are append-only estimates; avoid duplicate/overlapping activities. If one run supplies different vehicle classes, create one factor entry per class. Aggregated run counts include reruns, not deduplicated physical journeys.

## Plain-English configuration
An allowlisted **local constrained parser**, not a Gemini scene-reading agent, supports one capability at a time:
- “Alert if anyone stays inside for two seconds.” → YOLO detection + tracking + zone dwell.
- “Count vehicles crossing this line.” → the same detector + tracking + finite line-crossing rule.
- “Observe visible machine activity.” → OpenCV ROI motion proxy, **not an electrical state model**.

Draw and confirm geometry. The parser cannot locate a loading bay or authorize an email recipient from words. No arbitrary model/code execution. Pose/collapse, helmets/PPE, crowd and exit obstruction are not enabled.

## Email and evidence
Default: preview-only. Set `ZENITH_RECIPIENTS` to approved email addresses. Actual sending also needs `RESEND_API_KEY` and a verified `ZENITH_FROM_EMAIL`. Restart API and worker after changing settings. No actual emails were sent during the build.

Events and notification outbox rows commit together. Provider calls reuse deterministic idempotency keys, retry within a bounded window and stop for reconciliation when expired/ambiguous. `sent` means provider acceptance, **not** delivered. Delivery webhooks and escalation are not implemented. Preview rows are deliberately not automatically sent when you later add credentials.

Before/during/after JPEG evidence is derived and annotated. A source boundary may lack a before/after frame; it is not fabricated. Optional consent-gated vision review and video summaries interpret sparse stills, not whole-video truth. Source offsets are seconds in the clip; upload/processing times are recorded separately. Pixel motion and tracked rules process sampled frames (approximately 8 FPS); all detections remain unvalidated on your camera footage.

## Docker Compose (optional)
Docker/Compose availability has not been assumed. Configure `.env` first; `POSTGRES_PASSWORD` must be a long random **alphanumeric** string for the interpolated connection URL.

```sh
docker compose up --build
```

Open http://127.0.0.1:8080. Read the shared local `data/operator.key` unless you explicitly set `ZENITH_API_KEY`. If Docker created the key as root, retrieve it privately with `docker compose exec api cat /data/operator.key`. PostgreSQL uses a named volume; source/evidence use `./data`. SQLite laptop records do not automatically migrate to Compose. The shared `:z` bind label supports Fedora SELinux. CPU images can be large; the first build and model download need network access. Compose is supplied but not claimed validated unless actually run.

## Colab backend
See [docs/COLAB.md](docs/COLAB.md) and [notebooks/Zenith_Colab.ipynb](notebooks/Zenith_Colab.ipynb). Run `npm ci` and then `python scripts/package_colab.py` to build `artifacts/zenith-colab.zip` with the backend and dashboard. The notebook supports interactive processing and an optional temporary HTTPS dashboard link. Respect managed runtime restrictions; free Colab is not a dependable web backend. No keepalive or policy bypass mechanisms.

## Safety, persistence and limits
- A local administrator key can create up to ten separate operator bearer keys, each with private records and protected artifacts. Creating one disables automatic local browser sessions. This is **not** production multi-tenant authentication. Rotating or losing a key changes ownership visibility; back up keys securely with the database.
- SQLite WAL for laptop/Colab; PostgreSQL for Compose. One worker, 90-second leased jobs renewed by heartbeat, deterministic per-run event IDs. Interrupted inference restarts from the source; partial events remain labelled through incomplete run coverage.
- At most three queued/processing jobs checked by API and thirty uploaded clips; limit sources to short video. Single-operator demo concurrency only, not robust public rate limiting. Put strict body, rate, CPU/time and storage quotas in a reverse proxy before exposing it. Do not accept untrusted customer footage in this MVP.
- Media decoding runs on the host, not a sandbox. Updates, isolation and resource controls are required before handling hostile uploads. No remote URLs or RTSP credentials are accepted.
- No automatic retention/deletion, database migration framework, full health watchdog, cloud storage, escalation, or replay bundle. Optional single-process RTSP capture runs only when configured and started by an operator; it records short clips for delayed analysis, not continuous low-latency alerts. Stop it before backing up the laptop.
- All data is local by default. Colab/ngrok, hosted NVIDIA review and optional email introduce third parties. Do not upload private customer footage without authorization.
- Review Ultralytics code/model licensing (AGPL/enterprise options) and footage rights before commercial deployment.

## Verification record
See `docs/BUILD_STATUS.md` for actual build/runtime evidence and outstanding validation. The original architecture remains unchanged in `Team_Zenith_CCTV_SaaS_Architecture.md`.
