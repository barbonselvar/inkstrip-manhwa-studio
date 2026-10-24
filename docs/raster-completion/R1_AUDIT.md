# R1 — repository audit, gap analysis and reproducible Raster baseline

Date: 2026-10-24. Scope: **R1 only** under the attached Raster Studio master prompt. No R2 implementation, F2, merge, production deployment, environment change, framework migration or replacement graphics engine is authorized/performed by this work.

The earlier PR #9 R1 audit is preserved byte-for-byte in [archive/PR9_R1_AUDIT.md](archive/PR9_R1_AUDIT.md). Its earlier environment/browser restrictions and R2/R3 reports remain historical evidence; this audit supersedes its current-state claims without deleting that work.

## Executive assessment

The merged Raster editor already has substantial working pixel, geometry, layer, mask, repair, adjustment and persistence functionality. The appropriate next step is targeted completion of evidenced gaps, not reconstruction. No dead/no-op advertised Raster tool was found in the audited control paths; this is not a claim of exhaustive behavior across every setting, document and device.

R1 includes one narrow High resource-safety correction: standalone Assets imports now reject oversized raster headers/bytes **before image decoding**, reusing native-import checks. Real-UI reproduction first recorded one decoder invocation for an oversized header; the corrected path records zero, with identical document/asset state. Three regression tests plus the actual UI audit were added. It does not add a new tool or change native geometry.

An additional general Chapter-image decoding resource boundary remains a High follow-up: the multi-format Chapter pipeline decodes before size planning. Its wider format/long-chapter policy needs an agreed supported-size decision; the existing Chapter workflow was not silently restricted in R1. Other material limitations include preview resolution, bounded memory/history, non-semantic matting, limited brush/filter families, native-v6 branch separation, and lack of physical-device validation. **The overall Raster completion program still needs work; R1 is not a professional-parity or production-release certification.**

## A. Verified Git, integration and deployment baseline

| Reference                                         | Observed state                                                                                                                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                                        | `barbonselvar/inkstrip-manhwa-studio`; connected GitHub permissions include pull/push/admin                                                                                                                                              |
| Actual main / starting SHA / merge base           | `a90c656c8b68cb2016a7a1cd09e720ef3ed145ab`                                                                                                                                                                                               |
| R1 branch                                         | `codex/raster-studio-completion`, created from fetched `origin/main` with a clean starting tree                                                                                                                                          |
| Narrow fix commit                                 | `9ac54645643ae01b297ad1de00c4d28b590b07e5`                                                                                                                                                                                               |
| Final audit HEAD / Draft PR / exact remote status | [Draft PR #13](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/13); exact remote HEAD is recorded in the PR body. Obtain checkout HEAD with `git rev-parse HEAD`. Documentation does not embed its own recursive commit hash |
| Active Raster work                                | No open Raster PR at start. Historical Raster PR #4 and#9 and workspace-split PR #10 are merged; their branch refs remain, not new integration dependencies                                                                              |
| Historical Raster merge#4                         | `ced5907f5e0bfc49e72588fe76d3cbf652d39b7f`; refinement/masks/dynamics already implemented                                                                                                                                                |
| Historical Raster merge#9                         | `363b0daa7ea45dc9963461cd94013bea4a0f6657`;16 blend modes, feather fallback and Paint Bucket already implemented                                                                                                                         |
| Workspace split merge#10                          | `578e6839390c9350be260b72a1d7de15856850b3`; tool table and inspector tabs already extracted                                                                                                                                              |
| Homepage/Dialogue                                 | PR #11/#12 merged; both retained and regression-tested                                                                                                                                                                                   |
| F1 PR #6                                          | Open Draft, unmerged, HEAD`1b71cb20bb46703c3fe812ec8e13792814d89bd3`; GitHub reports `mergeable:false`, `mergeable_state:dirty`. Its stale base SHA is not the R1 merge base                                                             |
| Production baseline                               | Existing Vercel status for main is success, deployment`CUawgQh3B71AqqG4hrPmEcYEcugh`; no production deployment was requested or triggered by R1                                                                                          |

`git fetch origin --prune`, GitHub branches/open PRs/main/PR #6/CI queries and `git merge-base HEAD origin/main` established the baseline. Main's existing build/configuration runs40080732465/40080732524 passed. Branches for completed earlier phases remain preserved. GitHub's actual R1 status, not a historical report, governs review.

Deployment automation inspection: `.github/workflows/build.yml` and `ci.yml` trigger for main pushes and PRs to main, plus manual dispatch. They install, typecheck, build, run configuration checks; the configuration workflow also lints/tests. Browser/benchmark scripts are not Actions jobs. Existing Vercel integration handles production main and may create a branch preview; a branch preview is not a production release. No workflow or Vercel setting was changed.

## B. Complete control inventory and architecture

- [Capability matrix](CAPABILITY_MATRIX.md): implemented/verified, partial, broken/fixed, missing and deferred states with evidence and explicit limits.
- [Dependency and command map](DEPENDENCY_MAP.md): every Raster rail tool plus header/context/inspector command families, model fields, worker/compositor/save/export consumers.
- [Source control catalog](CONTROL_INVENTORY.json):259 JSX definitions in11 Raster-accessible shared surfaces, including conditional/map-generated definitions. It is not259independently interacted-with controls.
- [Reproducible catalog generator](generate-control-inventory.mjs): no external service/new dependency.

Current architecture: React19/TypeScript/TanStack/Vite, existing `ProWorkspace` controller and `ProCanvas`, immutable `ProDocument` snapshots and asset pool, bounded existing `ProRenderer`/OffscreenCanvas worker compositor, IndexedDB sessions, Chapter media transactions and portable native/project backups. Raster/Vector/Dialogue share compatible data; view mode is not a conversion/flattening operation. Existing AI handoffs use established Chapter tools; F1 remains separate.

Trace methodology: read the actual rail mode sets and keyboard bindings, pointer begin/update/end/cancel paths, every audited inspector's handlers/disabled conditions, central `commit/patch`, model validation, worker request dispatch, native compositor/output functions and storage/file consumers. Cross-reference existing algorithmic tests and actual worker/UI tests. Controls that only navigate, pan, zoom, show a panel or stage a draft correctly have no immediate native-state mutation. Radix trigger/cancel elements can be functional without a local onClick. Source trace and broad browser coverage are distinguished from exhaustive per-control combination coverage.

Historical documents reviewed as evidence, then checked against source: `PHASE_E_RASTER_REFINEMENT.md`, `RASTER_REPAIR_ENGINE.md`, `RASTER_GEOMETRY_ENGINE.md`, `PRO_COLOR_ENGINE.md`, `ADVANCED_LAYER_ENGINE.md`, `creative-platform-feature-inventory.md`, subsequent shared layer/transform/vector/Dialogue code. Historical “missing” gradients/effects and old6-mode blend statements are superseded by actual current implementations. No duplicate tool was created.

## C. Native integrity, source and history audit

Internal `ProDocument.version` remains1; the portable envelope separately selects versions1–5 or7 by feature. Native v6 actually exists on the unmerged F1 branch and carries AI/source/provenance fields. Current main rejects it and same-origin AI drafts explicitly, preserving their original data. **Supporting F1 v6 is deferred, not counted as a passing compatibility test.** Silently treating AI layers as ordinary rasters would be incorrect.

Reviewed and tested boundaries:

- Strict document graph/IDs/types/numeric limits; validation rejects group cycles, duplicate IDs, unsupported executable content and missing source/clone references.
- Immutable raster assets are shared by IDs across duplication/history; `mergeNativeSession` remaps incoming IDs without overwriting prior sources. Current/hidden/original/clone/mask referenced assets are serialized; unused history assets are omitted from portable files, not from the live undo pool.
- Repeated25native cycles retain original bytes without exponential file growth. Representative v1/v2/v3/v4/v5feature fixtures and Dialoguev7 round-trips exist across files/geometry/compound/artboard/vector/refinement/Dialogue tests. They do not establish compatibility with every unreleased development draft.
  -70 MB portable-file cap, 64 assets checked before embedded Blob allocation, 48 MB asset pool, image container-header/actual-decode preflight. Malformed metadata, missing assets, pixel oversize, invalid transforms and incompatible schema errors reject before import publication.
- Native import is an undoable document replacement after preflight; old immutable assets remain available for Undo. Exports use the same native compositor/output stage as Chapter apply. Original Chapter artwork is retained by revision-checked media replacement.
- `persist` serializes saves and preserves newer in-memory assets across asynchronous save acknowledgements. IndexedDB save checks expected revision and recovery token in a transaction; conflicts retain work and offer native recovery. Project recovery stages native sessions atomically with Chapter import, and refuses colliding IDs.
- History:50 past metadata snapshots, current and future; conservative32 MiB soft accounting retains the nearest Undo/Redo even if above budget. Assets are separately bounded, not freed when old history is evicted. History timeline is session-only; native files preserve current editability, not every previous Undo state.
  -500 ms autosave debounce and beforeunload warning improve recovery but cannot guarantee the last edit survives sudden process/device termination. Bounded full-memory JSON/base64 parsing is not streaming or cooperatively cancellable.

Evidence is existing pure tests plus real Pro/layers/repair/geometry/transform/refinement/Dialogue security/workflow browser tests. No actual user's projects were opened or modified; isolated browser fixtures were used.

## D. Severity-ranked findings

### H01 — High — standalone Raster import decodes before its budget check — fixed

Evidence/root cause: original `ProWorkspace.addAsset` called `decodeBlob(blob)` before checking decoded pixel area. `images.decodeBlob` immediately calls `createImageBitmap`, then falls back to an Image element. This can allocate a huge decoded surface before rejecting a small compressed file. Native imports already used bounded header checks.

Reproduction: `node scripts/raster-import-audit.mjs http://127.0.0.1:8080` feeds a24-byte PNG header claiming65535×65535 through the actual Assets control and counts relevant main-thread bitmap decode calls. On the original source: **1 decode call**, generic “decode” failure, document/assets unchanged; assertion fails as intended. This is call-order proof, **not an attempt to allocate a genuine multi-gigapixel image or proof of an observed browser crash**.

Small correction: `validateRasterInput` reuses `rasterSize` and existing 48 MB / 16384-side/device-pixel limits before standalone decode; native preflight shares that guard. Post-fix UI evidence: **0 decode calls**, explicit pixel-budget error, document/assets byte-identical. JPEG axis swaps/previous native decoder checks remain. Three new unit tests cover exact accepted limits, corrupt/unsupported data, excessive dimensions, invalid budgets and byte-limit-before-payload-read. Existing actual image workflows cover valid imports/exports; no mock is offered as proof of decoding real artwork.

Files: `src/components/studio/pro/pro-workspace.tsx`, `src/lib/studio/pro/native-images.ts`, its test, and `scripts/raster-import-audit.mjs`. Fix commit9ac5464. No schema/dependency/graphics change. Remaining decoder risk is bounded by browser implementation and general Chapter path H02.

### H02 — High — general Chapter import predecode resource policy — unresolved, reported

Evidence: `src/lib/studio/store.ts` image-add loop invokes `decodeBlob(file)` before thumbnail creation or Chapter sizing; `src/lib/studio/images.ts:decodeBlob` has no compressed-byte/container-size preflight. Chapter accepts formats beyond Pro's PNG/JPEG/WebP (including formats with different/unsupported browser decoders) and intentionally supports long source images before export strip planning. H01's supported-format guard cannot safely be imposed on this whole path without selecting a compatible large-image/format policy.

Risk: user-selected malformed or enormous compressed input may consume excessive decoder memory before rejection/recovery, potentially losing unsaved work if the browser terminates. No actual crash or exploit was induced. This is a confirmed code-order/resource boundary, not a remote-code-execution or server SSRF finding. R1 does not claim the existing supported Chapter formats are newly secure.

Disposition: do not silently remove Chapter formats or cap valid long chapters in an audit-only change. Request approval for a bounded supported-header/unknown-format policy and separate tests, prioritized before new feature work (R2 foundation / R8 / R10 coordination). No architecture redesign was attempted. Overall release recommendation remains **NEEDS ADDITIONAL WORK** despite R1's completed audit.

### M01 — Medium — native-zoom fidelity and full-preview recomputation — documented

Evidence: worker preview scale is `min(1, 1400/maxDimension)`. `previewDirtyRect` limits presentation copying; the underlying compositor still renders the bounded full preview. Eyedropper reads that canvas rather than native pixels. Native selection/repair/export use source resolution. Deep zoom/sample detail therefore differs from native export. No false native-detail preview or fully tiled-renderer claim. R7sampling/R8ROI profiling proposal; significant engine work requires approval.

### M02 — Medium — device/history/immutable-pool ceilings — documented

Evidence: current48 layer/64 asset/48 MB pool, 16384 side, 16,777,216 desktop / 4,000,000 coarse or low-memory pixel budgets; effect/source aggregate guards;50 snapshot/32 MiB soft history. Metadata equality and budget sizing use JSON serialization. Work stays protected when validation fails, but long sessions/large strokes can hit caps or cost main-thread time. No measured latency guarantee or peak-memory universality. R2/R8 must profile before redesign/GC.

### M03 — Medium — unavailable F1/native-v6 interoperability — explicit safe boundary

Evidence: PR #6 unmerged/dirty, model lacks AI layer fields, readNative rejects6, storage preflight refuses overwriting F1 draft provenance. Safe rejection is correct for this baseline; new R1 work does not resolve F1 integration. Separately approved integration is required; no F2or branch merge.

### M04 — Medium — professional algorithm coverage and artwork validation are incomplete

Evidence: `pro-tools.ts` lacks smudge/wet/dodge/burn/sponge/magnetic/semantic selection; brush tips are round/square, “Texture” is a seeded recipe; repair uses bounded local translated donor search and spatial RGB adaptation; matting does not decontaminate source RGB; basic filters are box blur/unsharp/edge-weighted noise reduction. Existing controls do work within those bounds. See matrix for missing vs partial; no placeholder buttons introduced. R3–R7scope and rights-cleared difficult artwork validation remain.

### M05 — Medium — CI does not run browser/performance gates

Evidence: both checked workflow files omit browser/benchmark commands. They run unit/config/build gates only. R1 executes browser checks explicitly and records outcomes; Actions success alone does not verify interaction/export/performance. Proposed R10CI improvement needs separate scope; no duplicate deployment workflow added.

### L01 — Low — historical/help wording is incomplete

Evidence: Assets help in `pro-inspector-tabs.tsx` still says SVG gradients/clips are rejected, while current `svg-import.ts` accepts a documented supported subset. History help describes count but omits soft-byte eviction. Historical docs retain earlier missing-feature statements. Current audit/matrix identify actual behavior. No algorithm/UI behavior changed merely to update historical prose; targeted wording cleanup belongs to R9/R10.

No confirmed Critical issue was found in the inspected R1 paths. A green audit subset is not proof of absence of all defects/security vulnerabilities.

## E. Reproducible validation and baseline evidence

See `EVIDENCE.json` and `baseline/*` for exact commands, exit codes, suite timings, initial failed attempts and final results. Captured logs remove ANSI terminal decoration and trailing whitespace only; assertion text, failures and results remain. The initial raw build log triggered whitespace warnings during documentation staging; normalized copies and refreshed SHA-256 manifests resolve them without changing tests. Before H01 changes:750 tests passed, typecheck/lint/build/config/auth passed; `npm audit --json` reported0advisories across506dependency entries. After H01: **753 tests passed** (200 script+59 shared+49 Studio+445 Pro), zero failures/skips/cancellations. No test was removed/weakened.

```sh
git fetch origin --prune
git merge-base HEAD origin/main
node docs/raster-completion/generate-control-inventory.mjs
npm run typecheck
npm run lint
npm test
npm run build
npm run check:build
npm run check:auth
npm audit --json
node scripts/raster-import-audit.mjs http://127.0.0.1:8080
node scripts/raster-import-audit.mjs http://127.0.0.1:8081
node scripts/browser-smoke.mjs http://127.0.0.1:8080/ /workspace/screenshots/r1/final-dev.png --ready-selector .new-project-button
node scripts/browser-smoke.mjs http://127.0.0.1:8081/ /workspace/screenshots/r1/final-built.png --baseline /workspace/screenshots/r1/final-dev.json --ready-selector .new-project-button
npm run bench:raster
npm run bench:raster:browser -- http://127.0.0.1:8081
git diff --check
```

Existing full browser suite list: studio, editor, adjustments, retouch, workflow, ui-redesign, pro, layers, repair, geometry, transform, color, appearance, vector, compound, pathfinder, artboards, vector-final, raster-refinement, homepage, dialogue, dialogue-workflow, dialogue-render, dialogue-security, dialogue-ocr. Commands are `node --experimental-strip-types scripts/<name>-browser-check.mjs <base>`. The first 22 run against built8081; the last 3 require source modules and run against dev8080. Full final results and exact command strings are in the machine-readable ledger.

**Disclosed initial failures:** the first source-only Dialogue render/security/OCR attempts were incorrectly pointed at built preview; dynamic `/src/*.ts` imports failed. These are harness-target errors, not product assertion passes. Their full assertions are rerun on the required dev target. The first R1 import probe used an incorrect error selector and was inconclusive; after correction the expected pre-fix assertion failed, proving H01. An external supplemental viewport copy initially could not resolve Playwright outside the repository; correcting the module path allowed the same assertions at360/768. None of these failures is omitted from the ledger or counted as a pass.

Supplemental 360/768touch validation reuses the unchanged Raster-refinement assertions with only viewport array/import paths changed; it exercises refinement, mask density/feather/linkage/group alpha, nativev5 round-trip, seeded brush, destructive-bake pixel equivalence/Undo, PNG/JPEG/WebP, cancellation and no errors. Existing suites cover320/390and desktop, including real worker pixels, original bytes, source-resolution geometry, pen-event injection and actual Swin2SR inference. The absent `agent-browser` CLI was replaced by installed Playwright; touch emulation is not physical Android/stylus validation.

No inference mock establishes actual AI capability. Existing Studio browser tests execute real Swin2SR and batch/cancel/recovery; no generative repair capability is claimed. Browser source tests may mock an individual failure boundary (for example quota/late response); full UI/worker/native output tests remain real.

## F. Performance baseline and limitations

Current measurements: `baseline/cpu-benchmark.json` and `baseline/browser-benchmark.json`. R1 runs existing benchmark scripts without altering quality or disabling guards. Performance results are evidence, not release gates for all hardware.

Method: one process-cold CPU run per2048²/4096²/1024×8192generated line-art mask; source-resolution refinement plus8 px morphology and100 recorded strokes. One cold import/preview/export per corresponding browser document with3layers, density/feather mask and50 deterministic strokes; native PNG dimensions decoded and asserted. Browser benchmarks run after regression suites, not concurrently with them. OS/JIT/cache state is not globally cold and there is no repeated warm-start distribution. Separate warm-start metrics, real artwork aesthetic evaluation and pen-latency/FPS are **not measured**.

Environment: Linux x64, AMD EPYC 9V74 shared CPU, Node 24.19.0, Chromium 156.0.8078.4. CPU process maxRSS is a high-water mark across sizes, not per-operation peak. Browser memory samples sum the launched Chromium process tree every200ms, may double-count shared pages, and include browser/GPU/runtime overhead and preceding documents. No universal Android memory/performance guarantee or exact GPU memory figure is inferred. Measured baseline (milliseconds):

| Dimensions | CPU refine | CPU expand8px | Browser import/preview | Native PNG export |
| ---------- | ---------: | ------------: | ---------------------: | ----------------: |
| 2048×2048  |    1765.78 |        177.49 |                 1037.6 |             899.4 |
| 4096×4096  |    6671.45 |        699.12 |                 1531.7 |            2523.7 |
| 1024×8192  |    3283.43 |        297.25 |                  858.8 |            1142.0 |

CPU high-water RSS reached 214.7 MiB across the run. The 100-stroke / 171,200-dab generation benchmark took 32.00 ms; that is dab generation, not painted stroke latency. Sampled summed Chromium process-tree RSS reached 1551.6 MiB. Native PNG dimensions were verified for every size, and no browser errors were recorded. These large process footprints reinforce the need for R8 profiling rather than claiming universal mobile support. No rendering algorithm was optimized or quality reduced in R1.

Color/fidelity limits: 8-bit browser Canvas/sRGB, encoded-RGB adjustments/resampling, no end-to-end 16-bit/CMYK/ICC soft-proof/profile-preserving pipeline. JPEG uses white after editable compositing, PNG preserves alpha and WebP uses browser encoding. Nonlinear filtering/warp are bounded approximations; masks have documented receiving-plane/frame limits. Do not call the editor Photoshop-equivalent.

## G. Prioritized R2–R10 proposal — not started

| Phase                        | First approved work to consider                                                                                                                                    | Dependencies / acceptance evidence                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| R2 — document/layers/history | Resolve agreed H02 input-resource policy with Chapter compatibility; validate transactional recovery/history near limits; preserve already working 16 modes/merges | Fixed source assets, hostile-input preflight and cross-tab/failed-save pixel/native tests; no replacement compositor        |
| R3 — painting                | Prioritize image-tip/taper/preset exchange and missing painted retouch tools only after real inking use cases; evaluate stationary airbrush separately             | Deterministic replay, bounded dabs, native/export and actual stylus review before pressure-quality claims                   |
| R4 — selections/masks        | Native transform-selection/border, proven fringe decontamination and hard-edge/artwork fixtures; retain current matting/Boolean engine                             | Protected-pixel/alpha/coordinate tests; semantic tools only with actual validated model                                     |
| R5 — repair                  | Better source controls/fixture-driven donor/seam behavior; assess pattern/dust workflows                                                                           | Damaged-art comparisons, selection protection, cancellation/source bytes and bounded native execution                       |
| R6 — geometry/precision      | Expose only missing Raster precision workflows; canvas anchors/trim/selection transform; assess nonlinear limits                                                   | Shared transform/mask math, exact output and Apply/Cancel, no recreation of crop or homography                              |
| R7 — color/filters           | Free-form curves/filter coverage and native sampling first; identify worthwhile editable filter stack                                                              | Reference math/alpha and preview-vs-export proof; ICC/16bit/CMYK deferred until end-to-end feasible                         |
| R8 — performance             | Profile source-detail view, full preview replay, history serialization and long-session pools; define supported limits before tiled/ROI redesign                   | Reproducible warm/cold, native dimensions, bounded cancellation/recovery, approval before engine-level migration            |
| R9 — workspace/mobile        | Existing control/help correctness, ruler/precision access, shortcuts/accessibility and actual Android/stylus testing                                               | 320/360/390/768/desktop interaction/overflow, focus and orientation tests                                                   |
| R10 — release readiness      | Close H02 and all agreed High issues, rights-cleared difficult-art corpus, compatibility/security/export and CI browser gates                                      | Full native/history/source/format failure matrix, measured budgets and final release report; separate merge/deploy approval |

## Final recorded validation

- Final hardened source: **753 unit tests / 25 existing Chromium suites passed**, 0 failures or skips in the final run. Full typecheck/lint/build/config/auth checks passed. The source-only Dialogue suites passed on dev after the disclosed initial wrong-target attempts.
- Supplemental 360px/768px native touch validation and both dev/built oversized-import probes passed. The latter records zero decoder calls with unchanged native document/assets. Existing 320px/390px/desktop suites include real paint/repair/mask/history/export and Chapter original-byte checks.
- Dev and production-build smoke passes show visible content, clean consoles, no overflow, no brand/auth warnings and no baseline divergence; both screenshots from each run were inspected.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund` passed with Node 24.19.0/npm 11.9.0. It is a lockfile dry run, not a claim of a fresh local installation or Node 22 validation. Exact code-fix GitHub Actions build 40094129351 and configuration 40094129345 passed, including fresh CI installation. Final documentation-HEAD Actions status is maintained in PR #13.
- No browser assertions were weakened, no existing tests removed and no paid/remote inference introduced. Source code remains the 9ac5464 runtime tree recorded in `EVIDENCE.json`; subsequent audit commits only change reports/evidence.
- Preserve the prior audit: `archive/PR9_R1_AUDIT.md` is byte-identical to the original main file. Historical R2/R3 reports and prior benchmark remain intact.

## H. Stop and review checkpoint

R1 changes consist of the audit artifacts, reproducible source catalog, the narrow H01 guard and its regressions. No new editor tools, schema migration, paid dependency, credential, F1 integration or production change was introduced. R1 must remain a Draft PR. The program is **NEEDS ADDITIONAL WORK**; H02 and documented capability/device gaps prevent claiming full Raster readiness.

Phase complete. Awaiting explicit user approval before proceeding to the next phase, merging into main, or deploying to production.
