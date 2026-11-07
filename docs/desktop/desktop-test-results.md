# Desktop test results

## Current independent automated QA

See [qa-continuation-2026-11-07.md](qa-continuation-2026-11-07.md) for exact commits,
run links, installer hashes and full evidence. Local full tests: **1,258/1,258**,
including 43 desktop tests. Windows packaged suites: **13/13 offline, 6/6 feature,
5/5 network, 140/140 window**. Android emulator: **13/13 + 4/4 restart**. Raster and
both R14 jobs pass. Controlled Windows stability: **60 minutes, 1,717 cycles,
zero errors/crashes**. All seven regular workflows also pass on f2a35df.

Owner-PC 1.1.0 installation, fresh backup readability, migration, manual native
Snap/physical display checks, five new installed-window captures and uninstall
validation remain **BLOCKED** by lack of Windows access. Historical tables below
must not be read as completion of those current checks.

## Historical baseline

> **Historical baseline.** See [current 1.1.0 verification](verification-2026-11-07.md)
> for recovered evidence, reruns, new regression tests and explicit blocked checks.

Windows 11 Pro 26200 · i7-12700H · 31.6 GB · RTX 4050 Laptop. 2026-11-07.
**PASS** = executed and passed · **FAIL** · **NOT TESTED** = not executed.

## Automated

| Suite | Result |
|---|---|
| Website: typecheck, lint, `npm test` (1,212 tests), production build, `check:build` | PASS |
| Desktop main-process unit tests (25: atomic save, interrupted save keeps original, non-project payload refused, oversize refused, insufficient disk space refused, backup rotation, 6 corrupted-container cases, temp-file sweep, settings validation/corruption, release selection incl. downgrade/prerelease/draft/Android/incomplete/foreign-link cases, registry) | PASS |
| Desktop typecheck (`tsc -p apps/desktop`) | PASS |
| Website release picker (Windows from `desktop-v*`) | PASS |

## End-to-end, packaged app, network disabled

`node apps/desktop/test/e2e-desktop.mjs --exe "dist/windows/electron-builder/win-unpacked/Inkstrip Manhwa Studio.exe"`
— final build of commit `9437495`. All 13 steps **PASS** (also passed on the unpackaged
build during development).

| Step | Result | Measured |
|---|---|---|
| A1 Offline launch from bundled `app://inkstrip` | PASS | 8.0 s first launch of a freshly built exe (Windows scans new binaries); ~0.5 s on later launches (performance report) |
| A2 New project, 3 images imported | PASS | 0.4 s |
| A3 Composition & FX: 300 px extension + bottom fade saved | PASS | |
| A4 Fade/extension persist Images ⇄ Composition | PASS | |
| A5 Ctrl+S → verified `.inkstrip` (magic, on-disk SHA-256) | PASS | 690 KB in 95 ms |
| A6 Unsaved-change status + `●` title; re-save keeps 1 backup | PASS | |
| A7 Chapter export to disk | PASS | 0.8 s |
| A8 Clean close, no console errors, clean-exit marker | PASS | |
| B1 Open by command line in a brand-new profile: projects, chapters, panels and every image SHA-256 identical | PASS | 5 records, 6 images |
| B2 Reopened composition shows the fade | PASS | |
| B3 Process tree killed with unsaved edit → recovery notice, edit preserved | PASS | |
| B4 Truncated `.inkstrip` rejected, workspace unchanged | PASS | |
| B5 Close with unsaved work → prompt; "Close without saving to file" keeps the edit | PASS | |

## Manual, on this PC (installed application)

| Check | Result | Notes |
|---|---|---|
| Setup launches (unsigned → no UAC, per-user) | PASS | SmartScreen did not interrupt a locally built file; downloaded copies will warn until signed |
| Welcome page with installation information | PASS | |
| Install mode page (Only for me default / all users option) | PASS | All-users mode **NOT TESTED** |
| Install location page, Browse, space required/available | PASS | Default `%LOCALAPPDATA%\Programs\Inkstrip Manhwa Studio`; a custom folder was **NOT TESTED** |
| Shortcuts page with desktop shortcut option | PASS | Unchecking it was **NOT TESTED** |
| Progress, Finish, "Run Inkstrip Manhwa Studio" | PASS | |
| Installed Apps entry (name, version, publisher, uninstaller) | PASS | |
| Start menu + desktop shortcuts | PASS | |
| `.inkstrip` file association registered | PASS | Double-click from Explorer **NOT TESTED** (command-line open is covered by B1) |
| App launches, native menu, File → New Project | PASS | |
| Ctrl+S → native Save dialog → file written, status "Saved" | PASS | |
| Clean close | PASS | |
| Upgrade installation (1.0.0 → 1.0.1 via in-app update) | PASS | See below |
| Silent uninstall | PASS | Program files, Installed Apps entry and both shortcuts removed |
| User data preserved after uninstall | PASS | `%APPDATA%\Inkstrip Manhwa Studio`, workspace in `%LOCALAPPDATA%`, the saved `.inkstrip` file all kept |
| Interactive uninstall wizard | NOT TESTED | Silent mode used |
| Previously installed "Inkstrip" (Tauri) app untouched | PASS | |
| Final build reinstalled and launched | PASS | |

## Update test

Installed 1.0.0 → loopback feed serving a 1.0.1 build of the same code
(`INKSTRIP_UPDATE_TEST_FEED=http://127.0.0.1:8765/`).

| Step | Result |
|---|---|
| Detection on startup | PASS ("Found version 1.0.1") |
| Automatic download, SHA-512 verified | PASS (full download; differential skipped because the test feed had no 1.0.0 blockmap) |
| Card "Inkstrip 1.0.1 is ready to install · Verified" with Later / Install and Restart | PASS |
| Install and Restart → silent NSIS upgrade → relaunch | PASS (≈ 60 s on this PC) |
| About shows 1.0.1; Installed Apps shows 1.0.1 | PASS |
| Project, links, recent list, settings, desktop shortcut preserved | PASS |
| Authenticode publisher verification | NOT TESTED — no signing certificate; the production path stays disabled for unsigned builds by design |
| Real GitHub `desktop-v*` release download | NOT TESTED — nothing was published |
| Interrupted download recovery | NOT TESTED (logic: failure discards the download and keeps the installed version) |
| Offline update check | PASS (offline state handled in E2E launches; app works normally) |

## Failure simulation

| Scenario | Result |
|---|---|
| Application crash / power loss (process tree killed) | PASS (B3) |
| Interrupted save | PASS (unit test: original untouched, temp removed) |
| Insufficient disk space | PASS (unit test with an impossible size; real full disk NOT TESTED) |
| Corrupted / truncated / padded project files | PASS (unit + B4) |
| Missing image resources inside a project | PASS by design: save refuses ("An image in this project is missing; backup not created."), open refuses incomplete containers. Not separately scripted |
| Network failure | PASS (all E2E runs offline) |
| Update failure | NOT TESTED beyond the code path |

## Not tested at all

Windows 10; high-DPI / multi-monitor setups other than this laptop's display; drawing
tablets / pen pressure in the desktop app; the ~60 existing website browser suites
inside Electron; a signed release; the GitHub release workflow itself (it needs the
repository settings and secrets described in update-system.md).
