# Zenith laptop-first MVP

## Implementation plan
1. Build responsive React pages: overview, monitoring studio, incidents, carbon, reports, How It Works, connection settings.
2. Add authenticated FastAPI endpoints, durable SQLAlchemy storage, bounded uploads and a separate leased analysis worker.
3. Implement real YOLOv8/ByteTrack zone and traffic analysis, plus explicitly labelled experimental ROI motion observation for equipment. No fabricated samples or metrics.
4. Add evidence, acknowledgement history, PDF/CSV, notification previews and optional configured email.
5. Include an optional Colab launcher using the upstream pyngrok/FastAPI pattern. Laptop is primary; managed Colab is temporary and subject to provider policy.

## Decisions and tradeoffs
- SQLite for a single laptop/Colab operator; PostgreSQL in Compose. One worker by default. This is not production multi-tenant SaaS.
- One operator API key, generated locally or provided through environment. Its SHA-256 fingerprint scopes every stored object. No anonymous evidence URLs. Keys entered in the UI stay in session storage.
- Plain-English configuration is a constrained local parser, not a vision LLM agent. Supported proposals must be reviewed and geometry confirmed. Unsupported capabilities are rejected.
- Models are mapped from an allowlisted capability registry, never downloaded from a user-supplied URL. YOLO weights licensing must be reviewed before commercial use.
- No camera/NVR credential ingestion in this MVP. File analysis first; camera connector, pose/PPE, automatic escalation and production health monitoring remain future work.
- Machine motion is an activity proxy, not electrical on/off detection. Carbon can use operator-provided runtime or an explicitly accepted motion proxy. Missing movement does not establish that a machine is off.
- An operator-declared equipment register records ON/OFF/UNKNOWN with timestamped notes. Unknown intervals do not accrue ON time. Stale ON declarations may overstate runtime; this is not a sensor integration.
- Electricity: hours × kW × load fraction × kg CO2e/kWh. Fuel: litres × kg CO2e/litre. Traffic: class counts × distance × g CO2/vehicle-km ÷ 1000. Factors and sources are required; no invented defaults. These estimates do not constitute a complete industrial inventory.

## Security checkpoint
- Authentication and fingerprint ownership applied to sources, jobs, events, artifacts and carbon entries.
- Upload size, extension, decoded dimensions, duration and queue limits; filenames regenerated. No arbitrary URLs/paths or executable user rules.
- Parameterized ORM queries and Pydantic validation. React text escaping; no raw HTML. Email recipients allowlisted in environment, never selected by language alone.
- CORS explicit local origins; HTTPS required for non-loopback connections in UI. Secrets stay server-side. No unauthenticated static evidence mount.
- Single local operator is not customer-ready tenant auth. Public deployment requires proxy body/rate limits, TLS, tenant identities, retention, migrations and operational hardening.

## Acceptance and limitations
A real uploaded clip can be previewed, annotated with user-confirmed geometry, queued, processed and reviewed; incidents acknowledged; reports downloaded; carbon inputs recorded with provenance. Empty states and unavailable integrations remain honest. No test files or testing code per user instruction; build, syntax and manual runtime checks only.
