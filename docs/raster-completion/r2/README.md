# R2 validation evidence

Runtime source is commit `3428a0dfc31a25cbf3496d929c4bb476b1594af5`, `src` tree `9218ccf3090f810dd2b28d7c7c01f6cb293823ce`. Final documentation commits preserve that runtime tree. See `EVIDENCE.json` for the final command ledger and the PR for exact final-HEAD Actions.

All browser tests target ephemeral local projects; screenshots contain internally created fixtures. Source-module suites use DEV; normal suites use the built application. Actual Swin2SR/Tesseract tests are distinguished from injected resource/URL failures. Browser touch emulation is not physical Android testing.

`development-evidence/` retains original failures and intermediate results. The first 27-suite run failed Artboards and passed 26; after correction the same 27-suite run passed on 4ff. The next run was explicitly interrupted for another confirmed transaction fix, not counted as complete. Final 28-suite results appear separately. Existing assertions were retained.

The isolated pre-fix mask diagnostic intentionally expects the already-reproduced broken stroke count 2 only to reach the independent mask-plane assertion; it is archived as diagnostic source, not a passing regression. The permanent test still requires count 0 after Undo. The property probe independently proves an unfinished stroke was committed with opacity; final regression requires its absence. Optional absent native selection equals the existing empty-selection default.

Smoke screenshots taken before application initialization could capture the loading screen; readiness-gated runs wait for a visible homepage h1. The original collapsed-text built/dev failure and invalid CLI flag invocation are retained. Passing readiness-gated screenshots were visually inspected on both desktop and mobile.

Benchmark JSON reports actual request counts, surface dimensions and timings on shared CPU/Chromium. Quiet-window wall times are not interaction latency; nominal surface bytes are not peak RAM. The before-cache probe uses the original R1.1 built application; the mask comparison uses the exact old scale formula and current unchanged compositor. Thumbnail helpers/cache are byte-identical between their implementation commit deb514c and the final runtime. Archived helpers include execution-environment absolute paths for provenance; reusable scripts live under scripts/.

`SHA256SUMS` covers this bundle except itself. No merge, Ready conversion, main mutation or Production deployment was performed. A branch Preview triggered by the repository integration does not represent a Production release.
