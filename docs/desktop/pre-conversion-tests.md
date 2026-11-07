# Pre-conversion stability tests

Run on Windows 11 Pro (i7-12700H, 32 GB, RTX 4050 Laptop) at commit `140ac65`, then again
after the fixes. Status: **PASS / FAIL / NOT RUN**.

| Check | Before fixes | After fixes | Notes |
|---|---|---|---|
| `npm ci` | PASS | PASS | |
| `npm run typecheck` | PASS | PASS | |
| `npm run lint` | PASS | PASS | Generated desktop bundle excluded from lint |
| `npm test` | PASS **but 0 script tests ran** | PASS — 1,212 tests (204 + 64 + 151 + 707 + 86) | See defect D2 |
| Production web build (`npm run build` → `vite build`) | **FAIL on Windows** (`spawn vite ENOENT`) | PASS | Defect D1 |
| `npm run check:build` | NOT RUN (no build) | PASS | Vercel output, runtime assets, PWA icon, tslib bundling verified |
| Desktop main-process unit tests (new) | — | PASS 25/25 | `npm run test:desktop` |
| Desktop end-to-end suite (new, offline) | — | PASS 13/13 | `apps/desktop/test/e2e-desktop.mjs`; details in desktop-test-results.md |
| Playwright browser suites (`scripts/*-browser-check.mjs`) | NOT RUN | NOT RUN | They need a dev server and write to `/workspace/…`; the desktop E2E covers Composition/FX persistence in the real app instead |
| `npm audit` / dependency security | NOT RUN | NOT RUN | No network audit was performed in this session |

## Defects found and fixed

| ID | Severity | Defect | Root cause | Fix | Regression coverage |
|---|---|---|---|---|---|
| D1 | High (Windows) | `npm run build`/`dev`/`preview` fail on Windows with `spawn vite ENOENT` | `scripts/with-app-env.mjs` spawned `vite` without a shell; npm installs `vite.cmd` on Windows | Spawn through `cmd` with quoted arguments on Windows | Build runs in desktop CI on `windows-latest` |
| D2 | Medium (silent) | `npm test` ran **0** script tests on Windows | The glob was single-quoted (`'scripts/**/*.test.mjs'`); `cmd` passes the quotes literally | Double-quoted escaped glob | 204 script tests now run; two symlink tests use a directory junction on Windows so they don't need elevation |
| D3 | High (data) | Deleting a project or chapter left its Raster/Pro documents in `inkstrip-pro`. Restoring that project from a backup later failed: *"An existing native draft has the same page ID"* — the user could not restore their own backup | `deleteProject`/`deleteChapter` removed records and blobs from `inkstrip` but never touched `inkstrip-pro` sessions or staged `nativeRestores` | `deleteNativeDrafts()` in `pro/storage.ts`, called after a successful delete (failure never blocks the delete) | Desktop E2E reopens/replaces projects through this path; replace-from-file uses the same cleanup |

## Persistence between Images and Composition & FX

Verified in the real desktop app (E2E A3–A4, B1–B2): a 300 px panel extension and a
bottom fade made in Composition & FX survive switching to the Images workspace and back,
a Save, a full reopen of the `.inkstrip` file in a fresh profile (records and image
bytes identical), and a crash (process tree killed) with an unsaved later edit. No
persistence defect was reproduced in this area.

No other critical editing or data-loss defect was found by the checks above. The
browser suites were not re-run, so their coverage is not claimed here.
