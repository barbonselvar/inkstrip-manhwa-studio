# Continuation audit (start of the window-design phase)

Audited 2026-11-07 on branch `desktop/windows-app` at `3ec955b` (PR #41).

## State found

| Area | Status |
|---|---|
| Git | Clean working tree, branch pushed, PR #41 open, `mergeable_state: clean` |
| PR #41 checks | 14/14 green: website build/validate/continuity/live checks, Android build + device test, **desktop `windows` job (Windows build + offline E2E on GitHub's runner)**, Vercel preview; `release` skipped (correct, no tag) |
| PR title | Garbled (`Desktop/wifeat(desktop): … ndows app`) — fixed in this phase |
| `desktop-production` environment | **Does not exist** (public API: 0 environments) |
| Signing secrets | Not verifiable without repository admin access; no signed build exists |
| Desktop releases | None (`app-v1.0.1` Android release only) |
| Installed app on this PC | `Inkstrip Manhwa Studio` 1.0.0 per-user in `%LOCALAPPDATA%\Programs\Inkstrip Manhwa Studio`; it was running (started by the user) and was not touched |
| User data | `%APPDATA%\Inkstrip Manhwa Studio` and `%LOCALAPPDATA%\Inkstrip Manhwa Studio\Workspace` present; never modified by tests (all automated runs use throw-away `INKSTRIP_PROFILE_DIR` profiles) |
| `gh` CLI | Not installed → installed (`winget`, 2.103.3); **not signed in** — signing in needs the owner |

## Completed before this phase

Offline Electron app, `.inkstrip` files with verified atomic saves/backups/recovery,
secure IPC, NSIS installer, owner-gated updater, CI + release workflows, 13-step offline
E2E, performance report. See [final-release-report.md](final-release-report.md).

## Outstanding work identified (and what this phase did)

| Item | Outcome |
|---|---|
| Plain native title bar and menu bar | Five live-switchable window designs on one native shell ([window-designs.md](window-designs.md)) |
| Feature coverage inside the app limited to Composition/fades | New feature E2E: images reorder/undo, Raster brush/eraser/undo/redo, Text & Bubbles, chapters, rename, Backup→Delete→Restore |
| Offline only tested from start; no connection-loss transitions | New network E2E (loss during editing, export, update check; reconnection) |
| No sustained stability run | 60-minute stability test added and run ([performance-report.md](performance-report.md)) |
| Third-party actions referenced by tag | Pinned to commit SHAs in the desktop workflows |
| No rollback procedure | `desktop-release-withdraw.yml` (owner-approved) |
| Electron fuses at defaults | Flipped in packaged builds (inspector fuse kept for automated tests, documented) |
| `desktop-production` environment / signing | Blocked on owner sign-in to `gh` and on a code-signing certificate (see [update-system.md](update-system.md)) |

## Risks at the start

1. A custom title bar can break native window behaviour (Snap, resize, DPI) or overlap
   editors → addressed by keeping the native frame + Window Controls Overlay and placing the
   studio in its own view (tested at 100–200 % scaling).
2. Production updates cannot be activated without signing → still blocked by design.
3. Tests must never touch the user's real projects → all suites use isolated profiles; the
   user's running app was left alone.
