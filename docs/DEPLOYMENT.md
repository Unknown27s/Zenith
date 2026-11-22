# Portable startup, Vercel and Supabase

## One command on a laptop

```sh
python start.py
```

On systems where Python is named `python3`, use `python3 start.py`. On Windows the equivalent may be `py -3.12 start.py`.

**Prerequisites are still real:** Python 3.12 (or installed `uv`, which can obtain 3.12), internet access/disk space for first-install ML packages, and Node.js 22+ only when building the frontend from source. Python 3.11/3.13 are accepted if already used by the local environment, but 3.12 is recommended. Runtime wheel availability depends on OS/CPU architecture. This is designed for Windows/macOS/Linux; only the current Linux environment has been exercised.

The launcher creates/uses `.venv`, installs CPU inference dependencies, builds/uses `dist`, initializes durable state and starts FastAPI plus one worker. It binds to loopback only. The backend serves both the built frontend and API, so there is no Vite server/port to manage. Open `http://127.0.0.1:8000/#settings`, leave API origin blank, and use `data/operator.key` (unless overridden by `ZENITH_API_KEY`). Do not copy another operator's private data or key when sharing the application.

Initial setup can take several minutes and substantial disk/network usage. Dependency installation happens inside the project, not global site-packages. First inference downloads the official pretrained weights if absent. Do not run separate API/worker instances against the same source jobs at the same time.

Options:
- `python start.py --port 8002` — use another available port.
- `python start.py --rebuild` — rebuild after frontend source changes (requires Node 22+).
- `python start.py --setup-only` — install/build without starting services.
- `python start.py --no-browser` — do not open a browser automatically.
- `python start.py --local` — deliberately override an unavailable cloud URL with local SQLite, without editing `.env`.

Keep `.env` unset for SQLite; it works without a hosted database account. An existing occupied port causes a clear error rather than terminating another service. Ctrl+C stops the launched API and worker. The default CPU setup is deliberately portable, not optimized for each GPU.

## Share a portable archive

```sh
npm run build
python scripts/package_portable.py
```

Share `artifacts/zenith-portable.zip`. It includes the frontend build, application source and setup instructions—not `.env`, API keys, databases, footage, evidence, model weights or installed dependencies. On the other machine, extract it, open a terminal in `Zenith/`, then run `python start.py`. Node is not needed for that already-built frontend unless rebuilding. Do not set a remote `VITE_API_BASE_URL` while making a laptop-only portable build.

The small public, licensed **example clips** and their attribution notices are included; the excluded footage/evidence above refers to private uploaded/customer data. Keep the example footage's license notices when sharing the archive.

This is not a self-contained executable: Python/uv and first-install internet are still required. Signed native installers would be a later packaging step.

## Vercel: frontend deployment

The repository includes `vercel.json` for the Vite frontend. Hash navigation needs no catch-all path rewrite. No Vercel project/deployment has been created automatically.

1. Create your own GitHub repository and push the source (never `.env`, data, secrets or model files). This workspace is not currently a git repository; no repository or commit has been created for you.
2. In Vercel, import the repository. Use framework **Vite**, build `npm run build`, output `dist`.
3. Optionally set public **`VITE_API_BASE_URL=https://YOUR_BACKEND_ORIGIN`** before building. It is an origin only, without `/api`. This value is public; do not put a provider/database key in any `VITE_` variable.
4. Keep the persistent FastAPI/worker on your laptop or a suitable persistent compute host. The browser connects **directly** to that HTTPS backend; video uploads do not pass through a Vercel Function.
5. If using your laptop for an external demo, create an authenticated HTTPS tunnel with your chosen provider. Keep the app's operator bearer key protection and upload limits. Add the exact Vercel site origin to backend `ZENITH_ORIGINS`, then restart the backend. A static frontend stays available when the laptop is off, but analysis/data will not.
6. In the deployed site Connection Settings, confirm the backend origin and enter the operator key locally. Provider/database credentials remain server-side. API origin can also be overridden for that browser tab.

Vercel Functions currently have a 4.5 MB request/response payload limit and non-persistent filesystem state. They are not a drop-in host for this 100 MB upload endpoint, SQLite/evidence directory or long-running worker. An NVIDIA key does not change those platform constraints. A public tunnel plus the single-operator demo is not production tenant security; do not admit arbitrary customer footage.

## Recommended hosted database: Supabase

Supabase is the recommended next hosted path because it offers PostgreSQL, Auth and private object storage together. **Only SQLAlchemy/PostgreSQL connection support exists now. Supabase Auth and Storage adapters are not implemented.** Footage/evidence still live on the backend host, even when database records are remote. Neon would also work for PostgreSQL; it does not remove the need for separate evidence storage/auth integration.

For the persistent laptop backend:
1. Create a Supabase project. In **Connect**, choose **Session pooler (port 5432)** for IPv4-compatible access. Direct connections may require IPv6; do not blindly copy a direct IPv6-only hostname onto an IPv4-only laptop network.
2. Copy the exact host/user/port/database from the dashboard. Percent-encode reserved characters in the password.
3. Store the connection string in backend `.env`, changing its scheme to `postgresql+psycopg://` and requiring SSL:

```dotenv
DATABASE_URL=postgresql+psycopg://DASHBOARD_USER:ENCODED_PASSWORD@DASHBOARD_POOLER_HOST:5432/postgres?sslmode=require
DATABASE_SCHEMA=zenith_private
```

The placeholders above are format examples, not real credentials. No Supabase connection has been made or validated. The schema is created on first initialization if the database role has the required permission; otherwise pre-create it with an administrator and grant only the privileges needed. PostgreSQL now defaults to `zenith_private`; existing public-schema installations would need an explicit `DATABASE_SCHEMA=public` or a separately reviewed migration. No existing database was moved or modified.

**Keep `zenith_private` out of Supabase's exposed Data API schemas.** The ORM enforces operator ownership server-side; it does not create browser-facing Supabase RLS/auth policies. Do not grant public/anon/authenticated roles access to these private tables. A future browser-facing Supabase integration must add real identity/RLS/Storage policies first. Use a least-privilege runtime database role for production, with schema migrations managed separately.

Use a session pooler for this persistent SQLAlchemy worker. Do not substitute transaction pooler port 6543 without reviewing prepared-statement and locking behavior. Supabase database credentials/service-role secrets belong in backend environment only, never Vercel frontend variables. The current single-operator key is not a Supabase anon/publishable key.

## Vision LLM: useful, not the entire system

An NVIDIA vision model can optionally inspect selected preview/evidence frames and propose/explain supported rules. Provider integration is not enabled yet; see `VISION_API.md`. It should not supply unverified carbon factors, silently determine electrical power state, override operator decisions or serve as the sole continuous vehicle counter/dwell clock. Keep deterministic source timestamps, detector/tracker outputs, explicit rule confirmation and sourced emissions calculations.

## References checked
- https://vercel.com/docs/frameworks/frontend/vite
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/functions/runtimes
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/tables
