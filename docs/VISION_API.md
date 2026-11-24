# Vision evidence review

YOLOv8 + ByteTrack and the configured rules generate incident records. The optional vision model adds a text interpretation of saved evidence frames. It has no authority over detections, counts, notifications or operator decisions.

Set the variables in the backend environment or the corresponding notebook settings. Restart the API and worker together after changing the provider.

| Variable | Default / purpose |
|---|---|
| `VISION_PROVIDER` | `off`, `nvidia`, or `local` |
| `NVIDIA_API_KEY` | Server-only NVIDIA API Catalog credential |
| `NVIDIA_VISION_MODEL` | `nvidia/nemotron-nano-12b-v2-vl` |
| `VISION_SEND_TO_THIRD_PARTY` | `false`. NVIDIA additionally requires explicit operator consent per incident or run. |
| `LOCAL_VLM_BASE_URL` | `http://127.0.0.1:11434/v1`. Use loopback HTTP or a trusted private HTTPS endpoint. |
| `LOCAL_VLM_MODEL` | `qwen2.5vl:3b` |
| `LOCAL_VLM_API_KEY` | Optional bearer token for an authenticated compatible local provider |
| `VISION_TIMEOUT` | 30 seconds. Supported range 1–90. |
| `VISION_MAX_FRAMES` | 1 per review, with the during frame preferred. Increase to 2 or 3 for a provider/model that supports multiple images. |

Use **Check model connection** in Settings to query the provider's model list. This sends no images and exercises no chat completions. An HTTP response alone does not confirm model access: the check distinguishes a reachable endpoint from a listed model. Exact model access and image capabilities can vary. The [NVIDIA API reference](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-nano-12b-v2-vl-infer) documents the default hosted model. See [Ollama's model page](https://ollama.com/library/qwen2.5vl) for the default local model.

Opt in from **Monitoring studio** to queue reviews for up to the first three incidents a run generates. The worker processes reviews after analysis when it is free. From **Incidents & evidence**, request or rerun review for a single incident. Provider failures leave the original evidence and decision history available. The worker makes one completion request per review, validates the result against a strict JSON schema, and saves its result or failure to the incident's review record. It does not retry inference automatically.

Each completed run also saves a deterministic **analysis summary** from its measured rule outputs, even with hosted vision disabled. With an explicitly approved provider and per-run consent, the worker separately queues one optional AI summary of bounded sampled source stills and the saved rule results. Find both in **Video findings**. Neither is a full-frame audit or an instruction to take autonomous action. Without NVIDIA sharing permission, no video frames are sent off the backend.

Authenticated routes are `GET /api/vision/status`, `GET /api/events/{event_id}/review` and `POST /api/events/{event_id}/review`. The POST body accepts `provider` and `consent`. The existing event list includes the latest review so the dashboard can update through its existing polling.

## Geometry proposals

`POST /api/proposals` can draft a rule region from one sampled frame when `source_id` and `vision_provider` are supplied. Hosted providers require `VISION_SEND_TO_THIRD_PARTY=true` and `vision_consent: true`; local providers use the configured loopback or private endpoint. The returned geometry and detector settings are validated against the same rule schema, contain no recipients, and still require operator confirmation. Set `ZENITH_PROPOSAL_TIMEOUT` (default 60 seconds, bounded 5–180) to limit the wait. If the vision request fails, the endpoint falls back to the detector/motion proposal and reports that fallback in `warnings`; it never silently treats a model answer as confirmed.
