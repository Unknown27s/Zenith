# Run Zenith on Google Colab

The notebook can run FastAPI, SQLite, the file-analysis worker and the same dashboard from one bundle. For the hybrid demo, use Colab for YOLOv8 + ByteTrack and optionally send approved incident stills to NVIDIA for interpretation. Start with vision off to verify the workflow without hosted inference or a local VLM download.

## Prepare the bundle

Run `npm ci` and `python scripts/package_colab.py` from the repo. The script builds the dashboard and writes `artifacts/zenith-colab.zip` with the backend, static site and licensed demo clips. It excludes credentials, operator data, model weights and installed dependencies.

## Start the demo

1. Open `notebooks/Zenith_Colab.ipynb` in Colab. Select a GPU runtime if available.
2. In Colab Secrets, add a random `ZENITH_API_KEY` of at least 24 characters and enable notebook access. Keep the value available to enter in the dashboard. Add `NGROK_AUTHTOKEN` only if you will enable the tunnel.
3. Run step 1 and upload `zenith-colab.zip`. Run step 2 to start the API and worker. When tunneling is permitted, set `ENABLE_PUBLIC_TUNNEL = True` in step 2 before running the cell.
4. Open **Open the Zenith dashboard** from the notebook output, continue through the ngrok browser prompt if shown, and enter the operator key in **Connection & settings**. Leave **API origin** blank on this dashboard.
5. To use a separate Vercel or laptop frontend, set `FRONTEND_ORIGIN` to its exact origin before launching the backend. In that frontend's Settings, enter the printed HTTPS tunnel origin without `/api`, plus the operator key. Deploy the updated frontend code to get the new vision controls on Vercel.
6. Open **Demo footage → Run automatic demo** to analyze the three bundled clips and see carbon previews. For your own clips, choose a zone or line and confirm the rule before running analysis. When finished, run the cleanup cell. Export any reports you need first.

Read the [Colab FAQ](https://research.google.com/colaboratory/faq.html) before enabling a tunnel. Free managed runtimes restrict primarily using a separate web UI. Use the notebook-native cells for interactive processing when the tunnel is unsuitable, or run the laptop deployment for dashboard access. Colab resets can remove the database, evidence, and model downloads. A restart can change the tunnel URL. Use a fresh connection when needed.

## Vision settings

| Provider | Notebook settings |
|---|---|
| YOLO only | `VISION_PROVIDER = 'off'` |
| NVIDIA hosted | Add `NVIDIA_API_KEY` to Colab Secrets. Set `VISION_PROVIDER = 'nvidia'` and `ALLOW_NVIDIA_FRAME_SHARING = True` if approved for your footage. The operator still opts in before each incident review or run. |
| Local on Colab | Set `VISION_PROVIDER = 'local'` and `START_OLLAMA = True`. The default model is `qwen2.5vl:3b`, a 3.2 GB download. The notebook starts Ollama on loopback and processes vision jobs after file analysis. |
| Local on a separate machine | Set `VISION_PROVIDER = 'local'`, keep `START_OLLAMA = False`, and configure a private HTTPS model endpoint reachable from Colab. Add `LOCAL_VLM_API_KEY` if it requires bearer auth. |

For a Colab backend, `127.0.0.1` refers to the Colab VM. Use same-VM Ollama for the simplest local-provider demo. On the Lenovo B490 with 4 GB RAM, prefer using the laptop as the frontend. If you use a different laptop for local VLM inference, run the Zenith backend and Ollama on that laptop unless you already have private connectivity from Colab.
