# Rule proposals from a description

`POST /api/proposals` turns one plain-English instruction into a reviewable rule draft. It never starts a run, adds recipients, or executes model-supplied code.

## Request

```json
{
  "instruction": "Alert when someone stays in the loading bay for more than 10 seconds.",
  "source_id": "optional source UUID",
  "vision_provider": "nvidia | local (optional)",
  "vision_consent": false
}
```

- Without `source_id`, the endpoint keeps the legacy behaviour: it returns only `capability`, `dwell_seconds`, `parser`, `model` and `warnings`. No geometry.
- With `source_id`, the endpoint checks ownership, samples up to eight frames from the saved clip, and returns a validated rule draft.
- `vision_provider` is only `nvidia` or `local`. Hosted NVIDIA proposals additionally require `VISION_SEND_TO_THIRD_PARTY=true` and `vision_consent: true`. TypeSafe/Jev is not used for geometry proposals.
- `ZENITH_PROPOSAL_TIMEOUT` defaults to 60 seconds and is bounded to 5–180.

## Response

The response is a `Rule` draft with these fields removed: `confirmed`, `recipients`, `recipient`. It adds:

| Field | Meaning |
|---|---|
| `rationale` | One sentence explaining where the proposed region came from |
| `uncertainties` | Up to five short limitations |
| `parser` | `sampled-footage proposal` or `vision model proposal` |
| `model` | Detector checkpoint name, vision model name, or motion fallback |
| `warnings` | Fallbacks and review requirements |

Geometry by capability:

- `zone` / `machine_activity`: 3–12 normalized `[x, y]` points forming a polygon.
- `traffic`: exactly two points for one gate. Four-point two-gate rules still need an operator to add Gate B and enter `segment_metres`.
- `action`: empty points; the action model watches the full frame.

Returned settings include `dwell_seconds`, `confidence`, `image_size`, `iou_threshold`, `analysis_fps`, `vehicle_classes`, `motion_threshold` and `action_confidence`. The operator still has to review and confirm the rule before `/api/runs` accepts it.

## Proposal backends

1. **Detector/motion (default, offline):**
   - Zone: union of person boxes across sampled frames, with a central/full-frame fallback.
   - Traffic: gate placed across the principal axis of vehicle centres.
   - Machine activity: largest sustained pixel-motion contour.
2. **Vision model (optional):**
   - Sends one sampled frame and a strict JSON-only prompt.
   - Validates the returned points, settings and vehicle classes against `schemas.Rule`.
   - Falls back to the detector/motion draft and adds a warning if the request fails or returns unusable geometry.

Neither backend is authoritative. Sparse frames are not continuous coverage, and a proposed region is not a survey or camera calibration.

## Frontend wiring in the current tree

- `src/types.ts` defines `RuleProposal`.
- `src/features/workspace/Pages.tsx` contains the functional Overview, Studio, Incidents, Carbon and Reports pages restored from the last committed UI. `src/App.tsx` mounts them inside the newer sidebar/header shell.
- In `Studio`:
  - The **Describe what to detect** panel is the primary control and sits above the analysis modes.
  - `propose()` sends `instruction`, `source_id`, and `vision_provider`/`vision_consent` only when the configured provider is `nvidia` or `local` and available. NVIDIA additionally needs the operator consent checkbox; without it the request stays detector-only.
  - The response is applied to capability, points, dwell, name and detector settings, then confirmation is cleared.
  - An `appliedProposal` ref lets the geometry/reset effect keep the proposed points when a proposal changes the capability, instead of immediately replacing them with the generic suggestion.
  - Manual drawing, Undo/Clear, the coordinate editor and Reset suggestion remain available but are not required.
- Proposal styles live in `src/workspace.css` (`.instruction-primary`, `.proposal-consent`, `.proposal-summary`), which `src/main.tsx` imports together with the base and readability layers.

## Verification status

- `npm run build` passes with the current tree.
- `python -m py_compile backend/proposal.py backend/main.py` passes.
- `scripts/smoke_proposal.py` exists for the detector/motion path but was not run in this pass.
- The vision proposal path is wired but not live-tested because no vision provider is configured on this machine.
