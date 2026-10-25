# R8 test report

Status: baseline audit. R8 tests and final regression are pending; no milestone is declared complete.

Baseline is main `02eb697450a7eeeadbd53d73cea5931905c5b2f2`. Dependency installation and the existing full unit suite were run in the isolated worktree; raw logs are retained under `/workspace/r8-evidence/`. Final totals, new pixel/security tests, browser results, exact-head CI and measured performance will be added after execution.

Existing zero-tolerance R6 recovery/export and Artboards readiness checks must remain unchanged. The previously confirmed cold Vite dependency optimization reload is an environment concern for source-module browser probes: capture and diagnose it, never hide it with arbitrary sleeps or weaker assertions. UI tests use existing Playwright infrastructure if the documented agent-browser CLI remains unavailable. Chromium mobile emulation is not physical Android testing.
