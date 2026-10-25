# R6 validation report

PR: https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/16 (Draft). Base main: `740720c1d5e141c7f52ecab83d2e505fea7183f0`. Runtime validation anchor: `6803457862ace58324eec5f58cb2502e5d8bd042`. The final documentation/test-wrapper publishing commit and exact-head CI links are recorded in the PR body; [current PR-head checks](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/16/checks) identify that final head. No merge or deployment was performed.

**Implemented scope passes review checks. Full R6 remains blocked on approved persistence for advanced adjustment-layer settings.** The new preview/Cancel/Apply/native/export comparisons also passed with **byte-exact RGBA equality (tolerance0)**. No native format was changed. See the gap and implementation reports for the explicit compatible destructive scope and proposed future version8 strategy.

## Required commands actually executed

| Command                                                          | Result                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci --no-audit --no-fund`                                    | Passed, 465 packages; no lockfile/dependency changes                                                                                                                           |
| `npm test`                                                       | **888 passed, 0 failed**: 200 scripts + 59 app/auth + 91 Studio + 538 Pro                                                                                                      |
| `npm run typecheck`                                              | Passed both application and config TypeScript projects                                                                                                                         |
| `npm run lint`                                                   | Passed without warnings                                                                                                                                                        |
| `npm run build`                                                  | Passed; local DB migration correctly skipped without DATABASE_URL                                                                                                              |
| `npm run check:build`                                            | Passed Vercel output, browser/AI assets, PWA and tslib checks                                                                                                                  |
| `npm run check:auth`                                             | Passed: dev/build agree with existing sign-in configuration                                                                                                                    |
| `npm run test:r6:browser -- http://127.0.0.1:8081`               | Passed all five widths plus masked-group/clipping/adjustment scene, no console/page errors                                                                                     |
| Existing browser regressions                                     | All 30 browser command suites passed after unchanged retries described below                                                                                                   |
| `bench:raster:browser`                                           | Passed existing browser raster benchmark assertions                                                                                                                            |
| `bench:r6:color` / `bench:r6:render`                             | Completed real CPU, worker, native PNG and masked multilayer measurements                                                                                                      |
| `test:production:browser` on local built output with runtime SHA | Passed desktop/mobile source-commit, homepage/3D/gallery, Chapter, Raster/Vector, Dialogue, SVG/native/artboard/gradient/text-path and AI controls; no critical asset failures |
| Dev and built homepage smoke                                     | Passed desktop/mobile, no brand/auth/console errors; built result does not diverge from dev baseline                                                                           |

Published runtime CI at the exact anchor SHA passed both [build 40181763304](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40181763304) and [configuration 40181763295](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40181763295). Final publishing-head CI is verified separately after that commit is pushed and is linked from the PR.

## New automated coverage

**40 new unit/pixel/transaction tests** cover channel Levels endpoints/order/gamma, cubic knots/identity/no-overshoot, HSL lattice round-trips/wrap/selectivity/gray protection, encoded luma balance, linear exposure/gamma, vibrance versus saturation, channel B&W, exact threshold/posterize/invert, real alpha-weighted histogram, analytic Gaussian impulse, box/motion borders, unsharp threshold/high pass/sharpen, weighted median, Sobel, deterministic noise, transparent/soft-alpha pixels, source stability, captured selection, malformed presets/operations, work limits, locks/visibility, clipping membership, assets/layer/device budgets, stale revisions, native save/reopen and R5 nudging. They use the existing history implementation; Undo/Redo restores exact document identity.

The real browser suite at **1440, 768, 390, 360 and 320 CSS pixels** checks:

- Actual canvas pixels from sliders/numeric controls, per-channel Levels, graph knot creation/drag/removal/reset, and before/after comparison.
- Desktop UI wiring and worker pixels for HSL, balance, vibrance/saturation, B&W, threshold and posterize, in addition to brightness, exposure, Levels and Curves.
- Every new spatial/noise filter through a real processing worker and encoded PNG preview; known kernel results are independently covered in unit tests.
- Native touch curve dragging and follow-on R3 painting at touch widths; synthetic mouse/pen/touch does not constitute hardware Android testing.
- Rapid superseding exposure changes, cancellation while work is pending, no preview history/assets, one Apply transaction, exact Undo/Redo, native original-byte retention/reopen and PNG equality.
- R5 transformation after the new pixel result; subsequent R3 painting creates editable paint above immutable raster artwork.
- Group-local existing adjustment layers, masks/density and clipping, exact neutral-bake composite, changed-color output with unchanged alpha, PNG parity, mask-target exclusion and locked-layer rejection.
- Factory/custom presets with save/restore/delete and no horizontal modal overflow at every requested width.

Full regressions include homepage, Chapter, editor/adjustments/retouch/workflow/UI, Pro/layers/repair/geometry/transform/color/appearance, Vector/compound/pathfinder/artboards/final-vector, Raster refinement, R1.1 chapter import, R2 document/gesture, R3, R5 and all five Dialogue commands. Studio neural QA performs actual Swin2SR inference using the existing identity-encoded local WASM transport. OCR performs actual English/Korean/Arabic/Japanese/horizontal and vertical fixtures, warm cached inference with zero model fetches, corrupt-cache rejection and cancellation.

## Measured performance and memory

Single timed runs on this shared Linux executor, Node24.19.0 and Chromium156; these are not phone measurements or a browser performance SLA. Point-operation LUTs are compiled once. The CPU benchmark uses **non-neutral** Levels/Curves/exposure/vibrance settings and patterned RGBA, including soft alpha. Raw measurements and parameters are in `r6/benchmark.json`.

| 2000 × 2000 native source (4MP) | CPU pixel time |
| ------------------------------- | -------------: |
| Levels                          |       44.70 ms |
| Curves                          |       44.01 ms |
| Linear exposure / gamma         |       43.61 ms |
| Vibrance 35 / saturation 10     |      640.39 ms |
| Gaussian sigma1                 |      440.76 ms |
| Box radius32                    |      360.77 ms |
| Unsharp sigma1 / amount100      |      561.67 ms |

The CPU process peak RSS was approximately **194.83 MiB** across the complete benchmark. This is total process RSS, including runtime/allocator retention; it is not an isolated filter allocation or total browser/worker memory measurement. Per-case RSS and array-buffer observations are preserved. Gaussian uses a bounded Float32 intermediate; work is capped before large allocations.

The real worker/PNG benchmark used three visible masked layers plus one retained hidden original. At 4MP, source extraction took **53.3 ms**, Gaussian pixel work **471.0 ms**, full filter-worker decode/process/encode **730.5 ms**, and masked multilayer PNG export **1263.2 ms**. The 128² and 1024² runs and encoded byte counts are in `r6/render-benchmark.json`. A 4MP sigma32 Gaussian was rejected by the actual kernel-work guard. No silent resolution reduction occurred.

## Failures, retries and defects caught

Early test runs overlapped module changes, package updates or rebuilt output; they produced navigation-destroyed contexts and unavailable old chunks/controls. Their non-acceptance results are retained in `r6/validation.json`. They are not counted as successes. Subsequent runs used frozen output or the dev server only where direct source-module probes were required.

The frozen regression batch passed 29 of 31 commands initially (one command is the existing raster benchmark). R3 timed out waiting for the very long-stroke preview; OCR recognized all five fixtures but the runner timed out afterward. Both unchanged original commands passed on retries after the batch. No existing tests, assertions or timeout constants were disabled or weakened. The OCR retry additionally confirmed cached inference, corrupt-cache removal and cancellation; R3 completed all five widths and its synthetic pen checks. These timing failures remain recorded rather than erased.

New R6 fixture corrections accounted for actual accessible roles/toolbar labels, native asset rekeying, JSON `-0` normalization and reduced-density masks revealing some pixels outside their selection. Exact committed/exported pixel and alpha assertions remain in place. Visual inspection caught and fixed the new dialog rendering behind the studio; final desktop/tablet/320px screenshots were inspected. Final review also added gray protection for selective HSL, exclusion of mask-only targets and a displayed-result guard before Apply.

## Remaining acceptance dependency

Advanced persistent adjustment-layer settings are **blocked by unapproved native-format work**. The compatible pixel scope and existing persistent adjustment layers are functional, but this is not full non-destructive R6 completion. New operations are limited to one visible unlocked raster/paint source up to 4MP/device and kernel budgets. Spatial filters preserve silhouette alpha. The modal preview shows source-layer colors before masks/clipping/blend/effects; the final composite and export are verified separately. ICC/wide-gamut, higher-bit-depth editing, physical Android/stylus hardware and other browser engines were not validated.
