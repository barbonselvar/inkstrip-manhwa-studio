# Raster repair milestone — Phase A

This increment starts at verified remote head `d8bb4090fd793df42c9eda49facc961d8ea9c3d0` on PR #1. It extends the existing Pro document, layer, worker, history and native-file engines. It does not replace them or add dependencies.

## Working tools

- **Spot Healing Brush:** choose the tool, set size/hardness/opacity/flow in Properties, then paint a defect and release. The worker searches nearby translated donor rectangles, comparing intact perimeter colors and first-order texture differences. It excludes the damaged rectangle, checks sampled donor opacity and chooses a deterministic nearby candidate. If no candidate fits, it reports an error without recording a stroke.
- **Healing Brush (`J`):** Alt/Option-click a source, or open **Clone & Healing source → Set sample source** and tap it. Then paint the destination. New strokes use spatial tone adaptation from the current undamaged surrounding target and the captured immutable source. Existing older healing strokes retain their original RGB mean adaptation and continue rendering unchanged.
- **Patch Repair:** draw the destination rectangle, then tap/click the center of a same-size source region. Matching destination/source outlines guide placement. Hardness controls edge softness; opacity and flow control coverage. The current selection can further shape/clip the destination. Escape clears the patch without closing the workspace. Off-image source regions are refused without publishing an asset or stroke.
- **Pressure and smoothing:** Properties exposes **Pen pressure controls size** and **Stroke smoothing (0–95)**. Real pen Pointer Events store per-point pressure; mouse and touch keep normal configured size. Coalesced points are consumed where available. Smoothing applies a deterministic weighted input filter and can introduce endpoint lag at high settings. Both settings persist in strokes and custom brush presets. These are not tilt, rotation, speed dynamics or a full brush engine.
- **Selection-aware masks:** ordinary painted layer-mask strokes now capture and render the same active selection clips as paint strokes. Existing mask inversion, masks on repaired layers, layer opacity/blends and clipping stacks continue to use the shared compositor.

## Pixel processing and document behavior

Repair uses traditional deterministic pixel processing, not generative AI. A normalized separable box convolution estimates spatially varying target-minus-donor RGB corrections. Pixels inside the repair footprint are excluded from tone estimates, including original damage that is shifted into donor context. Donor detail and alpha are retained; insufficient local support falls back to the surrounding mean, and absent support leaves donor colors unchanged.

The worker processes at native document resolution, independent of the 1400px preview. It crops the processed donor texture into a PNG asset before publishing the new stroke. Subsequent previews, reopening and exports replay that same processed texture rather than rerunning an algorithm at preview scale. Repair kind, source/destination coordinates, footprint, selection clip, optional pressure and smoothing remain editable document metadata. A captured target transform makes newly painted clone/repair pixels move with their layer when translated, scaled, rotated or duplicated. Legacy sampled strokes without this optional field preserve their earlier interpretation.

Each completed repair adds one paint-layer stroke and an immutable texture asset in one history transaction. Undo restores the prior stroke list; Redo reuses the texture bytes. Native `.inkstrip` export/import embeds and remaps those assets using the existing machinery. Layer duplication and merging use the same stroke/compositor paths. Cancellation, invalid selections/sources and failed validation do not publish a partial repair. Original Chapter/source media are retained; applying to Chapter is still an explicit revision-checked action.

## Correctness and performance boundaries

- Existing limits remain: 48 layers, 64 immutable assets / 48 MB, 16 MP desktop and conservative 4 MP devices, 16384px per side, 50 session history states. Old undo assets stay in the immutable pool. There is no tiled/unlimited-resolution pipeline.
- One repair neighborhood, including tone-estimation padding, is limited to **1 megapixel**. Long strokes or large rectangles can exceed this and are explicitly rejected; use smaller operations.
- Automatic search is bounded to a local radius of at most **256 source pixels** with a coarse deterministic candidate grid. It copies one translated donor patch per stroke, not an object-aware or multiscale texture synthesis field. Repetitive texture, large defects, transparency, nearby damage and strong edges can require explicit Patch/Healing sources. It is not guaranteed to reconstruct semantic features.
- Patch regions are translated rectangles of equal size; the active selection can clip their destination. Arbitrary source warping, rotated/scaled source patches, Poisson seams and edge-aware diffusion are missing. The spatial RGB correction is not a perceptual color-management pipeline.
- New repair strokes retain processed texture snapshots. Changing a source image or a brush setting later does not regenerate an old stroke; undo/reapply to change the repair. Reopening retains the editable layer/stroke model, not earlier session Undo history.
- Tests use desktop Chromium, pen-event injection and mobile viewport/native-touch emulation. They do not establish physical Android/stylus behavior, other browser engines, or sustained-device memory/FPS benchmarks.

## Validation

`repair.test.ts` and `client.test.ts` cover spatial tone recovery on gradients, exclusion of damaged donor context, alpha/invalid/resource boundaries, deterministic donor search at source resolution, pressure/smoothing, native repair/patch/mask metadata and immutable ID remapping, history and cancellation.

`npm run test:repair:browser` checks all three tools against actual defects in the real worker. It verifies undo/redo, native save/reopen/import, exact PNG pixel fidelity, JPEG/WebP dimensions and repaired pixels, layer translation, selection clipping, painted-mask clipping, patch Escape/invalid-source rollback, a real pen pointer stream, and 2000px source-resolution processing despite the 1400px preview. At 320px and 390px it taps the visible Chapter Raster/Vector buttons, checks the selected source image, performs touch Spot/Patch repair, applies to Chapter and compares retained original bytes exactly.

The existing `test:pro:browser` and `test:layers:browser` remain the regression checks for selections, Clone Stamp/legacy healing, clipping, links, groups, merges, layer history, exports, AI handoff and Chapter safety.

## Next milestone

Phase B: interactive non-destructive crop and native-size resampling first, then coherent Free Transform/skew/distort/perspective work with appropriate raster, vector, text, mask and touch tests. Phase C and the remaining Phase D vector inventory stay deferred. Existing cubic paths/direct anchor editing and supported SVG import/export are preserved; no Illustrator feature-completeness claim is made.

Validation performed for this increment:

- `npm test`: **362 passing tests**, including **63 Pro tests** (9 added).
- `npm run typecheck`, `npm run build`, `npm run check:build`, `npm run check:auth`, `git diff --check`: pass.
- `npm run lint`: zero errors; one pre-existing Fast Refresh warning in `src/components/ui/button.tsx`.
- `test:repair:browser`, `test:pro:browser`, `test:layers:browser`: pass against the current production build. The repair suite also passes against dev.
- Dev/production desktop/mobile smoke: visible content, clean consoles, no overflow and no baseline divergence. The existing lazy homepage 3D canvas is awaited explicitly for stable comparison. Existing generic canvas/game-card branding warnings are unchanged; this editor is not relabeled as a game.
- Browser QA used the existing Playwright fallback because `agent-browser` is unavailable. No physical Android/stylus testing, other browser-engine validation or paid AI inference was performed.
