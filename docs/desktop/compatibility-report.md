# Desktop compatibility report

## Decision: Electron, bundling the existing app

Electron (45.2.3, Chromium 156) was chosen over keeping Tauri/WebView2:

- The studio is a large Chromium-targeted graphics app (OffscreenCanvas, workers,
  WebAssembly SIMD, WebGL, big Blobs in IndexedDB). Shipping a pinned Chromium makes
  rendering, codecs and memory behaviour identical on every PC instead of depending on
  the installed WebView2 version.
- Native project files, atomic saves, recovery, updates and dialogs are straightforward in
  Electron's Node main process, behind a minimal, typed preload bridge.
- Size is explicitly not a priority (installer ≈ 135 MB, installed ≈ 350 MB).

The editor was **not** rebuilt. The same React app is built as a static SPA
(`INKSTRIP_TARGET=desktop`, TanStack Start SPA mode, no Nitro server) and served from the
installed files through a privileged `app://inkstrip` protocol. The website build is
unchanged.

## Compatibility findings

| Item | Result | Action |
|---|---|---|
| TanStack Start SPA mode | Works (prerendered shell + client assets) | `vite.config.ts` desktop target |
| Inline bootstrap scripts vs strict CSP | Blocked at first: the router's dehydrated state contains a literal NUL, which the HTML parser turns into U+FFFD before hashing | Build pins the parsed text's SHA-256 (`build-renderer.mjs`) |
| `new Function` probes in libraries | Refused by CSP (no `unsafe-eval`), libraries fall back | Expected console message, filtered in tests |
| WebAssembly (ONNX, tesseract, codecs) | Works with `wasm-unsafe-eval` | |
| Workers / OffscreenCanvas | Work under `app://` (standard, secure scheme) | |
| IndexedDB / Cache Storage | Work; stored in `%LOCALAPPDATA%\Inkstrip Manhwa Studio\Workspace` | |
| `<a download>` exports | Work; routed to a native Save dialog with progress events | |
| File inputs (image import) | Work (native Open dialog) | |
| Drag-and-drop images | Work (existing chapter handler); `.inkstrip` drops open projects | |
| Cloud AI route `/api/studio/ai-edit` | No server in the desktop app | Served by the main process with the user's own key (off by default) |
| Download App button | Hidden inside the app | `isInsideNativeApp()` detects the bridge |
| Live-site preview bridge, PWA manifest | Inert offline | No change needed |
| Raster studio Ctrl+S / Ctrl+Z / Ctrl+Y | Must keep working | Menu accelerators are display-only; file commands are added by the desktop shell in the bubble phase |

## Feature availability in the desktop app

See [offline-feature-matrix.md](offline-feature-matrix.md). Every website feature works
in the desktop app; the only internet-dependent ones are optional downloads (AI models,
OCR data), optional cloud AI and update checks.

## Platform support

Windows 11 x64 and Windows 10 x64 (Electron 45 supports Windows 10+). Tested on
Windows 11 Pro 26200 only; Windows 10 was **not tested**.

## Existing Tauri shell

`apps/desktop/src-tauri` (a wrapper of the live website) was removed. The previously
installed "Inkstrip" Tauri app is a separate install (`%LOCALAPPDATA%\Inkstrip`, its own
data in `%LOCALAPPDATA%\app.inkstrip.studio`) and is not touched by the new installer.
Projects in it can be moved with its **Backup** button → **Import Website Backup…** in
the new app.
