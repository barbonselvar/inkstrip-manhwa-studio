# R8 implementation report

Status: R8.1–R8.4 implemented and targeted-tested; R8.5 hardening implemented, full release regression pending. No merge or deployment is authorized.

## Verified baseline and isolation

Base main is `02eb697450a7eeeadbd53d73cea5931905c5b2f2`, the merged R7 PR17. R6 PR16 is merged as `6478fc106d97fbad478c618ab88a4afc8624ce20`. Dedicated branch: `codex/r8-layer-effects-smart-filters-gradients`. The only visible open PR at audit time is unrelated AI PR6; no Vector deactivation branch/PR is published yet. Do not edit homepage/navigation/Vector entry points or import concurrent branches. Shared Raster workspace/model/render files will require an integration review if concurrent work touches them.

## Existing functionality to preserve and extend

| System | Audited status | Reuse / missing R8 scope |
| --- | --- | --- |
| Layer effects | Seven actual alpha-based effects; editable ordered records | Reuse morphology, separable alpha blur, W3C blends and worker projection. Add spread/choke, shared light, gradient stroke, pattern and geometry-derived bevel, transactional UI/presets. |
| Gradients | Linear/radial fill layers; 2–16 premultiplied sRGB stops, transform/mask/history/persistence | Extend the same gradient engine with angular/reflected/diamond, bounded richer stops, midpoints, RGB/OKLab interpolation, smoothness/reverse and Raster handles. |
| R6 filters | Actual Gaussian/box/motion/unsharp/high-pass/median/noise/edges CPU algorithms | Reuse the R6 engine in persistent per-layer stacks. Add missing radial/surface/emboss/advanced noise/edge modes; retain work limits. |
| R6 adjustments | Persistent eleven-family backdrop operations, tiled point processing | Preserve exact implementation and isolated group/clipping/alpha semantics; never attach artwork filters/styles to adjustments. |
| R7 selections | Pixel RLE and geometric selections, Quick Mask, captured document-space frames | Reuse coverage and layer-local mapping. Quick Mask remains the existing temporary coverage paint layer and never a styles/filter target. |
| Native persistence | Internal schema1/2; envelopes1–5/7/8; AI6 reserved; Pro IDB4 | R7 reserves no new version. R8 needs schema3/envelope9/IDB5 fencing. Explicit opt-in metadata upgrade must retain all layers/source assets. |
| History and rendering | Existing immutable document history, worker generations, preview target readiness and transaction guards | Reuse. Draft parameter changes must not enter autosave/history until Apply. Cancel/document change invalidates drafts. |
| Export/recovery | Same renderer for preview/PNG/JPEG/WebP, validated native files and Chapter recovery | Extend validated records. SVG must explicitly reject unsupported filtered artwork. Preserve legacy render paths byte-for-byte where practical. |

## Architecture decisions

Implemented local rendering order: original editable artwork/gradient/strokes → existing legacy per-layer tone/color → ordered Smart Filters (each optional local coverage mask) → existing layer mask → layer projection → ordered styles derived from masked alpha → existing clipping stack → layer opacity/blend → group/backdrop/R6 adjustments according to existing hierarchy. Effects retain the existing exterior-behind/interior-on-fill model; reorder changes order within those compositing planes rather than moving a shadow above the fill.

Native schema3/envelope9 is necessary because old readers would otherwise accept unknown optional fields and discard their rendering. Readers must reject mismatched/unknown versions before asset decode. Migration is metadata-only and opt-in on first R8 edit; schema1 and2 remain readable unchanged. R6 adjustment creation must never downgrade schema3. IDB5 fences old writers without dropping stores or sessions; Chapter backups preserve typed sessions.

Keep R6's 4MP/128M-tap spatial processing bounds, with aggregate stack checks and bounded filter/stop counts. No source downscaling. Workers yield/cancel between stages; expensive indivisible kernels retain bounded work. New caches must preserve document identity/asset epochs and must not bypass limits.

## Milestones

- R8.1: implemented and verified — typed records, metadata migration, schema3/envelope9/IDB5, renderer integration, 27 new foundational cases and actual worker/native/PNG integration. Existing dynamic effect tests add coverage for the two new effects. Full suite971 passed, typecheck passed; final whole-R8 regression/CI is still pending.
- R8.2: implemented and targeted-UI verified — nine alpha-derived style families, shared light, spread/choke, gradient strokes/glows, pattern recipes, relief lighting, copy/paste, preset duplication, draft preview/Apply/Cancel. All five widths pass exact-pixel UI workflows. Final regression remains pending.
- R8.3: implemented and targeted verified — ten persistent filter families with enable/edit/reorder/remove, selection masks, seeded uniform/Gaussian noise, radial spin/zoom, Surface Blur, Emboss and Sobel/Laplacian. Gaussian/Motion share the R6 kernels with explicit premultiplied coverage blur; R6 default coverage stays unchanged. Worker tests prove native/filter masks/R6 color-source/whole-layer transform integration. Final regression/performance is pending.
- R8.4: implemented and targeted verified — linear/radial/angular/reflected/diamond,2–128 stops, opacity/midpoint/RGB/OKLab/smoothness/reverse, touch drag/reorder and numeric stop selection; staged fill creation and Raster-only canvas endpoint editing. All five widths pass pointer/cancel/history/mask/native/PNG tests. Final full regression remains pending.
- R8.5: hardening/targeted verification implemented — native/store fencing, pre-decode security, aggregate work budgets, bounded preview queue, blocked-close/fresh-context recovery and measured worker/native output. Complete application regression and final CI remain pending; R8 is not yet declared complete.

Final commit, Draft PR, measured results and limitations will be recorded as work progresses. No feature parity or unrun-test claim is made by this audit.

R8 uses built-in repeatable checker/stripe/dot texture recipes for Pattern Overlay; custom texture asset import is not yet implemented. Smart Filter masks currently capture R7 selections, with inversion and density; brush editing of an independent per-filter mask is not implemented. Effects remain on the existing document-space compositing planes. Groups and backdrop adjustment layers cannot take Smart Filters; extended vector appearance/path-text planes are explicitly rejected to avoid cropping editable overflow. Advanced styles are bounded to4MP including effect padding.

Draft PR: https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/19. Concurrent Vector deactivation is now Draft PR20, head `b57ccf098afc361763ccf597fd4a74988e97a9ea`. Its shared files include pro-workspace.tsx, pro-properties.tsx, pro-browser-fixtures.mjs and package.json. Preserve its entry-point/legacy-mode changes when integrating; preserve R8 draft guards, native9 fixture dispatch and Raster-only controls. No PR20 code was imported or modified.

Smart Filter alpha and destructive integration: Gaussian/Motion blur premultiplied RGBA with clamp borders; unsharp/high-pass/median/surface/emboss/edges preserve source coverage. R6 destructive Color & Filters reads base content before the stack and preserves the stack afterward. Its neutral worker round trip proves no double blur. Selected-pixel lifting and destructive mask baking require active Smart Filters to be disabled; whole-layer transforms, ordinary mask editing and source painting work. This prevents an editable stack being silently baked or applied twice. Smart masks capture R7 selection coverage in source coordinates and mix stages by premultiplied interpolation; mask strength0 is exact original.

Gradient tool semantics: linear handles define both endpoints; radial/diamond/reflected use center and direction/scale. Angular uses center and an angle/scale handle. Coordinates are source-local, mapped through the existing R5 layer/view transforms; ordinary R5 transforms retain the whole definition. Pointer previews are transient; release commits once, Escape/pointer cancellation restores the original. New fills capture the active R7 selection as the normal layer mask and are not created until Apply. Existing Vector gradient tools/entries are unchanged.

Advanced gradient interpolation is premultiplied encoded RGB or Ottosson OKLab (reusing R7's sRGB→OKLab conversion); inverse OKLab clips out-of-gamut RGB, then8-bit output quantizes deterministically. Midpoints use a power remapping with the midpoint at50% mix; smoothness blends that parameter with smoothstep. No ICC/wide-gamut/16-bit support is claimed. Legacy gradients and R6 gradient maps keep the original algorithm.

## Hardening and measured performance

The properties renderer coalesces edits to one active worker request and one latest waiting metadata request. Rapid bursts of12 requests produced exactly2 physical worker jobs,1 final result and11 rejected stale requests in all measured cases. Stale bitmaps close, cancellation disposes queued/active work, and first-commit readiness compares the requested settings key. Original workspace/R3 rendering is unchanged.

Limits remain4MP for spatial work/new style planes;128M filter samples across each layer and visible document;128M visible advanced style-pixel work units;128 stops/12 filters/9 unique styles/20 custom presets. Native side, layer/source/asset/metadata budgets remain. No safety limit was raised. A native-size style guard prevents a small preview committing an unexportable full-size configuration. Whole previews are invalidated for filtered painting, because blur/noise may change pixels beyond the brush bounds.

Measured shared-executor worker results (synthetic gradient/mask/filter/relief fixtures, CPU Chromium, not device guarantees):

| Native frame | Workload | First PNG export | Reopened PNG export | Sampled Node/browser peak RSS |
| --- | --- | --- | --- | --- |
| 512×512 | Gaussian/noise, mask, bevel/shadow | 358.5ms | 328.2ms | 776.9MiB |
| 1024×1024 | Gaussian/noise, mask, bevel/shadow | 1005.6ms | 1154.2ms | 788.4MiB |
| 2000×2000 | Gaussian/noise, mask, bevel | 3216.6ms | 3299.5ms | 877.8MiB |
| 4096×4096 | 128-stop gradient only | 2636.9ms | 2758.7ms | 934.6MiB |

All measured native round trips retain exact RGBA hashes, dimensions and original source-byte hashes. Peak RSS samples include Node and descendant browser processes at250ms intervals and do not represent a device memory guarantee. Filters/styles remain whole-plane processing under their limits; larger halo-aware tiling/GPU paths and intermediate-composite caches are not claimed. Existing immutable asset caching is reused.

See [native schema](R8_NATIVE_SCHEMA.md) for migrations, exact compositor order and compatibility. All six R8 browser suites are registered separately from the existing35 suites; full regression is pending on the frozen candidate. Current unit count1002 passes; typecheck/lint/build/configuration checks were executed. A TypeScript control-flow inference error in the new visible-work traversal was corrected with an explicit parent-ID type and typecheck passes afterward.

Repository pushes may trigger its existing automatic Vercel Preview integration. No production merge/promotion/deployment or hosting configuration change is authorized or performed by this task.

Read-only integration check against PR20 found one actual Git conflict: independent hook insertions immediately after the mode state in pro-workspace.tsx. Moving only R8's own draft hook below its adjacent adjustment-draft declaration avoids that shared insertion point without importing or modifying the Vector branch. Preserve the Vector legacy-entry hook and R8 draft hook/guards in any later integration. Shared fixture/native9 dispatch and package test commands remain separate from Vector activation behavior.
