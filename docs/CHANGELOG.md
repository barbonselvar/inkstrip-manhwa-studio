# Inkstrip release changelog

## Unreleased — Phase D vector geometry and anchor editing

- Exact cubic subdivision and bounded-error arc metrics/inversion.
- Native open/closed segment-subdivision transaction with history/native tests.
- Precise native curve insertion from the canvas and numeric parameter/arc
  distance controls; source-space segment lengths.
- Corner/smooth/symmetric handles, numeric anchor/handle coordinates, touch-aware
  Direct Select, Alt to break coupling, path reversal and guarded anchor deletion.
- Existing history/native/export/Chapter integration and desktop/320px/390px
  Chromium regression suite. Pathfinder/compound paths/artboards/text-on-path and
  the remaining vector phase are still pending; no Phase D production release.
- [Phase D status and remaining scope](PHASE_D_VECTOR_ENGINE.md).

## Phase C — editable gradient, effect and adjustment layers

Released through [PR #2](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/2)
as normal merge `e025d3995999c05921a057b601f88f44dea52460`. The existing Vercel
production domain serves the tested release; live desktop/320px/390px Chapter,
Raster/Vector, appearance, AI single/batch recovery and 3D checks passed.

- Standalone linear/radial gradient layers with editable color/opacity stops,
  presets, angle, scale and center; shared transform/mask/clip/layer behavior.
- Seven editable layer effects with real alpha processing, style order,
  group-safe compositing and padded source-resolution rendering.
- Independent adjustment layers with backdrop-aware masking, clipping, opacity
  and blend behavior; safe grouping/merge guards.
- Native save/reopen, history, original-source retention and raster exports.
- Algorithm and Chromium regressions, including mobile 320px/390px interactions.
- Explicit limits and contracts: [Phase C layers](PHASE_C_LAYERS.md).

Previous milestones are retained: selection and advanced layers, traditional
repair and pressure/smoothing, non-destructive crop/resampling, affine group and
individual projective/warp transforms, seven per-layer color operators, Chapter
integration, existing AI workflows and 3D homepage.
