# Demo footage sources

The application now has a **Demo Footage** navigation option with external dataset/download links. The provider's dataset is not secretly included in the release or automatically imported into a private operator workspace.

Bundled examples include pedestrian footage, a fixed-camera A40 motorway segment, a conveyor, boxing training, and a staged indoor fall. Each clip can be played, downloaded, and imported into Studio. See [the attribution notices](../public/examples/ATTRIBUTION.md) for source and license details.

Metadata was checked through Kaggle's public dataset API. An uploader's license label is not independent verification of all original footage rights. Review original terms, consent and citation requirements before a public presentation or redistribution. Kaggle may require login/terms acceptance. Never put Kaggle credentials into Zenith.

| Source | Reported size / license | Use and limitations |
|---|---|---|
| [Highway Traffic Videos](https://www.kaggle.com/datasets/aryashah2k/highway-traffic-videos-dataset) | Kaggle reports ~92 MB dataset; uploader lists CC0 | Fixed highway CCTV; description credits Washington State DOT and requests Chan/Vasconcelos citation. It reports a corrupted first frame; inspect/trim before upload. [ZIP download](https://www.kaggle.com/api/v1/datasets/download/aryashah2k/highway-traffic-videos-dataset) returned HTTP 404 from this environment on November 23, 2026. No Kaggle clip was bundled or inference-validated. Download via your own Kaggle session after checking reuse rights. |
| [AAU RainSnow](https://www.kaggle.com/datasets/aalborguniversity/aau-rainsnow) | ~3.39 GB; CC BY 4.0 | RGB/thermal sequences and frame-pair annotations; attribution/citation needed. Prepare a short RGB clip. Not a lightweight one-click demo video. |
| [Multiple Cameras Fall Dataset](https://www.kaggle.com/datasets/soumicksarker/multiple-cameras-fall-dataset) | ~3.78 GB; “Other” license | Research reference only until rights are clarified. Falls and normal activities. Zenith action mode requires the checkpoint exported by its training notebook. |

For zone and equipment demos, prefer an original consenting fixed-camera recording. Include a walk-past/normal-operation comparison so you can manually understand false alerts. Select 10–30 seconds and remain within 100 MB / 180-second default limits. Video archives, frame folders, MATLAB arrays and dataset annotations are not directly accepted by the upload endpoint.

No emission factors can be recovered reliably from these datasets. Traffic factors, segment length, fuel/power/load/runtime and data provenance must still be configured independently.

## One-click walkthrough

Connect the dashboard to a backend with a live worker and select **Demo footage → Run automatic demo**. The dashboard submits the zone, traffic and equipment jobs with preset geometry. It also analyzes the boxing training and staged fall clips when the action checkpoint is configured. **Use in studio** also prefills an editable line or region, so you do not need to draw one; inspect and confirm the suggestion before running. The results show the safety observations, completed vehicle traversals, equipment motion and carbon previews. You can open each source video or jump to a timestamp from the result.

Traffic, visible equipment motion, metered kWh and litres appear as separate calculation examples. Demo factors and operator inputs are illustrative and the previews do not enter the carbon ledger. The demo does not opt in to hosted vision or send email. Imported footage and completed runs appear in the same workspace as manual runs.

Use **Calculate carbon** on a completed traffic or equipment run to work with its counts or runtime and visible source evidence. For measured electricity, select **Metered energy (kWh)** and describe the interval in the activity basis. A linked equipment run can provide visual context for that interval. Record your own meter reading and factor for a site estimate.
