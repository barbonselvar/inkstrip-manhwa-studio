# R6 pre-implementation architecture and gap audit

Baseline: main `740720c1d5e141c7f52ecab83d2e505fea7183f0`, verified 2026-10-25. PR14 (R3) and PR15 (R5) are merged. PR6 is open Draft, separate AI stream. No R4 implementation was imported. R6 branch: `codex/r6-color-adjustments-filters`. No merge/deployment is authorized.

## Existing engine and reuse

The Raster Studio Pro engine uses straight 8-bit encoded-sRGB RGBA ImageData, Canvas2D/OffscreenCanvas compositing, worker rendering, immutable encoded image assets, and a single immutable document-history engine. There is no general GPU filter backend, ICC-managed editing, wide gamut or floating-point document storage. Browser image decoding retains existing profile conversion behavior. Exposure in legacy `editor/adjustments.ts` multiplies encoded values; retain that behavior for existing documents. New explicit exposure will decode sRGB to linear light, multiply by 2^stops, then encode and apply gamma. Other creative color operations use encoded sRGB and documented Rec.709-weighted encoded luma; do not describe that as physical luminance.

Reuse: `color.ts` tonal-range balance (quadratic shadow/midtone/highlight weights with gamut-safe luma preservation), saturation-sensitive vibrance, mixer, threshold, posterize; `editor/adjustments.ts` brightness/contrast, box blur, alpha-weighted edge-aware denoise and basic unsharp; `pixels.ts` legacy composite levels and five-point linear curve; `render.ts` persistent adjustment layers, masks, clipping, opacity and blend modes; `files.ts` native/export; R5 immutable revision guards and existing history/resource validation.

| Requested capability                    | Baseline classification           | Gap / intended disposition                                                                                                                |
| --------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Brightness/contrast                     | Partially implemented             | Real non-destructive sliders; add stable Apply/Cancel numeric preview workflow                                                            |
| Levels                                  | Partially implemented             | Only composite input black/white/gamma; add RGB + independent channels and output endpoints with real histogram                           |
| Curves                                  | Partially implemented             | Five fixed composite linear points; add ordered editable channel points and shape-preserving cubic LUT                                    |
| HSL                                     | Partially implemented             | Legacy hue matrix and saturation; add genuine HSL, lightness, optional soft hue ranges                                                    |
| Color balance                           | Implemented, unit-tested          | Reuse existing tonal range algorithm, retain legacy rendering                                                                             |
| Exposure/gamma                          | Partially implemented             | Legacy encoded exposure/composite gamma; add explicit linear-light exposure                                                               |
| Vibrance                                | Implemented, unit-tested          | Reuse adaptive saturation algorithm                                                                                                       |
| B&W/invert                              | Partial / missing                 | Desaturation exists; add channel-mixed B&W and invert                                                                                     |
| Threshold/posterize                     | Implemented, unit-tested          | Reuse actual pixel operations                                                                                                             |
| Adjustment layers                       | Implemented for existing settings | Persistent masks, clipping/group-local backdrop, opacity/blend, visibility and ordinary layer operations already exist; verify regression |
| Advanced persistent adjustment settings | Blocked by file-format dependency | New channels/curve/filter settings cannot be silently added to the old schema; compatible raster bake first                               |
| Filters                                 | Partially implemented             | Existing box blur/limited unsharp/denoise; add bounded Gaussian, motion, sharpen, unsharp, noise, median, high pass and Sobel edges       |
| Preview transactions                    | Partially implemented             | Existing immediate parameter history; new isolated cancellable worker preview, Apply single transaction                                   |
| Presets                                 | Partially implemented             | Basic existing presets; add validated global custom presets outside native schema                                                         |
| Mobile                                  | Partially implemented             | Preserve inspector; test new modal at 320/360/390/768/1440                                                                                |

## Native format decision before implementation

Internal document version is 1. The portable envelope supports 1–5 and Dialogue 7; AI PR6 reserves 6. `validateColor` rejects unknown advanced color keys. Old native readers accept some extra document fields, which risks silent omissions. R6 will **not change these formats, validators or migrations**. No new native settings are authorized. New advanced operations bake into an ordinary immutable PNG on a raster/paint layer, preserving its transform, mask, clipping, opacity, effects and hierarchy. The untouched original will remain hidden and editable; Apply uses existing history, Cancel publishes neither pixels nor assets. Existing persistent adjustment layers remain functional with their existing settings. Advanced editable adjustment-layer persistence remains explicitly blocked pending an approved, coordinated envelope/migration design (including AI6/Dialogue7). No claim of full R6 completion is permitted while this requirement is blocked.

## Safety and processing plan

Bound source work to at most 4MP and the device budget. Validate source, layer nesting/count, immutable asset count/bytes and document sources before commit. Process layer-local source at native resolution before its mask/effects; preview identifies that local target and does not claim to be a full-composite proof. Optional selection captures stable document selection into layer-local coordinates. Preserve alpha and invisible RGB. Spatial filters use alpha-weighted neighborhoods and clamped borders; enforce separate kernel-work budgets. PNG encoding remains subject to existing R1.1 header/decode policy. Never accumulate slider processing from the last preview. Terminate superseded workers and reject changed document/layer revisions. Do not write preview settings or pixels into autosave.

## Integration and outstanding verification

R3 and R5 are in the actual base: preserve final stroke length caps, pressure recording, mask transforms, transform drafts and commit acceptance. Preserve all older adjustment output bit-for-bit. No cherry-picks, unrelated studios or PR6 changes. Full tests, browser pixels/history/native/export, actual performance measurements and exact-head Actions remain pending at this audit commit.
