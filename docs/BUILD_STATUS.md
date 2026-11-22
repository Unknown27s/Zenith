# Build status

## Implemented
- Eight responsive pages: overview, monitoring studio, demo footage, incidents, carbon, reports, separate How It Works, connection/settings.
- Operator-key authenticated API with ownership checks, uploads/preview, run queue, incident decisions, notification outbox, carbon ledger, machine state declarations and PDF/CSV.
- File-analysis worker for YOLOv8 Nano + ByteTrack zone dwell and vehicle counting; experimental region-motion equipment activity.
- Industrial electricity/fuel calculations, class-specific traffic estimates, required factor sources and activity assumptions. CO₂ and CO₂e shown separately.
- Operator-declared ON/OFF/UNKNOWN register with transition notes and accumulated declared-ON hours. This is not automatic machine-state recognition.
- Laptop launcher, optional PostgreSQL Compose deployment, code-only Colab package builder and notebook with local interactive API usage plus optional permitted HTTPS tunnel.

## Evidence obtained
- `npm install`: completed; reported zero known vulnerabilities in the frontend dependency audit at install time.
- `npm run build`: TypeScript and Vite production build completed successfully.
- Python source compilation: completed without syntax errors.
- Colab notebook: valid JSON; all Python code cells compile. Not executed on Colab.
- Actual Firefox screenshots reviewed: desktop overview, monitoring studio and carbon; phone-width overview and How It Works. No generated image was used as UI verification.
- Frontend development server responds on `http://127.0.0.1:5173`.
- CPU PyTorch and torchvision installed in `.venv`; official YOLOv8 Nano checkpoint downloaded as `yolov8n.pt`. Checkpoint loaded successfully as a detection model: 129 layers and 3,157,200 parameters. OpenCV imported successfully and reported 4.14.0. Model loading is not a footage-accuracy result.
- API-only runtime started successfully on `http://127.0.0.1:8001`. `/api/health` returned OK. Authenticated status, empty carbon ledger and equipment register returned successfully. Status without credentials returned HTTP 401.
- A plain-English proposal manually submitted to the actual API returned the zone capability, a two-second dwell and confirmation warnings.
- An actual empty-workspace PDF and CSV were generated through authenticated endpoints. The PDF was opened and its missing-data disclosures verified (`/tmp/opencode/zenith-workspace-report.pdf`). No emission factors, clips or operational values were fabricated for this check.
- Full ML dependencies finished installing. The video-capable API responds on `http://127.0.0.1:8000`; the analysis worker is running and the authenticated status endpoint reported a fresh heartbeat. Leave the frontend API origin blank to use its development proxy, or enter `http://127.0.0.1:8000`. The API-only fallback on port 8001 is not needed for video workflows.
- End-to-end video inference remains unverified because no representative footage was supplied. Colab remains unexecuted.
- Readability revision: locally bundled Inter 400/500/600/700 fonts, 14–16 px primary interface/body text, larger supporting text and darker high-contrast colours. Desktop and phone screenshots reviewed after the revision.
- Demo Footage page includes Kaggle dataset/terms links and a highway-traffic ZIP link verified by a ranged HTTP GET returning ZIP content. No dataset footage was bundled or detector outcomes claimed.
- One-command `python start.py` launched the built frontend, API and worker together on loopback port 8002 with a separate temporary local data directory. Root HTML and health endpoint responded; authenticated status reported a fresh worker heartbeat. This runtime check did not connect to Supabase or modify the operator's actual database.
- `artifacts/zenith-portable.zip` was generated and inspected: built UI and launcher present, no `.env`, model checkpoint, data directory or virtual environment included. Windows/macOS execution remains unverified.
- Vercel frontend configuration and deployment instructions added. No Vercel deployment was performed. Supabase public project values were saved locally at the user's request; backend `DATABASE_URL` remains the separate prerequisite for an actual PostgreSQL connection. Supabase Auth and Storage adapters remain unimplemented.

Temporary screenshots: `/tmp/opencode/zenith-overview.png`, `/tmp/opencode/zenith-studio.png`, `/tmp/opencode/zenith-carbon.png`, `/tmp/opencode/zenith-mobile.png`, `/tmp/opencode/zenith-how-mobile.png`.

## Not established
- Detector/tracker accuracy, positive/negative alert outcomes or equipment-proxy accuracy: no representative user footage was supplied.
- Actual email sending/delivery: no credentials or approved destination supplied; no email was sent.
- Gemini/vision-agent review, collapse/pose, PPE, crowd/exit obstruction, live camera connectors, escalation, retention automation and multi-tenant SaaS auth: not implemented.
- Persistent Colab availability, Colab GPU compatibility, ngrok account policy eligibility and deployed Docker Compose operation: not established.
- This is a first implementation, not a completed/validated production safety or emissions-monitoring service.

No test cases, test files or testing code were created. Verification is limited to compilation, build, browser inspection and any explicitly recorded manual runtime checks.

## Latest backend correction and actual video evidence
- Reproduced the active UI/API mismatch: status returned 401 without a session and the older port-8000 API returned 405 for sample import. Retired the agent-launched older instances and started the latest single-command backend/worker with explicit local SQLite. The saved Supabase URL was not overwritten.
- Added opt-in loopback-only, exact-origin checked, HMAC-signed HttpOnly local sessions. The laptop launcher enables them; public/remote access still needs the operator key. `--require-key` disables automatic local access before tunnelling.
- Three actual source excerpts are bundled with credit/license/change notices: people (3.67 s), traffic (12 s), equipment activity (5.8 s), in VP9 WebM. All imported successfully through the current API in a temporary local workspace.
- Actual browser interaction against the corrected primary app connected automatically, imported the people clip, drew/confirmed a fictional demonstration zone, executed real YOLOv8 Nano/ByteTrack inference and completed run `ab4dcc7a-75cf-445c-95a2-21845df254c9`. The worker saved one rule observation. This is one observed run, not a general accuracy/false-positive claim.
- The same browser then selected/uploaded the actual traffic example through the file input; the upload returned success and its source preview appeared. No automated test files were added.
- Input-specific editable confidence, image size, NMS IoU, sampled rate and vehicle classes now reach the worker and are recorded with runs/reports. Actual people run settings: confidence 0.35, 640 px, IoU 0.7, requested 8 FPS, person-only class filter. Traffic/equipment inference accuracy is not established by successful file import.
- The user-supplied Supabase connection URL is present privately, normalized to psycopg and SSL-required at runtime. Connection attempts failed because its configured pooler hostname did not resolve; the separate Supabase project API hostname did resolve. No Supabase schema creation succeeded. Local SQLite remains the demonstrated working backend.
- The website was opened at `http://127.0.0.1:8000/#demos` after verification. Vercel frontend configuration and deploy button are included; no Vercel deployment is claimed.
