# Inkstrip release changelog

## Phase E — Raster refinement (PR #4)

- Native-resolution Select and Mask with local color matting, morphology, cleanup,
  preview/apply/cancel, canvas color samples and named selections.
- Deterministic brush dynamics/presets, editable mask properties/linkage/clipboard,
  group masks, undoable baking and native v5 compatibility.
- Consistent 4096-square Pro budgets, tiled refinement, bounded mask previews and
  history, measured real browser/native-export benchmarks.
- [Feature audit, algorithm contracts and limits](PHASE_E_RASTER_REFINEMENT.md).
  Existing Raster/Vector/Chapter/AI/3D engines and immutable sources are preserved.

## Phase D — complete vector engine implementation (release gated in PR #3)

- Increment D: native v4 editable fill/stroke stacks, aligned and dashed strokes,
  affine linear/radial vector gradients, on-canvas handles/stops, appearance
  clipboard, and editable Unicode text on owned Bézier baselines.
- Increment E: bounded data-only SVG gradients/clips/binary masks/textPath and
  validated stacked appearance interchange, weak geometry/arc caches, measured
  40,000-anchor benchmarks, full rendering/touch regressions, and non-secret
  commit metadata for exact live release verification.
- [Final feature audit, compatibility limits and validation contracts](PHASE_D_FINAL_RELEASE.md).
  Existing Raster/Vector/Chapter/AI/3D engines and immutable sources are retained.

- Increment C: real multi-artboard metadata and interactive editing, DPI-aware
  presets, virtual work-area rendering, clipped individual/range raster/SVG exports,
  native v3 with v1/v2 compatibility, precision grid/guide/object/anchor/board snapping,
  acquired Smart Guides and geometric alignment/distribution. Original Chapter
  canvas and source bytes are retained. [Contracts and limits](PHASE_D_ARTBOARDS_PRECISION.md).

- Increment B: genuine Unite/Subtract/Intersect/Exclude/Divide/Trim/Merge filled-region
  geometry, bounded curve approximation, editable native results, neutral group
  support, cancellable worker, touch/keyboard panel and explicit empty-result safety.
  [Pathfinder contracts and limits](PHASE_D_PATHFINDER.md).

- Exact cubic subdivision and bounded-error arc metrics/inversion.
- Native open/closed segment-subdivision transaction with history/native tests.
- Precise native curve insertion from the canvas and numeric parameter/arc
  distance controls; source-space segment lengths.
- Corner/smooth/symmetric handles, numeric anchor/handle coordinates, touch-aware
  Direct Select, Alt to break coupling, path reversal and guarded anchor deletion.
- Existing history/native/export/Chapter integration and desktop/320px/390px
  Chromium regression suite. Advanced appearance/text-on-path and
  the remaining vector phase are still pending; no Phase D production release.
- Increment A: editable compound contours/holes, evenodd/nonzero rules,
  create/release, subpath controls, safe SVG path/arc conversion, affine/stroke/
  viewBox/group import and SVG output. Direct document-resolution vector rendering
  and source-frame fitting preserve editing quality.
- Backward-compatible native reading plus v2 feature-bearing envelopes prevent
  older releases silently dropping holes/styles. Native files exclude unused
  history assets while retaining current, hidden, original and clone/mask sources.
- [Compound/SVG contracts and limits](PHASE_D_COMPOUND_SVG.md).
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
