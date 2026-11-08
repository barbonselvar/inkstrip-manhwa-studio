# Desktop architecture

```
inkstrip-manhwa-studio/
├── src/                          shared React app (website + desktop renderer)
│   ├── lib/desktop/
│   │   ├── contract.ts           typed IPC contract shared by main, preload and renderer
│   │   ├── bridge.ts             window.inkstripDesktop access + editor flush registry
│   │   └── project-file.ts       .inkstrip save/open/revert, fingerprints, conflict handling
│   ├── components/desktop/
│   │   ├── desktop-shell.tsx     menu commands, shortcuts, status, autosave, recovery,
│   │   │                         close/update prompts, settings, about, update UI
│   │   └── desktop-library-panel.tsx  Open/Import buttons + recent project files
│   └── desktop.css
├── apps/desktop/                 Electron app (replaces the old Tauri website wrapper)
│   ├── src/main/                 index (lifecycle/window/security), protocol (app://),
│   │                             ipc, project-files (atomic writes), registry (links,
│   │                             recent, recovery), settings, secrets, updater,
│   │                             update-feed, menu, app-paths, logger, file-tokens
│   ├── src/preload/index.ts      sandboxed contextBridge API
│   ├── scripts/                  build-renderer, build-main, assemble-dist, prepare-release
│   ├── resources/                icons, installer.nsh
│   ├── test/                     unit, E2E, performance, loopback update feed
│   ├── electron-builder.yml      NSIS installer + update metadata
│   └── RELEASE_NOTES.md
├── .github/workflows/desktop-ci.yml, desktop-release.yml
└── docs/desktop/
```

The structure follows the existing repository instead of a monorepo rewrite: the web app
stays at the root and is shared as-is.

## Processes

**Main process** (`apps/desktop/src/main/index.ts`)
- Registers `app://` as a standard, secure, fetch-capable scheme before ready; serves
  `build/renderer` from inside `app.asar` with MIME types, `nosniff`, COOP and a CSP;
  falls back to `index.html` for client routes; blocks path traversal.
- One window: `contextIsolation`, `sandbox`, no Node integration, no webview, devtools
  off in production (Settings → Developer tools), navigation and new windows restricted
  to `app://inkstrip` (external https links open in the browser).
- Permission handler allows only clipboard, fullscreen, persistent storage and pointer
  lock. A `webRequest` allow-list cancels any request outside the bundle, Hugging Face,
  the OCR data repo, this repository's releases/API and the OpenAI image-edit endpoint.
- Single instance; a second launch (e.g. double-clicking an `.inkstrip`) forwards the
  file to the running window.
- Close: asks the renderer to flush editors and resolve unsaved work; a 45 s watchdog
  offers "Keep waiting / Close anyway".
- Renderer crash / hang handlers offer reload without discarding the workspace.
- Exports (`<a download>`) go through a native Save dialog and report progress.

**Preload** — exposes `window.inkstripDesktop` (the `DesktopBridge` interface): a fixed
list of `ipcRenderer.invoke` channels and five event subscriptions. No paths, no Node.

**Renderer** — the unchanged studio plus the lazily-loaded desktop shell (mounted only
when the bridge exists, so the website never loads it).

## Data flow for project files

1. All editors keep writing the *workspace* (IndexedDB) exactly as on the website.
2. **Save**: the shell flushes registered editors (Composition controller, Raster
   document, image-editor draft), reads a consistent snapshot (`readProjectData`,
   fingerprint before/after, retried if editing races it), encodes the validated
   container and streams it in 8 MiB chunks over IPC.
3. The main process writes to `.<name>.<random>.saving` beside the target, refuses
   non-project payloads, checks free space first, `fsync`s, re-reads and SHA-256-verifies
   the file, validates the container structure, copies the previous version into
   `backups\<projectId>`, then atomically renames over the original. On any failure the
   original is untouched and the temp file is removed.
4. The project is *linked* to that path with the snapshot's fingerprint, so unsaved
   changes are detected by comparing fingerprints (records + native revisions, no pixel
   reads).

The renderer never sends a path: files are referenced by opaque tokens that the main
process issued for dialog results, the recent list, the command line or its own folders,
and are read through `app://inkstrip/__desktop/file/<token>`.

## Storage locations

| Location | Contents |
|---|---|
| `%APPDATA%\Inkstrip Manhwa Studio\settings` | settings.json, window-state.json, credentials.json (DPAPI-encrypted key) |
| `…\metadata` | project-links.json, recent-projects.json, session.json (clean-exit marker) |
| `…\recovery` | autosave snapshots `<projectId>.inkstrip` + metadata |
| `…\backups\<projectId>` | previous versions kept on each save (default 10) |
| `%LOCALAPPDATA%\Inkstrip Manhwa Studio\Workspace` | Chromium profile: IndexedDB workspace, AI model cache |
| `…\logs`, `…\temp`, `…\models`, `…\crashes` | logs, temp, reserved model folder, local crash dumps (never uploaded) |
| `Documents\Inkstrip` (default) | the user's `.inkstrip` files (any folder can be used) |

Nothing here is inside the installation folder; uninstall leaves all of it.

## Keyboard shortcuts

Ctrl+N new project · Ctrl+O open · Ctrl+S save (after the active editor's own Ctrl+S
flush) · Ctrl+Shift+S save as · Ctrl+, settings · Ctrl+Z / Ctrl+Y handled by each
editor's own history (Edit menu sends the same keys) · Ctrl+Plus / Ctrl+Minus / Ctrl+0
zoom the Raster canvas when it is open, otherwise the interface · F11 full screen ·
existing editor shortcuts (Ctrl+K commands, arrows, tools) are unchanged.
