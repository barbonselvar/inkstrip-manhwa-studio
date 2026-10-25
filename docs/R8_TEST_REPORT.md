# R8 test report

Status: baseline audit. R8 tests and final regression are pending; no milestone is declared complete.

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
