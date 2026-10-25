# R6 validation report — persistent adjustment completion

Verified base: main `740720c1d5e141c7f52ecab83d2e505fea7183f0` (R3/R5 merged). Continued published R6 `21fafe068d2c6bb3531c7c949e614501141240fb` on the same branch and [Draft PR16](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/16). Implementation/source anchor: **`5c00b61b5c1cb4cbef3cfa824ed86b6a798397a3`**. Built-output acceptance runtime: **`531c9b0d07e0ba6702733929bcb03ff8e8521e8e`**, including the blocked-close regression. Final publication contains reports/evidence only; its exact SHA and final CI are recorded on PR16 and in the execution handoff, avoiding a self-referential commit hash inside its own report.

**Status: persistent R6 scope and all local regression/acceptance gates pass.** All32 browser suites, the raster browser benchmark and local built-output release acceptance pass. Final publishing-head CI is checked after publication and recorded on [PR16 checks](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/16/checks) and in the final handoff. No merge or deployment. Original phase1 evidence remains in `r6/validation.json`, `r6/browser.json`, `r6/benchmark.json` and `r6/render-benchmark.json`; the authorized persistence completion adds `r6/persistent/` evidence. This report supersedes the earlier format-approval blocker.

## Commands and CI

| Command                                                 | Actual result                                                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --no-audit --no-fund`                           | Passed,465 packages; no dependency or lockfile change                                                                                                                                   |
| `npm test`                                              | **912 passed**,0 failed/skipped:200 scripts +59 app/auth +91 Studio +562 Pro                                                                                                            |
| `npm run typecheck`                                     | Passed app and configuration TypeScript                                                                                                                                                 |
| `npm run lint`                                          | Passed,0 errors/warnings                                                                                                                                                                |
| `npm run build`                                         | Passed; DATABASE_URL absent, existing migration script explicitly skipped                                                                                                               |
| `npm run check:build`                                   | Passed server/browser/AI assets, PWA and tslib verification                                                                                                                             |
| `npm run check:auth`                                    | Passed existing sign-in configuration invariant                                                                                                                                         |
| `npm run bench:r6:layers -- http://127.0.0.1:8080`      | Passed real-worker512²/2000²/3000²/4096² native exports, source/pixel hashes and stale preview rejection                                                                                |
| Browser regression batch (32 suites + raster benchmark) | All32 browser suites and existing raster benchmark passed, with initial failures/retries recorded below and in persistent evidence                                                      |
| Local built-output release acceptance                   | Passed unchanged script at1440/320/390px,4K Raster and real Swin2SR,0 console/page/critical-asset errors, using verified production-equivalent local WASM MIME. No production mutation. |

Implementation-anchor GitHub Actions both passed: [Node build40189889938](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40189889938), [Configuration40189889941](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40189889941). Final publishing-head Actions are checked again after report publication and linked from PR16. CI success on an earlier SHA is not substituted for that final check.

## New unit, pixel and integration coverage

**24 additional tests** in `adjustment-layer.test.ts` supplement the40 original R6 tests and existing R1–R5/Studio suites:

- Lossless, opt-in schema1→2 migration; original layer/source identity, source bytes and legacy adjustment settings retained.
- Every one of11 persistent families round-trips its typed record and preset metadata in internal2/envelope8, with no raster snapshot or extra image asset.
- Actual feature-bearing legacy envelopes1–5/7 read, re-export and migrate; legacy-reader version rejection, schema/envelope mismatch and deletion of the final advanced layer retain safe versioning.
- Canonical encoding across property insertion order; strict unknown version/type/key, numeric/curve validation; prototype/depth attacks and corrupted JSON.
- Missing assets, duplicate layer IDs, oversized masks,49layers and65assets reject atomically.
- Existing history create/edit/duplicate/delete Undo/Redo; no-op Apply, stale document/deleted target/lock rejection; masks/geometry/blend/opacity and siblings retained.
- Native import immutable asset rekeying, explicit SVG rejection and Chapter backup typed-session round-trip.
- Device/source and cumulative128M work caps; seven16.8MP adjustments allowed within budget, eighth rejected; oversized input frames rejected.
- Tile seams and every point family versus the untiled existing engine, fractional coverage/multiply blending, analytic soft-alpha mask/opacity, native alpha-weighted histogram and cancellation before a stale tile write.

No existing assertion, timeout or resource limit was weakened.

## Browser coverage and fidelity

The new `test:r6:layers:browser` exercises **1440,768,390,360,320 CSS-pixel** viewports. Its canvas/native/PNG comparisons use **zero pixel tolerance**. It checks actual controls and output, including:

- Create/cancel without schema change/history/assets; edit and reopen Levels RGB/red endpoints/gamma and multi-point RGB/blue Curves.
- Full proposed composite versus committed canvas, before/after, exact Apply/Cancel/Undo/Redo; cancel with queued rapid parameter changes; keyboard history remains isolated while modal is open.
- Actual durable autosave, rapid Undo/Redo, real application reload and exact recovered settings/pixels/source counts. Old storage3 reader receives VersionError and cannot overwrite storage4 data.
- Visibility, opacity and mask creation, each with Undo/Redo; PNG/native parity; duplicate/delete/new layer ID with exact editable settings.
- All11 families committed through real controls against CPU/blend pixel references; factory preset metadata; future native import rejected without changing native bytes.
- Noncommuting adjustment order against analytical expected pixels, isolated group scope, clipping, selected mask coverage, multiply blend, upper and outside artwork unaffected.
- R5 Free Transform of the underlying raster and exact Undo; subsequent editable R3 painting; actual Chapter backup download, restore in a fresh390px browser context, exact composite/settings and durable save from recovery journal to primary store.
- No horizontal modal overflow at all requested widths. Shared curve controls also retain native-touch graph coverage in the original R6 suite.

The final full `test:r6:layers:browser` on frozen built output passed all five widths, blocked-save close and fresh-context recovery, with0 errors and0 pixel tolerance. Its complete results are in `r6/persistent/browser.json`.

The original `test:r6:browser` continues to cover every spatial/noise filter, stable source/selected-pixel processing, presets, real touch curves, native history/export and R3/R5 follow-on work at the same five widths. Full existing regressions cover homepage/3D, Chapter, editor/retouch/workflow/UI, Pro/layers/geometry/transforms/color/appearance, Vector/compound/pathfinder/artboards, Raster refinement, R1.1 import, R2 documents/gestures, R3/R5 and all five Dialogue commands. OCR runs actual English/Korean/Arabic/Japanese and vertical Japanese fixtures. Neural Studio validation runs actual Swin2SR inference through existing safe local WASM transport.

Browser acceptance uses Playwright Chromium156 on the shared Linux executor. `agent-browser` is unavailable; no hardware Android/stylus or Firefox/Safari claim is made. Built output remains frozen during the broad batch; source-module probes alone use the dev server.

## Measured performance and memory

The real worker benchmark uses an immutable patterned PNG with soft alpha, non-neutral Exposure/Gamma plus HSL, adjustment opacity0.6 and a large selection mask with density0.8. All exported PNGs retain **full source dimensions**. All pre-save/post-reopen full-RGBA SHA256 hashes and original asset hashes match. JPEG/WebP MIME and dimensions are also verified at512². No silent source downscaling occurs; the existing1400px maximum preview dimension is distinct from native export.

| Native dimensions |     Pixels | Preview ms | Native histogram ms | First PNG ms | Reopened PNG ms | Browser process-tree peak RSS MiB |
| ----------------- | ---------: | ---------: | ------------------: | -----------: | --------------: | --------------------------------: |
| 512×512           |    262,144 |      312.7 |                34.8 |        114.5 |           113.4 |                               652 |
| 2000×2000         |  4,000,000 |      833.7 |               608.7 |       1420.9 |          1447.5 |                               838 |
| 3000×3000         |  9,000,000 |     1090.3 |              2921.3 |       7297.9 |          7973.7 |                               972 |
| 4096×4096         | 16,777,216 |     2037.7 |              5890.6 |      10993.5 |          5755.4 |                              1185 |

These are single shared-executor runs, including concurrent checks, not performance promises. Peak RSS sums Chromium parent/child resident sets sampled100ms; shared pages can be double-counted and image generation/hash/runtime are included. It is not isolated allocation accounting or measured mobile memory. Full raw timings, native/source byte sizes, hashes and notes are in `r6/persistent/benchmark.json`.

Processing/histogram tiles are512²; render/coverage canvases still use the existing full-plane renderer. Worker decoded-source cache is retained; no intermediate-composite/dirty-region/GPU backend is claimed. Native point layers can safely use the existing device/document budget after these measurements; destructive/spatial filters keep the4MP cap and kernel limits. Existing mask/selection/layer/asset/combined-source/history bounds remain. Maximum tested dimensions are4096×4096, not every aspect ratio up to the16384px side limit.

## Defects, failures and retries

A confirmed autosave acknowledgement race after rapid Undo/Redo is fixed: an older queued save could leave the latest state unscheduled when history returned to an earlier saved signature. Saved status now requires an empty queue and matching durable/current document, and successful older acknowledgements re-evaluate autosave. Real reload tests guard the fix.

An early Before/after test read the previous displayed canvas immediately after the checkbox changed. The panel now marks that view pending until the matching worker result is displayed; Apply uses both the view state and displayed parameter key. No source pixels/history are used as draft storage.

Early persistent test fixture corrections opened the collapsed mask section, removed a shadowed base URL during fresh-context restore, and compared canonical parameter records rather than JSON property insertion order. Assertions remain exact. The initial broad batch's Studio/editor commands began before the restarted local preview was ready and failed with connection refused; unchanged retries are recorded with the completed batch. The unchanged R3 dense-stroke preview timed out under the batch load; an isolated unchanged retry passed all five widths in360.52s. The new mobile check initially waited for a save label intentionally hidden by the responsive stylesheet; it now checks the same saved state and actual durable record. No pixel assertion was relaxed.

The apparent one-level recovery difference was traced to **premature programmatic navigation during asynchronous save-and-close**, not color quantization. The first reported channel18648 (`85` versus`86`) is exactly reproduced by removing the newly painted stroke:3,173 channels differ, maximum174. The assertion had stopped at its first soft-edge sample. A separate repeat also captured an older document's entirely different layer records, confirming the close/navigation race. The existing editor close already awaits its FIFO save; the test must await the completed close before navigating to Backup.

The recovery test now holds a real IndexedDB read/write transaction, initiates close, asserts that the editor remains visible while the queued save is blocked, releases the transaction, waits for close completion and verifies the exact durable native record. It then checks restored settings/source bytes, PNG and preview with zero pixel tolerance. Five consecutive focused recovery runs passed before adding this stronger blocked-write case; the final full built suite then passed it. A raw-IDB comparison initially included an optional undefined field omitted by JSON; canonical native comparison corrected that representation mismatch. A development-server rerun also failed to locate Export after a modal closed; the full frozen-output run passed without application changes. Both non-acceptance logs are retained. A diagnostic32-render fresh-worker probe and30 CPU/default Canvas comparisons found no pixel differences; no speculative color/renderer modification was made. JSON-omitted optional undefined fields are compared by strict canonical native serialization when checking the raw IDB object, matching the actual file representation.

The local built-output release script's direct request also encountered two pre-existing Nitro preview WASM MIME/streaming-fallback console errors after real AI output succeeded. The existing main Studio test already requests `Accept-Encoding: identity` for this transport issue. Identity encoding alone did not fix the octet-stream MIME response. A read-only production HEAD returned200/application/wasm for the same asset. The unchanged release script is rerun through `r6/persistent/serve-built-qa.mjs`, which supplies identity encoding and that production-equivalent MIME locally. The served11,210,254 bytes are byte-identical to the build artifact (SHA256 in `wasm-transport.json`); no assertion, error collection or application asset is altered. No production configuration or data is changed. The full unchanged release command then passed, including all graphics checks and real16×24→32×48 neural inference, with0 console/page errors and0 failed critical assets. Results are in `r6/persistent/local-built-acceptance.json`; exact local transport source and artifact hash are also committed.

## Acceptance boundaries

Persistent color adjustment layers are now implemented; no advanced-color format approval blocker remains. Existing spatial filters remain the separate original-preserving pixel workflow. SVG explicitly rejects adjustment layers. ICC/wide gamut/high-bit-depth, persistent spatial filters, hardware mobile testing and non-Chromium rendering remain outside scope. R7/AI6 were not merged; R7 must retain schema2/envelope8/storage4 and the workspace/client/worker contracts after integration. Main/production are unchanged and PR16 stays Draft pending explicit merge authorization.

## Main advanced during final publication

After the frozen validation, an external actor merged Chapter PR18 at2026-10-25T14:34:15Z. Current main is `e1c21546110c4a469250695539b64ad3b34e347a`; the R6 implementation and browser baseline remain `740720c1d5e141c7f52ecab83d2e505fea7183f0`. This execution did not modify or merge main. R7 PR17 is still Draft and was not imported.

A read-only Git merge-tree calculation found exactly one textual conflict, `package.json`: both streams appended scripts after `bench:r5`. R6's five unchanged command entries were moved beside the existing color-test entry, removing the overlapping insertion. No command/assertion/dependency was changed, no Chapter/R7 source was imported, no branch was merged or rebased, and no force push was used. GitHub PR checks can therefore validate the R6 changes with the new main. Shared Chapter import/display budgets and native-session revision protection remain behavioral integration considerations; the frozen browser results above are explicitly the R6 baseline, not an unrun combined-main browser suite. Final GitHub checks and mergeability are verified on the final PR HEAD.

## Artboards blocker follow-up

The subsequent authorized release was stopped on the combined Chapter/R6 candidate because the Artboards preview incorrectly reported ready for an earlier viewport. See [confirmed cause and fix](R6_ARTBOARD_BLOCKER_REPORT.md). Its focused regression is red on both unmodified main and the preserved candidate, and green with the presentation-target fix. The latest PR16 release-blocker validation record reports the exact updated HEAD, repeated original Artboards suite, full regression and CI outcome. Earlier32-suite results in this report are historical, not a substitute for that final rerun. Keep PR16 Draft and await renewed release authorization.
