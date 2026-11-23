# Demo footage sources

The application now has a **Demo Footage** navigation option with external dataset/download links. The provider's dataset is not secretly included in the release or automatically imported into a private operator workspace.

It also includes three small, separately attributed Wikimedia source excerpts (people, traffic and a conveyor), with direct playback/download and an authenticated **Use in studio** action. See `public/examples/ATTRIBUTION.md` for authors, exact source pages, licenses, adaptations and disclaimers. The clips are VP9 WebM: 3.67 s people, 12 s traffic and 5.8 s equipment activity. Original downloads stalled; only complete decodable initial excerpts were re-encoded. No frames were fabricated to reach a target duration, and no incomplete source downloads are included in the repository.

Metadata was checked through Kaggle's public dataset API. An uploader's license label is not independent verification of all original footage rights. Review original terms, consent and citation requirements before a public presentation or redistribution. Kaggle may require login/terms acceptance. Never put Kaggle credentials into Zenith.

| Source | Reported size / license | Use and limitations |
|---|---|---|
| [Highway Traffic Videos](https://www.kaggle.com/datasets/aryashah2k/highway-traffic-videos-dataset) | ~63 MB; uploader lists CC0 | Fixed highway CCTV; description credits Washington State DOT and requests Chan/Vasconcelos citation. It reports a corrupted first frame; inspect/trim before upload. [ZIP download](https://www.kaggle.com/api/v1/datasets/download/aryashah2k/highway-traffic-videos-dataset) responded with ZIP content to a ranged GET when checked. No clip was downloaded, bundled or inference-validated. |
| [AAU RainSnow](https://www.kaggle.com/datasets/aalborguniversity/aau-rainsnow) | ~3.39 GB; CC BY 4.0 | RGB/thermal sequences and frame-pair annotations; attribution/citation needed. Prepare a short RGB clip. Not a lightweight one-click demo video. |
| [Multiple Cameras Fall Dataset](https://www.kaggle.com/datasets/soumicksarker/multiple-cameras-fall-dataset) | ~3.78 GB; “Other” license | Research reference only until rights are clarified. Falls and normal activities; collapse detector remains unavailable in this build. |

For zone and equipment demos, prefer an original consenting fixed-camera recording. Include a walk-past/normal-operation comparison so you can manually understand false alerts. Select 10–30 seconds and remain within 100 MB / 180-second default limits. Video archives, frame folders, MATLAB arrays and dataset annotations are not directly accepted by the upload endpoint.

No emission factors can be recovered reliably from these datasets. Traffic factors, segment length, fuel/power/load/runtime and data provenance must still be configured independently.

## One-click walkthrough

Connect the dashboard to a backend with a live worker and select **Demo footage → Run automatic demo**. The dashboard imports the three bundled clips in order and submits real jobs with preset geometry. The results show the safety observations, vehicle crossings, equipment motion and carbon previews. You can open each source video or jump to a timestamp from the result.

Traffic, visible equipment motion, metered kWh and litres appear as separate calculation examples. Demo factors and operator inputs are illustrative and the previews do not enter the carbon ledger. The demo does not opt in to hosted vision or send email. Imported footage and completed runs appear in the same workspace as manual runs.

Use **Calculate carbon** on a completed traffic or equipment run to work with its counts or runtime and visible source evidence. For measured electricity, select **Metered energy (kWh)** and describe the interval in the activity basis. A linked equipment run can provide visual context for that interval. Record your own meter reading and factor for a site estimate.
