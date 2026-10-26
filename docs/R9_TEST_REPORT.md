# R9 test and validation report

Candidate: `7c47847664f8340a22be94c60ef523def97adaa8` on `ccr-fa0c8f59-fprl9n` (R9 merged with
main `db78593`, which contains R8 #19 and PR #21). The documentation commit that adds this
report and the stricter locked-guide step in `test:r9:integration:browser` (re-run twice,
both passes) changes no application code.

Raw evidence: [browser-matrix.json](r9-evidence/browser-matrix.json),
[performance.json](r9-evidence/performance.json),
[raster-render-benchmark.json](r9-evidence/raster-render-benchmark.json).

## Static gates

| Gate                                           | Result                                      |
| ---------------------------------------------- | ------------------------------------------- |
| `npm run typecheck`                            | PASS                                        |
| `npm run lint`                                 | PASS                                        |
| Prettier on every file changed vs main         | PASS                                        |
| `npm test` (all unit suites)                   | PASS — 1,030 / 1,030 (200 + 59 + 108 + 663) |
| `npm run build` + `npm run check:build`        | PASS                                        |
| GitHub Actions on PR #22 (`validate`, `build`) | PASS on `7c47847`                           |
| Vercel preview deployment of `7c47847`         | "Deployment has completed" (GitHub status)  |

## Browser matrix

Environment: headless Chromium 153 driven by the repository's Playwright 1.64, in a sandbox
whose egress policy denies `grok.com`, `huggingface.co` and `*.vercel.app`. Suites that import
source modules inside the page ran on the dev server with `scripts/vite-browser-qa.config.mjs`
(R8's procedure); the others ran on the production build (`vite preview`). R3's stress suite
ran alone. No suite or assertion was modified or skipped.

**Test-environment adaptation (disclosed):** every page loads the platform branding script
`https://grok.com/grok-app-builder/extensions.js`, which the sandbox cannot reach, so every
suite's clean-console assertion failed on that one request. A Node preload outside the
repository fulfils exactly that URL with an empty script inside the test browser; every other
request is untouched (a network probe found no other external request). The same preload was
used for the unchanged-main comparisons.

| Result                        | Suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PASS (46)                     | R9: `r9`, `r9:svg`, `r9:integration` (new). Integration: `pr21-r8`, `raster-advanced`, `vector-hidden`. R8: `r8:foundation`, `r8`, `r8:styles`, `r8:processing`, `r8:gradient`, `r8:recovery`. Raster: `r2`, `r2:gesture`, `r5`, `r7`, `layers`, `adjustments`, `pro`, `repair`, `geometry`, `transform`, `color`, `r6`, `r6:layers`, `appearance`, `raster-refinement`, `bench:raster`. Vector: `vector`, `compound`, `pathfinder`, `artboards`, `preview`, `vector-final`. Dialogue: `dialogue:ocr`, `dialogue`, `dialogue:workflow`, `dialogue:render`, `dialogue:security`. Chapter/app: `chapter-import`, `chapter-display`, `editor`, `retouch`, `workflow`, `ui`, `homepage`. |
| PASS (run alone)              | `test:r3:browser` (361 s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PASS (release verifier)       | `test:production:browser http://127.0.0.1:8081 7c47847… --raster` on the production build: release meta matches, homepage gallery, Chapter, Pathfinder, artboard export, gradient, text on path, SVG, native reopen, Raster at 1440 and 390 px, 4096² masked PNG, 0 failed assets. `--ai` was not run (model host blocked).                                                                                                                                                                                                                                                                                                                                                          |
| BLOCKED (external, exception) | `test:studio:browser` — see below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Smoke (`scripts/browser-smoke.mjs`): dev and production build at 1280×800 and 390×844, status
200, visible content, no console/page errors, no horizontal overflow, production verdict does
not diverge from the dev baseline; screenshots inspected.

### External block: `test:studio:browser`

Fails at `studio-browser-check.mjs:123` (AI Enhance expects "Ready to compare", gets "Failed
to fetch") after `Request failed: huggingface.co net::ERR_TUNNEL_CONNECTION_FAILED`. The
sandbox proxy logs a policy 403 for `huggingface.co:443`. **Unchanged main `db78593`, built
and served the same way, fails identically** (same request, same assertion, same line). This
is the previously documented environment limitation; it is recorded as blocked, not passed.
All other AI-independent Studio, Chapter and Raster workflows above pass.

## Failures found and resolved during validation

1. **Join discarded Smart Filters (real defect, fixed in `d923245`).** Found by reviewing the
   merge against R8's geometry rule. A unit test fails before and passes after the guard; the
   integration suite checks the UI refusal and that the document is unchanged.
2. **`test:layers:browser` failed after the merge (real regression, fixed in `7c47847`).**
   Deterministic on the merge, passing on main `db78593` and on R9 `7759fd8` alone (bisected
   with production builds). Cause: Raster's 13 inspector tabs wrapped to a fifth row,
   moving the layer list 48 px and breaking the drag-reorder drop. After the fix the suite
   passed 2/2 in isolation and again in the final matrix; label fit was measured at panel
   widths 260–420 px with no clipping.
3. **`test:raster-advanced:browser` timed out once (procedure fault).** The dev server logged
   `hmr update /src/styles.css` during the run: I was writing a new test file in the
   repository, and Tailwind rescans the tree. It passed on the production build for both the
   candidate and main, and in the final matrix (no repository edits during the run).
4. Initial lane misassignment: six suites that `import()` `/src/…` inside the page were first
   run against the production build ("Failed to fetch dynamically imported module"); they
   pass on the dev server as R8 documents.
5. Three assertions in the new suite were wrong on first run and corrected to the actual
   geometry: alignment uses a 7-point star's geometric bounds (x = 88.50, not 88), the
   rounded rectangle sits above the star in the stack, and the % ruler uses 20 % steps at
   390 px.

## Native document compatibility

| Document                   | Evidence                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-R8 (schema 1/2)        | `r9` edits a schema-2 document (save/close/reopen: identical layers, guides and export); `r2`, `layers`, `pro`, `vector-final` and Chapter suites cover existing documents.      |
| R8 (schema 3, envelope 9)  | `r9:integration`: R8 colour overlay, Smart Filters and Gradient Fill keep identical layer data and pixels through R9 edits, save/close/reopen and preview. `r8:recovery` passes. |
| PR #21                     | `pr21-r8` and `raster-advanced` pass on the candidate.                                                                                                                           |
| R9 data in a pre-R9 reader | Measured against main's validator: stars rejected (all schemas); schema 2/3 `shapeOptions` rejected; schema 1 `shapeOptions` accepted and ignored (documented limitation).       |
| Migration                  | None. No document is rewritten on open.                                                                                                                                          |

## R9 feature coverage

| Requirement                                                 | Covered by                                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Split / Join / Smooth / Simplify, undo/redo                 | `r9` (UI), `path-ops.test.ts` (closed/open split, join across transforms and gaps, smooth, simplify tolerance, locked and non-native refusal) |
| Join with R8 Smart Filters refused                          | `path-ops.test.ts`, `r9:integration`                                                                                                          |
| Text on Path in Raster, Shift+T, Typography, persistence    | `r9`, `r9:integration`                                                                                                                        |
| Arabic/RTL on a path refused without changes                | `r9:integration` (Arabic in ordinary text and Dialogue: `dialogue*` suites)                                                                   |
| Rulers px/%, guides create/move/lock/clear, Ctrl/⌘+R, touch | `r9` (1440, 390 touch), `r9:integration` (1440, 390 touch), `rulers.test.ts`                                                                  |
| Align to canvas, distribute, snapping                       | `r9`, `r9:integration`, `align-canvas.test.ts`, existing precision suites                                                                     |
| Star, rounded rectangle, polygon sides, inner radius        | `r9`, `r9:integration`, `shape-options.test.ts`                                                                                               |
| SVG round trip and unsafe SVG rejection                     | `r9:svg` (pixel-identical re-import; script, event handler, external image rejected)                                                          |
| Layout at 1440 / 768 / 390 / 360 / 320 px                   | `r9` (controls and no horizontal overflow at all five), R8 suites                                                                             |

All widths are Chromium emulation (touch enabled at ≤ 390 px); no physical device was tested.

## Security

The SVG importer/sanitiser, native validators, platform files, CI and dependencies are not
modified by R9 (verified with `git diff` against main). `r9:svg`, `dialogue:security`,
`chapter-import` and `r8:recovery` (malformed/untrusted native data) pass. The only external
request made by the app is the platform branding script.

## Performance (4-core sandbox, Node 22; not a device guarantee)

| Measurement (`bench:r9`, 800 × 16000 page, 42 vector layers, 64 guides) | ms          |
| ----------------------------------------------------------------------- | ----------- |
| `validateDocument`                                                      | 0.317       |
| `buildSnapIndex` (pointer-down)                                         | 3.384       |
| `snapGeometry` per pointer move                                         | 0.009       |
| `smoothPath` / `splitPathAt` (900 anchors)                              | 1.03 / 1.62 |
| `joinPaths` (900 + 2 anchors)                                           | 1.468       |
| `simplifyPath` (900 anchors, 2 px)                                      | 84.3        |
| `rulerTicks` (both rulers)                                              | 0.006       |

Simplify re-benchmark on the same input: pre-optimisation `47b6d4f` took **44.1 s** on this
machine (91 s was reported on other hardware) and ended 2.238 px from the source curve with a
2 px tolerance; the current algorithm takes **75–106 ms** and stays within tolerance —
maximum deviation 0.484 / 1.58 / 4.705 px at 0.5 / 2 / 8 px tolerance (900 → 490 / 108 / 96
anchors), endpoints kept.

Long-page rendering (`bench:raster:browser`, production Chromium worker): 1024 × 8192 import
preview 871 ms, PNG export 1.43 s; 4096 × 4096 export 2.85 s; sampled peak browser RSS 1.67
GiB. Existing image-processing limits are unchanged.
