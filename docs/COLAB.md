# Optional Google Colab backend

**Primary deployment: your laptop.** Colab is an interactive notebook service, not persistent hosting. The included notebook runs the same API, SQLite database and worker. It also contains an optional pyngrok HTTPS tunnel for a runtime/provider plan where that use is permitted.

## Policy and availability
- Read https://research.google.com/colaboratory/faq.html before enabling a tunnel. Free managed runtimes restrict bypassing the notebook UI to interact primarily through a web UI. Unrelated web hosting is prohibited on managed runtimes. A paid plan is not blanket permission for SaaS hosting.
- Do not use keepalive tricks, circumvent runtime limits, or assume GPU availability. Use the notebook directly for interactive compute, or your laptop for the dashboard demo.
- The VM, SQLite data, uploads, evidence and model downloads may disappear on reset. Use consenting demonstration footage, not private customer footage. Do not expose the operator key in shared saved notebook output.
- There is no guaranteed uptime or fixed URL. Reconnect in Settings after the runtime/tunnel changes. Stop the tunnel and subprocesses when finished.

## Setup
1. Locally run `python scripts/package_colab.py` to create `artifacts/zenith-colab.zip`. This includes backend code only, not `.env`, keys, media or dependencies.
2. Upload `notebooks/Zenith_Colab.ipynb` to Colab. Select an appropriate runtime; GPU is optional.
3. Run the upload/install cells and upload `zenith-colab.zip` when prompted.
4. Launch the backend. The notebook generates a random operator key. Notebook-native upload/analysis is possible through the included direct API cell.
5. Only if permitted for your environment, enable the optional tunnel cell. Enter your ngrok auth token privately. Set `FRONTEND_ORIGIN` to the exact website origin (local default: `http://127.0.0.1:5173`) **before** starting the API.
6. In the laptop website's Connection & Settings, enter the HTTPS tunnel origin and notebook operator key. Do not append `/api`.
7. Run the cleanup cell when finished. Free ngrok request/transfer/account limits also apply.

The notebook defaults to preview-only email. Configure approved recipients and Resend in the runtime environment before starting if actual delivery is intended. External services receive footage/data only when explicitly integrated; Gemini review is not implemented in this version.

## GitHub references checked
- Upstream pyngrok FastAPI and Colab integration patterns: https://github.com/alexdlaird/pyngrok/blob/develop/docs/integrations.rst
- Existing community example located: https://github.com/tonezzz/fastapi_colab (repository has no declared license; no code copied).

Our notebook is an independent launcher for Zenith, not a copied third-party application. A tunnel URL is only transport: every private API request still needs the operator bearer key.
