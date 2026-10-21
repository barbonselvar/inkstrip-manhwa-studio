# Inkstrip release changelog

## Phase C — editable gradient, effect and adjustment layers

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
