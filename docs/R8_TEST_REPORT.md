# R8 test report

Status: R8.1–R8.4 and targeted hardening tests pass. Full frozen-candidate regression and final CI remain pending. Historical audit/results below record actual implementation stages.

Baseline is main `02eb697450a7eeeadbd53d73cea5931905c5b2f2`. Dependency installation and the existing full unit suite were run in the isolated worktree; raw logs are retained under `/workspace/r8-evidence/`. Final totals, new pixel/security tests, browser results, exact-head CI and measured performance will be added after execution.

Existing zero-tolerance R6 recovery/export and Artboards readiness checks must remain unchanged. The previously confirmed cold Vite dependency optimization reload is an environment concern for source-module browser probes: capture and diagnose it, never hide it with arbitrary sleeps or weaker assertions. UI tests use existing Playwright infrastructure if the documented agent-browser CLI remains unavailable. Chromium mobile emulation is not physical Android testing.

## R8.1 foundation results

- Baseline:942 tests pass (200 scripts +59 app/auth +105 Studio +578 Pro).
- Foundation:971 tests pass (200+59+105+607),0 failures/skips. Includes27 new tests and two additional existing effect-family cases. Typecheck passes.
- New worker browser test passes schema3/envelope9 native round trip, Smart Filter order, real color overlay, R7 selection mask, R6 invert adjustment, unchanged original asset/settings and zero-tolerance preview/PNG/reopen equivalence.
- Initial new tests found an explicit undefined parent field in new fill metadata; production creation now omits it. A Surface Blur fixture initially placed its noise impulse within the tested edge kernel; it now separates the noise and edge regions, retaining exact numeric edge assertions.
- The first browser invocation preceded dev-server readiness and failed connection establishment. After the server answered, the unchanged test passed; both logs are retained. No image tolerance/delay or existing test assertion changed.
- Full R8 UI/mobile/performance/recovery/CI validation remains pending.

## Transactional properties and initial hardening

The new properties workflow passes1440/768/390/360/320px: creation Cancel adds no layer/history, Apply commits one entry, styles modify real pixels, filter reorder changes output, custom presets save, edit Cancel restores exact settings/assets and native/PNG reopen matches at zero tolerance. Layout was refined after screenshot review to keep the preview/header/transaction controls visible while the controls column scrolls.

An early workspace hook referenced Quick Mask before initialization; typecheck/UI caught it and the hook was moved below that initialization. The gradient pointer harness initially exported while its inspector remained hidden; it now reopens the inspector through the actual UI. These were diagnosed, not hidden with sleeps or looser pixels.

Current working implementation passes988 full unit tests (200+59+105+624), typecheck and lint with0 warnings. Targeted gradient/filtered-painting suite passes all five widths with zero-tolerance native/reopen/PNG comparisons. Its tests found R6 blur preserved coverage by design; Smart Gaussian/Motion use an explicit premultiplied coverage-blur mode in the shared kernels, while the original R6 default stays unchanged. Original R6 tests pass unchanged. Remaining recovery/performance/full-browser/final-HEAD CI work is pending.

## R8.3 worker integration

`r8-processing-browser-check.mjs` passes actual worker/filter-selection-mask/layer-mask staging, neutral R6 color-source replacement without double filtering, native reopen, whole-layer transforms, hidden-layer exclusion and explicit mask-bake/selected-pixel guards. All deterministic pixels use tolerance0. Its first fixture attempted OffscreenCanvas encoding before creating a rendering context; creating the actual2D context fixes the fixture, with no production/tolerance change.

The filtered-painting regression initially found Gaussian output still had original brush alpha. Diagnosis confirmed the shared R6 filter intentionally preserved coverage. The R8 Smart path now opts into alpha blur in the same kernels; original R6 tests remain unchanged. The strict brush-halo assertion, preview/PNG equality and native reopen pass after the implementation fix.

## R8.4 targeted results

The expanded properties suite passes1440/768/390/360/320 including actual touch stop reordering, preservation of midpoint records, before/after pixels, rapid seed changes, one-entry Apply, source-asset equality, native/PNG equivalence and no horizontal overflow. The Raster gradient tool suite passes the same five widths: source-local endpoint dragging, Escape/touch cancellation, retained R7 mask, exact Undo/Redo/export/native reopen and blurred-paint preview invalidation. Pointer coordinate assertions account for browser input quantization; all image comparisons remain tolerance0.

Focused gradient/style tests68 pass; typecheck and lint pass with0 warnings. Gradient midpoint exponents are precompiled once per stop instead of recomputed per pixel, retaining the same interpolation formula. Full R8.5 recovery/performance/final CI remain pending.

## R8.5 targeted security, recovery and performance

- Full working suite1002 passes (200 scripts +59 app/auth +105 Studio +638 Pro). Typecheck, lint0 warnings, production build, check:build and check:auth pass after correcting the new traversal's explicit parent-ID type. Final frozen candidate runs remain pending.
- Recovery browser passes native9/schema3/store5, actual old-writer VersionError, autosave reload, a real blocked-write close with changed gradient settings, durable latest native record and fresh-context Chapter backup restore at390px. Complex styles/filter masks/groups/clipping/R6 adjustment/R7 mask/selection/R3 strokes/R5 metadata persist with source-asset equality and pixelTolerance0.
- The actual pre-R8 main reader (02eb697) rejects native9 and internal3, while its legacy native file opens in R8 with unchanged source bytes.
- Untrusted metadata tests reject future versions/filter/style types, malformed gradients/masks, giant dimensions, prototype keys and corrupt JSON before any atob/embedded-image decode. Visible filter work cannot be multiplied beyond128M by adding layers; hidden originals do not consume render work.
- All nine style families alter real browser pixels and disable back to exact source. Copy/paste, duplicate presets, removal Undo/Redo and Quick Mask exclusion pass1440/320. Pure tests cover spread/choke, gradient stroke geometry, pattern repeat/offset, relief direction/depth, alpha, style order and invalid records.
- Worker benchmarks cover512²,1024²,2000² filtered/masked/styled cases and4096²/128-stop gradient-only. RGBA/source hashes remain exact after native round trip; every12-edit burst sends2 physical preview jobs. Raw timing/RSS observations are in the implementation report and evidence JSON.
- Initial benchmark fixture used an invalid Array.from callback argument; it failed before measurements and was corrected. Both logs are preserved; no benchmark values were invented or extrapolated.

Remaining final gates: frozen-source install/unit/type/lint/build/config/auth, all41 browser suites plus raster benchmark/local production-build acceptance, final CI, read-only concurrent PR20 integration analysis and final reports. No phase-complete/merge/deployment claim is made yet.

The complex recovery suite additionally verifies PNG, JPEG and WebP before/after fresh-context recovery with per-format decoded-pixel tolerance0. Actual pre-R8 reader compatibility and new format rejection results are committed under docs/r8-evidence. All six R8 suites are registered; the complete matrix is41 suites plus the existing raster browser benchmark.

## Full-regression finding: legacy appearance controls

The first frozen candidate (`44c36b7`, source `3ce5ddc`) passed the first21 registered browser suites, then the unchanged Appearance suite timed out waiting for `Gradient type`. R8's Raster properties slot replaced the existing direct `ProAppearance` controls, so legacy gradient/effect workflows lost their interface. Rendering and saved pixels were not the cause. The workspace now retains the existing controls for schema1/2 documents, excludes temporary Quick Mask, and uses the transactional R8 editor after schema3 opt-in. The new UI test explicitly checks legacy access and absence of duplicate controls after upgrade. The original Appearance suite passes unchanged, including all seven legacy styles, gradient history/native/PNG/JPEG/WebP, independent adjustments and320px touch. The targeted R8 properties workflow, typecheck and lint pass after the fix. Final frozen regression is being restarted; the original failure log is preserved.
