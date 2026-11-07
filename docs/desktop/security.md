# Desktop security notes

| Control | Implementation |
|---|---|
| Renderer isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, no `<webview>`, devtools off in production |
| Preload API | Fixed list of `invoke` channels + 5 events (`src/lib/desktop/contract.ts`); errors are re-thrown as plain messages |
| IPC validation | Every handler checks the sender is the main window's `app://inkstrip` frame, validates types/lengths/IDs, and caps chunk size and concurrent saves |
| File access | Renderer never supplies a path: opaque tokens for dialog/recent/CLI/own-folder files, read-only streaming route; writes only to `project`-kind tokens or the app's recovery folder; payload must be an Inkstrip container |
| Imported projects | Container size/structure check in main; schema validation of every record, image decode preflight and dimension cross-checks in the renderer; atomic transactional import; existing work never overwritten without a recovery copy |
| Path traversal | Static server normalizes and requires paths inside the bundle; project IDs are `[A-Za-z0-9_-]{1,100}` before being used in file names; no archive extraction is used |
| Malformed images | Existing bounded decode policy (`image-policy.ts`) applies unchanged |
| CSP | `default-src 'self'`; scripts `'self'` + `wasm-unsafe-eval` + build-time hashes of the two inline bootstrap scripts; no `unsafe-eval`; `connect-src` limited to the bundle, Hugging Face and the OCR data repo; `object-src`/`frame-src` none |
| Navigation | `will-navigate`/`will-redirect` restricted to `app://inkstrip`; new windows denied; https links open in the default browser; `shell:external` limited to github.com, huggingface.co, openai.com |
| Network | Session-level allow-list cancels all other requests; permissions limited to clipboard, fullscreen, persistent storage, pointer lock |
| Secrets | Cloud AI key encrypted with Windows DPAPI (`safeStorage`); never logged or sent to the renderer; no publishing credentials anywhere in app code |
| Artwork privacy | Nothing is uploaded unless the user enables cloud AI, stores their own key, and runs a cloud edit; crash dumps stay local (`uploadToServer: false`) |
| Updates | See update-system.md (signed-only installation, publisher pinning, no downgrade) |

Residual risks (documented, not mitigated further):

- A dropped `.inkstrip` file is resolved from the path the preload obtains through
  `webUtils.getPathForFile`. A fully compromised renderer could name any existing
  `.inkstrip`/`.inkstrip-project` path and, for `.inkstrip`, overwrite it with a valid
  project container (the previous version is kept in backups).
- The current build is unsigned; SmartScreen warns, and automatic updates stay disabled
  until signed releases exist.
- Electron fuses (e.g. disabling `--inspect`/`ELECTRON_RUN_AS_NODE`) are not flipped,
  because the automated E2E/performance suites drive the packaged app through the
  inspector. Enabling them for release builds is a recommended follow-up.
