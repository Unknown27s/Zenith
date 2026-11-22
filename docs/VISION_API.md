# Vision model API keys

## Current application
YOLOv8 detection and ByteTrack run locally and need **no API key**. The current plain-English parser is local and constrained. Hosted vision-language review is not wired into this build; setting a provider key alone does not enable it.

## NVIDIA is an option
NVIDIA's API Catalog offers image/video-capable models that can provide an optional preview interpretation or evidence-review layer above the local detectors. They do not replace timestamp-based tracking/dwell rules or human confirmation.

Catalog/model references checked:
- https://build.nvidia.com/explore/vision
- https://build.nvidia.com/nvidia/nemotron-nano-12b-v2-vl (text/image/video capable; candidate to evaluate, not established accurate for this CCTV use case)
- https://build.nvidia.com/meta/llama-3.2-90b-vision-instruct (image/text)
- https://docs.nvidia.com/nim/nvclip/latest/getting-started.html (API Catalog key creation)

Sign in at https://build.nvidia.com/, open a supported vision model, then select **Get API Key → Generate Key**. Existing NVIDIA API Catalog keys can be used if their permissions, quota and model access allow it. An NGC registry/container-download key is not automatically equivalent to a hosted inference key. Use the model page's current API example and model ID; not every model supports the same endpoint, number of images or structured-output features.

For a future backend integration, keep the key privately in the backend `.env` as `NVIDIA_API_KEY`. Never put it in a `VITE_` variable, browser settings, screenshots, chat or source control. A key is a credential, not a model selection. Choose the image-capable model separately. The NVIDIA vision card above does not advertise native structured output; application-side validation and bounded failure handling would be required.

Key validity/access has **not** been checked with an external API request. No NVIDIA/NGC/Gemini key was present in the project's loaded environment at the time of review. No images were sent to NVIDIA. Before integration, obtain permission to send CCTV evidence to that provider and review its applicable data/privacy/usage terms.
