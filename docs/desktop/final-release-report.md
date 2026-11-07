# Inkstrip Manhwa Studio for Windows — final release report

| | |
|---|---|
| Application version | **1.0.0** |
| Source | branch `desktop/windows-app`, installer built from commit `9437495` (later commits on the branch change documentation only) |
| Installer | `dist/windows/Inkstrip-Manhwa-Studio-Setup.exe` — 135,433,041 bytes, SHA-256 `e91df7aebe4727a9509f21d0a02b89fead8401d04bcb4aaa7b111ca01da4a624` |
| Update artifacts | `dist/windows/update/` (`latest.yml`, versioned installer, blockmap, SHA256SUMS) |
| Code signature | **Unsigned test build** (no certificate available) |
| Installed on this PC | Yes — `%LOCALAPPDATA%\Programs\Inkstrip Manhwa Studio`, per-user |
| Published anywhere | **No.** Nothing was pushed, released or deployed |

## Technologies

Electron 45.2.3 (Chromium 156, Node 24) · electron-builder 26.18.0 with an NSIS 3 assisted
installer · electron-updater 6.8.11 · the existing React 19 / TanStack Start studio built
as a static SPA · Rolldown for main/preload bundles · Playwright's Electron driver for
end-to-end and performance tests.

## Architecture decisions

1. **Bundle the existing studio, don't rebuild it.** The website's code is shared
   unchanged; a desktop build target emits a static SPA served from `app://inkstrip`.
2. **Workspace + project files.** The proven, transactional IndexedDB workspace stays the
   live working copy; `.inkstrip` files are portable, validated documents using the
   existing project container — which also makes website backups open directly.
3. **Crash-safe saves in the main process**: streamed, free-space checked, fsynced,
   re-read and hashed, structurally validated, previous version backed up, atomic rename.
4. **Nothing is ever discarded silently**: conflicts ask, replacements keep a recovery
   copy, "don't save" keeps the workspace copy.
5. **Locked-down Electron**: sandbox + isolation, token-only file access, validated IPC,
   CSP with hashed bootstrap scripts, navigation/permission/network allow-lists.
6. **Owner-gated updates**: only `desktop-v*` releases published by an approved workflow
   run; only signed builds auto-install; no downgrades.

Details: [desktop-architecture.md](desktop-architecture.md),
[compatibility-report.md](compatibility-report.md), [security.md](security.md).

## Defects

| Discovered | Repaired |
|---|---|
| D1 Windows builds failed (`spawn vite ENOENT`) | Yes |
| D2 `npm test` silently ran 0 script tests on Windows | Yes (204 now run; 2 symlink tests use junctions on Windows) |
| D3 Deleting a project/chapter orphaned its Raster documents, so restoring that project's backup failed | Yes |
| During desktop work: CSP blocked the router bootstrap (NUL → U+FFFD hashing) | Yes |
| Save session rejected first chunks shorter than 16 bytes (found by unit test) | Yes |
| Close prompt missed linked projects whose unsaved changes came from an earlier session (found by E2E) | Yes |

No critical editing or data-loss defect remains open from the checks that were run
([pre-conversion-tests.md](pre-conversion-tests.md)).

## Features

**Preserved:** every website feature — library, chapters, import, ordering, image
editor, Raster/Pro Studio, Text & Bubbles, Composition & FX (fades, extensions,
transitions, SFX), retouch, AI enhance, faces/characters, exports, backups.

**Added for desktop:** `.inkstrip` New/Open/Save/Save As/Export copy/Revert, recent
projects (menu + library), open from command line / file association / drag-and-drop,
unsaved-change tracking (title `●` + status pill), configurable autosave snapshots,
crash notice, close/update protection, rotating backups, website-backup import, native
menus and dialogs, export Save dialogs, Ctrl+N/O/S/Shift+S/,/Plus/Minus/0, F11, Raster
canvas keyboard zoom, window size/position memory with off-screen protection, settings,
About, secure optional cloud AI with an encrypted user key.

## Offline / internet

Everything works offline except optional first-time downloads (AI models, OCR data),
optional cloud AI and update checks — see [offline-feature-matrix.md](offline-feature-matrix.md).

## Verification summary

| Area | Status |
|---|---|
| Website regression (typecheck, lint, 1,212 tests, build, check:build) | PASS |
| Desktop unit tests (25) | PASS |
| Offline E2E on the packaged app (13 steps) | PASS |
| Installer wizard, install, shortcuts, Installed Apps, association | PASS |
| Upgrade via in-app update (1.0.0 → 1.0.1, loopback feed) | PASS |
| Uninstall + user-data preservation | PASS |
| Performance 20 / 50 / 100 / 200 panels | Measured — [performance-report.md](performance-report.md) |
| Signed production update from GitHub | NOT TESTED (no certificate, nothing published) |
| Windows 10, tablets/pen, multi-monitor, high-DPI variety | NOT TESTED |

Full matrix: [desktop-test-results.md](desktop-test-results.md).

## Update system status

Implemented and verified end-to-end with a controlled loopback feed. **Production
automatic updates are blocked pending a code-signing certificate**, by design: unsigned
apps only report that a release exists. To activate: create the `desktop-production`
environment with yourself as required reviewer, add `WINDOWS_CERTIFICATE` /
`WINDOWS_CERTIFICATE_PASSWORD`, then run **Desktop release** — see
[update-system.md](update-system.md). Note that the 1.0.0 build on this PC is unsigned,
so it will not auto-install even signed updates; install the first signed release once
manually.

## Remaining limitations

- Unsigned: SmartScreen warns on downloaded copies.
- Electron fuses are left at defaults (needed by the automated test driver).
- App-level preferences (brush presets, appearance) are not inside project files.
- Website projects must be moved with Backup → Import (no automatic transfer between a
  browser profile and the app).
- Local AI runs single-threaded WebAssembly as on the website (no GPU inference added).
- The website's ~60 browser suites were not executed inside Electron.
- `native-apps.yml` is now Android-only; the website's Download App dialog shows a
  Windows download only after the first stable (signed) `desktop-v*` release.
