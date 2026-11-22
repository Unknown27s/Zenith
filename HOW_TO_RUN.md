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

Open **http://127.0.0.1:8000/#demos**. The browser should open automatically. The loopback-only laptop app connects automatically using a short-lived HttpOnly session cookie, without revealing the permanent operator key. This requires starting with the launcher; manually launched or remote backends require the key. For manual or remote Connection Settings:
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
| People crossing a street | 3.67 s | YOLOv8 Nano + ByteTrack; person-only demonstration zone/dwell rule |
| Vehicles at an interchange | 12 s | YOLOv8 Nano + ByteTrack; selected vehicle classes and a finite crossing line |
| A screw conveyor | 5.8 s | OpenCV region-motion proxy; **not** electrical ON/OFF recognition |

Each card has playback, download, source credit/license and **Use in studio**. The source footage is not pre-generated detection output. Credits and adaptation terms are in `public/examples/ATTRIBUTION.md` and accompany the public assets. The people clip depicts normal street activity; a region you draw is a fictional demo zone, not evidence of an actual access violation.

1. Connect the backend, then click **Use in studio** on an example.
2. Inspect its preview. Draw at least three polygon vertices for a zone/equipment region, or exactly two endpoints for a traffic line.
3. Choose the capability and inspect the input-specific analysis settings. Presets are starting values, not calibrated accuracy claims:
   - People: confidence 0.35, 640 px, IoU 0.7, requested 8 FPS, person class only.
   - Traffic: confidence 0.25, 960 px, IoU 0.6, requested 10 FPS, selected car/motorcycle/bus/truck classes.
   - Equipment: region-motion fraction and sustained duration; generic YOLO vehicle/person weights do not classify machine power state.
4. Review the name, dwell/threshold, settings and approved notification recipient. Confirm the configuration.
5. Click **Run analysis**. The actual model/worker runs on the source frames. Inference size/confidence/FPS/IoU/class selection are stored with the run and included in its report. Detector accuracy still requires scene-specific review.
6. Inspect **Incidents & evidence**, record an operator action, and download a report. An alert/count is only shown if the real rule produces it; no particular outcome is guaranteed by an example link.

You can also upload permitted MP4/MOV/AVI/MKV/WebM clips (default 100 MB / 180 s limit). Additional Kaggle dataset links remain in Demo Footage, with size/license caveats.

## Carbon and machine ON/OFF

Open **Carbon & energy**:
- Electric equipment: power × runtime × load fraction × sourced grid factor.
- Fuel: documented litres × sourced fuel factor.
- Traffic: class count × segment distance × sourced class-specific factor.
- Operator machine log: record **ON / OFF / UNKNOWN** with a basis note; logged ON time accrues until the next declaration. Record UNKNOWN when observation stops. This is not automatic state sensing.

No numeric emission factors are invented. Add the applicable source, units, activity basis and uncertainty. CCTV motion is not proof of electrical power, fuel use or emissions. CO₂ and CO₂e estimates are labelled separately.

## Supabase database (optional)

Local SQLite works without a Supabase account. To configure Supabase, privately edit `.env` using the exact **Connect → Session pooler** details from your dashboard:

```dotenv
DATABASE_URL=postgresql+psycopg://DASHBOARD_USER:ENCODED_PASSWORD@EXACT_POOLER_HOST:5432/postgres?sslmode=require
DATABASE_SCHEMA=zenith_private
```

Do not use the placeholder host literally. Percent-encode reserved characters in the password. Standard `postgresql://` URLs are normalized to the installed psycopg driver; Supabase connections require SSL in the backend. A publishable/anon key is not the database password.

The private schema must not be exposed through Supabase's public Data API. Supabase Auth/Storage browser adapters are **not implemented**. Evidence still resides on the backend disk. See `docs/DEPLOYMENT.md` for connection, security and migration caveats. A failing hostname/password blocks cloud startup; use `--local` deliberately rather than silently falling back.

## NVIDIA key (optional future vision review)

Store it privately in backend `.env`:

```dotenv
NVIDIA_API_KEY=YOUR_PRIVATE_API_CATALOG_KEY
```

Get an API Catalog key at https://build.nvidia.com/ from an image-capable model's **Get API Key** option. No `VITE_` or `NEXT_PUBLIC_` prefix for this secret. Hosted vision integration is not enabled merely by setting the key. Local YOLO is already functional without it. A vision LLM does not replace reliable timestamps, tracking, explicit event rules or sourced carbon calculations. See `docs/VISION_API.md`.

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
