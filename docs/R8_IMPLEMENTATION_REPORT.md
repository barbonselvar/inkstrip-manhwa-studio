# R8 implementation report

Status: architecture audit; implementation in progress. No R8 milestone is complete. No merge or deployment is authorized.

## Verified baseline and isolation

Base main is `02eb697450a7eeeadbd53d73cea5931905c5b2f2`, the merged R7 PR17. R6 PR16 is merged as `6478fc106d97fbad478c618ab88a4afc8624ce20`. Dedicated branch: `codex/r8-layer-effects-smart-filters-gradients`. The only visible open PR at audit time is unrelated AI PR6; no Vector deactivation branch/PR is published yet. Do not edit homepage/navigation/Vector entry points or import concurrent branches. Shared Raster workspace/model/render files will require an integration review if concurrent work touches them.

## Existing functionality to preserve and extend

| System | Audited status | Reuse / missing R8 scope |
| --- | --- | --- |
| Layer effects | Seven actual alpha-based effects; editable ordered records | Reuse morphology, separable alpha blur, W3C blends and worker projection. Add spread/choke, shared light, gradient stroke, pattern and geometry-derived bevel, transactional UI/presets. |
| Gradients | Linear/radial fill layers; 2–16 premultiplied sRGB stops, transform/mask/history/persistence | Extend the same gradient engine with angular/reflected/diamond, bounded richer stops, midpoints, RGB/OKLab interpolation, smoothness/reverse and Raster handles. |
| R6 filters | Actual Gaussian/box/motion/unsharp/high-pass/median/noise/edges CPU algorithms | Reuse the R6 engine in persistent per-layer stacks. Add missing radial/surface/emboss/advanced noise/edge modes; retain work limits. |
| R6 adjustments | Persistent eleven-family backdrop operations, tiled point processing | Preserve exact implementation and isolated group/clipping/alpha semantics; never attach artwork filters/styles to adjustments. |
| R7 selections | Pixel RLE and geometric selections, Quick Mask, captured document-space frames | Reuse coverage and layer-local mapping. Quick Mask remains UI selection state and never a styles/filter target. |
| Native persistence | Internal schema1/2; envelopes1–5/7/8; AI6 reserved; Pro IDB4 | R7 reserves no new version. R8 needs schema3/envelope9/IDB5 fencing. Explicit opt-in metadata upgrade must retain all layers/source assets. |
| History and rendering | Existing immutable document history, worker generations, preview target readiness and transaction guards | Reuse. Draft parameter changes must not enter autosave/history until Apply. Cancel/document change invalidates drafts. |
| Export/recovery | Same renderer for preview/PNG/JPEG/WebP, validated native files and Chapter recovery | Extend validated records. SVG must explicitly reject unsupported filtered artwork. Preserve legacy render paths byte-for-byte where practical. |

## Architecture decisions

Proposed local rendering order: original editable artwork/gradient/strokes → existing legacy per-layer tone/color → ordered Smart Filters (each optional local coverage mask) → existing layer mask → layer projection → ordered styles derived from masked alpha → existing clipping stack → layer opacity/blend → group/backdrop/R6 adjustments according to existing hierarchy. Effects retain the existing exterior-behind/interior-on-fill model; reorder changes order within those compositing planes rather than moving a shadow above the fill.

Native schema3/envelope9 is necessary because old readers would otherwise accept unknown optional fields and discard their rendering. Readers must reject mismatched/unknown versions before asset decode. Migration is metadata-only and opt-in on first R8 edit; schema1 and2 remain readable unchanged. R6 adjustment creation must never downgrade schema3. IDB5 fences old writers without dropping stores or sessions; Chapter backups preserve typed sessions.

Keep R6's 4MP/128M-tap spatial processing bounds, with aggregate stack checks and bounded filter/stop counts. No source downscaling. Workers yield/cancel between stages; expensive indivisible kernels retain bounded work. New caches must preserve document identity/asset epochs and must not bypass limits.

## Milestones

- R8.1: pending — models, schema/validation, rendering integration, foundational tests.
- R8.2: pending — styles algorithms, transactional UI and presets.
- R8.3: pending — Smart Filters algorithms and stack UI.
- R8.4: pending — advanced gradients, stops, fill layers and canvas editing.
- R8.5: pending — compatibility, security/performance, persistence/recovery/export and complete regression.

Final commit, Draft PR, measured results and limitations will be recorded as work progresses. No feature parity or unrun-test claim is made by this audit.
