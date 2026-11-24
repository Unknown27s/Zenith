# YouTube live → YOLO triggers → Telegram, with optional Jev review

Use only a livestream you are authorized to process and share with these providers.
This is **bounded, delayed clip analysis**, not an uninterrupted live safety service.

## Configure

Install/update backend dependencies in your Python 3.12 environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

Paste YouTube URLs directly in **Cameras & live streams**. They are saved per
workspace; adding a camera needs no environment change or restart.

Put only integration credentials/settings in your private `.env` (never use a `VITE_` prefix):

```dotenv
TELEGRAM_BOT_TOKEN=YOUR_BOTFATHER_TOKEN
ZENITH_TELEGRAM_CHATS=YOUR_NUMERIC_CHAT_ID
TELEGRAM_SEND_EVIDENCE=true

# Optional advisory Jev review:
VISION_PROVIDER=typesafe
TYPESAFE_API_KEY=YOUR_TYPESAFE_KEY
TYPESAFE_MODEL=jev-1.14.0
VISION_SEND_TO_THIRD_PARTY=true
VISION_MAX_FRAMES=3
VISION_TIMEOUT=30
```

Press Start in your Telegram bot chat first. Restart both API and worker after
changing configuration. Leave `VISION_PROVIDER=off` if you only want YOLO triggers
and Telegram. Jev is not required for detection or sending notifications.

## Present

1. Start Zenith with `python start.py`. Open **Health & settings → Run health checks**.
   These independently test the API, database, worker heartbeat, clip quota, model-list
   access and (with an administrator key) Telegram bot connectivity. No alerts or AI
   evidence requests are sent. Use **Check stream frame** separately to test one frame,
   or **Send test Telegram alert** to explicitly confirm a real setup message.
2. Open **Cameras & live streams**, enter a name and permitted YouTube live URL,
   confirm permission and click **Save camera & open**. Repeat for additional inputs.
3. On the separate camera page, confirm permission and **Start YOLO preview**.
   Same-frame person/vehicle boxes appear on a sampled stream (at most 2 FPS).
   This preview does **not** trigger alerts.
4. In the camera's **Incident rule & clip analysis** section choose **Zone monitoring**,
   set duration, select your Telegram recipient and cooldown, then **Get preview frame**
   and draw that camera's zone. Different cameras can use different rules and recipients.
5. If using vision review, explicitly consent to sharing incident evidence for this
   stream session. Confirm the preview, settings and recipients, then **Start clip analysis**.
6. Actual rule-triggered incidents appear with evidence; the existing outbox sends
   Telegram alerts, with a saved image only when `TELEGRAM_SEND_EVIDENCE=true`.
7. Optional vision review runs separately after clip analysis. Inspect its decision in
   the incident review. Alerts do **not** wait for vision review and are not suppressed by it.
8. Stop both the YOLO preview and rule capture when the demonstration ends.

Up to six camera inputs can be saved per workspace; three bounded captures and
two annotated previews can run at once on the single-process backend. Previews
share a serialized inference slot; incident clips share the existing single worker,
three-job queue and storage limits. This is a small demo, not a scalable CCTV server.
Saved camera names, public watch URLs and last-started rules persist in the private
database. Browser edits before starting a rule are not saved. Running sessions do
not automatically resume after restart. Unviewed previews expire after 90 seconds.

The legacy server-configured `ZENITH_YOUTUBE_URL`, RTSP and HLS input still works
in Studio. Browser-entered arbitrary RTSP/HLS/internal URLs are deliberately not
accepted; this avoids turning the public API into a private-network URL fetcher.

Jev's `Choice` question returns `visible`, `contradicted` or `unclear`, plus confidence
and probabilities. Zenith stores these typed values and displays a template-based
interpretation; Jev is not generating an explanation. For uploaded-video sampled
reviews, the candidate is a generic visible condition requiring human review,
not a verified whole-video summary or an independently detected incident.

## Limits and troubleshooting

- TypeSafe labels [image support](https://docs.typesafe.ai/images) experimental.
  Calibrated probabilities do not guarantee a correct individual decision.
- YouTube requires `yt-dlp` stream resolution. Supported inputs are HTTPS watch,
  `/live/VIDEO_ID`, or `youtu.be/VIDEO_ID` links to currently live public videos.
  Account-restricted streams, channel landing pages and finished broadcasts are not supported.
  Some YouTube streams need a JavaScript runtime or are blocked by the host network.
  Update yt-dlp if extraction breaks; no login/cookie or access-control bypass is implemented.
- YouTube playback latency, clip recording, queueing and inference all add delay.
  Tracking resets every clip. Capture gaps can miss events; this is not full coverage.
- Only existing supported rules are enabled: zones, traffic, experimental motion,
  and possible fight/fall with a separately installed action checkpoint.
  Jev does not add validated fire, PPE, crowd or other incident detectors.
- The local source/storage limits still apply: capture stops at the source/storage
  cap. Archive/manage footage before another run. Retain a labelled local replay
  for network failures during a presentation.
- Telegram acceptance is not verified delivery. Ambiguous retries can duplicate
  messages; incident cooldowns do not provide exactly-once provider delivery.
- Evidence is sent separately to Telegram and (only with consent) TypeSafe.
  Saved public watch URLs are shown only to their owning workspace. Bot/API keys,
  RTSP credentials and temporary signed playback URLs are never returned by the API.
- Offline checks: `.\.venv\Scripts\python.exe scripts/smoke_jev.py`.
  These mock external providers and do not establish real-stream/model accuracy.
- Frontend checks: `node scripts/smoke_health_browser.mjs` with a dashboard server
  on `http://127.0.0.1:5182` and Playwright available. Override `ZENITH_UI_URL`,
  `PLAYWRIGHT_MODULE` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when needed.
  All API requests in this browser test are mocked.
- Camera checks: `.\.venv\Scripts\python.exe scripts/smoke_cameras.py` exercises
  ownership, URL validation, per-camera capture, and real local YOLO annotation on
  a bundled sample frame. `node scripts/smoke_cameras_browser.mjs` checks URL entry,
  dedicated pages, independent rules and preview controls using mocked APIs.
  Neither test validates a real YouTube connection or Telegram delivery.
