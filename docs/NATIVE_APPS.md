# Inkstrip native apps: Android APK and Windows EXE

Inkstrip ships as two installable apps that wrap the existing production studio
(`https://inkstrip-manhwa-studio.vercel.app`). Raster Studio, the Chapter
workspace, AI tools and the rest of the editor are **not reimplemented**. Each
app opens the same web build in its own window, and a thin native layer handles
what a bare WebView can't: downloads, back navigation, offline state, external
links, the app icon and the installer.

| | Android | Windows |
|---|---|---|
| Location | `apps/android` | `apps/desktop` |
| Technology | Capacitor 8 (Android System WebView) | Tauri 2 (Microsoft Edge WebView2) |
| Output | `Inkstrip-<v>-android[-test].apk` | `Inkstrip-<v>-windows-x64-setup[-unsigned].exe` (NSIS) |
| Supported OS | Android 7.0+ (minSdk 24, targetSdk 36) | Windows 10 and 11, x64 |
| App id | `app.inkstrip.studio` | `app.inkstrip.studio` |

## Why these technologies

**Windows: Tauri over Electron.** Electron bundles its own Chromium and Node.js
(about 80–100 MB installed, with a full browser process tree per app). Tauri
uses the WebView2 runtime that Windows 10/11 already include, so the installer
is a few MB and memory use stays close to an Edge tab. WebView2 is
Chromium, so the editor's WebAssembly/SIMD, WebGL2, Workers, OffscreenCanvas,
IndexedDB and WebGPU paths behave the way they do in Edge or Chrome. The NSIS
installer runs per user (no administrator prompt). On the rare Windows 10
machine without WebView2 it installs the runtime silently through Microsoft's
bootstrapper.

**Android: Capacitor.** Capacitor generates a standard Gradle project, supports
a remote `server.url`, and already handles `<input type="file">` (photo picker
or documents, camera capture when a page asks for it). That leaves one gap,
downloads, which `InkstripNativePlugin` fills.

**Loading production instead of bundling the site.** The studio is a TanStack
Start app with server routes and AI endpoints, so it cannot run from static
files. Loading production also means the apps receive every web release without
an app update. The trade-off is that the apps need a network connection to
start.

## What each layer does

### Android (`apps/android`)

- `capacitor.config.json`: loads production and serves `www/offline.html` when
  the main page fails. It also appends `InkstripApp/1.0 (Android)` to the user
  agent.
- `InkstripNativePlugin.java` + `www/inkstrip-native.js`: Android WebView
  ignores `<a download>` on `blob:`/`data:` URLs, and every Inkstrip export uses
  that pattern (images, chapter ZIPs, backups, native files). The shim is
  injected into the page before its own scripts run. It intercepts those clicks
  and streams the bytes to the plugin in 512 KB chunks, and the plugin writes
  them to **Downloads/Inkstrip** and shows a toast.
  - Android 10+: MediaStore, no permission needed.
  - Android 7–9: legacy storage, using `WRITE_EXTERNAL_STORAGE` declared with
    `maxSdkVersion="28"`. Android asks for it once, on the first download.
- `MainActivity.java`: the hardware/gesture **back** button first closes an
  open dialog or menu (Escape to Radix), then goes back in web history, and
  leaves the app only from the first screen.
- Permissions: `INTERNET`, plus the legacy storage permission on Android ≤ 9
  only. Backups are disabled (`allowBackup=false`) and cleartext traffic is off.
  Links to other sites open in the system browser.
- Icon, adaptive icon and splash come from the existing favicon mark
  (`apps/brand`).

### Windows (`apps/desktop`)

- `src-tauri/src/lib.rs`: opens a single window (maximized, 800×560 minimum)
  on the bundled `launcher/index.html`. The launcher checks connectivity,
  shows an offline/retry screen if needed, then goes to production.
  - **Only the production origin** (plus the launcher and `blob:`/`data:`) can
    load in the window. Anything else opens in the default browser
    (`on_navigation`/`on_new_window`). There is a unit test for this
    allow-list.
  - No Tauri IPC capabilities are granted, so the remote page has the same
    powers as in Edge, no more.
  - Single instance: launching again focuses the open window.
  - Tauri's drag-drop handler is off, so images dropped on the window reach the
    studio's own import.
  - `window.__INKSTRIP_DESKTOP__` lets the site detect the app.
- File pickers, `<a download>` exports (saved to the user's Downloads folder
  with the WebView2 download flyout) and IndexedDB/localStorage are native
  WebView2 behavior. Data lives in `%LOCALAPPDATA%\app.inkstrip.studio`.
- Release profile: LTO, size-optimized, stripped.

### Website (`src/components/studio/download-app.tsx`)

The homepage hero has a **Download App** button. The dialog asks the GitHub
API (`src/lib/native-apps/releases.ts`) for the newest **published,
non-prerelease** release tagged `app-v*`, and offers **only installer assets
that actually exist** there:

- Android: Download APK
- Windows: Download EXE installer

Each entry shows the file name, size and SHA-256 (from GitHub's asset digest),
and a "Test build · unsigned" badge with install notes when applicable. The
platform matching the visitor's device is marked "This device". If nothing has
been released yet, the dialog says so and links to the Releases page; it never
shows a placeholder link. The button is hidden inside the apps themselves.

## Build pipeline (`.github/workflows/native-apps.yml`)

| Trigger | What happens |
|---|---|
| Pull request / push to `main` touching `apps/**` | Build both apps, verify, install and smoke-test them, and upload them as **workflow artifacts** (downloadable from the run page). |
| Push of tag `app-vX.Y.Z` | All of the above, then **publish a GitHub Release** with the APK, EXE and `SHA256SUMS.txt`. A tag with a suffix (`app-v1.1.0-beta.1`) becomes a prerelease, which the website ignores. |

Jobs:

1. **android-build** (Ubuntu): `cap sync` and Gradle, release-signed when the
   keystore secrets exist, otherwise debug-signed. It then verifies the APK:
   `apksigner verify`, package id, label, min/target SDK, and the permission
   allow-list.
2. **android-device-test**: installs the APK on an **Android 14 emulator**
   (Pixel 6 profile) and runs `apps/scripts/native-smoke.mjs` against the
   app's own WebView over DevTools.
3. **windows-build** (Windows): `cargo test`, then `tauri build` to the NSIS
   installer, Authenticode-signed when certificate secrets exist. It checks
   the PE header and signature status.
4. **windows-device-test** (Windows): installs the EXE silently, checks the
   install directory, Apps & features entry and Start menu shortcut, launches
   the app with WebView2 remote debugging, runs the same smoke test, restarts
   the app, then uninstalls silently.
5. **release**: runs only for `app-v*` tags and only after all four jobs pass.

The smoke test checks that:
- the production page renders in the app window,
- the native bridge is present,
- WebAssembly SIMD, WebGL2, Workers, OffscreenCanvas and IndexedDB are
  available (WebGPU is reported),
- creating a project opens the Chapter workspace,
- importing two images renders the panels,
- Raster Studio opens on an imported panel,
- an `<a download>` blob export lands in Downloads with byte-identical
  SHA-256,
- localStorage, IndexedDB and the project survive an app restart,
- on Android, back closes an open dialog and navigates back.

Screenshots, logcat, memory figures and JSON results are uploaded as artifacts.

These are **emulator / CI-runner** results, not tests on physical phones or
consumer PCs.

### Publishing a release

After this branch is merged and approved:

```bash
git tag app-v1.0.0 <merged-commit-sha>
git push origin app-v1.0.0
```

The workflow publishes `Inkstrip apps 1.0.0`, and the website's Download App
dialog picks it up straight away (no web redeploy needed). Bump the tag for
each app release. The Android `versionCode` comes from the workflow run number,
so it always increases.

## Signing

Without secrets, the workflow still produces installable builds, named and
badged as **test builds**:

| | Test build (no secrets) | Public release |
|---|---|---|
| Android | Signed with the CI runner's throwaway **debug key**. It is debuggable, cannot go on Google Play, and a later build signed with a different key can't install over it (uninstall first). | Signed with your **upload/release keystore** |
| Windows | **No Authenticode signature.** SmartScreen shows "Windows protected your PC" (More info → Run anyway). | Signed with an **OV/EV code-signing certificate** and timestamped |

### Android signing

1. Create the key once and keep it safe. Losing it means you can't update the
   app.
   ```bash
   keytool -genkeypair -v -keystore inkstrip-release.jks -alias inkstrip \
     -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Add these repository secrets (Settings → Secrets and variables → Actions):
   - `ANDROID_KEYSTORE_BASE64`: output of `base64 -w0 inkstrip-release.jks`
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
3. The next build produces `Inkstrip-<v>-android.apk`, signed with that key
   (APK signature scheme v2/v3). The keystore is decoded to the runner's temp
   directory and deleted after Gradle runs. `build.gradle` only reads it from
   environment variables.
4. For Google Play, use Play App Signing and upload an AAB
   (`./gradlew bundleRelease`). The keystore above then becomes your upload key.

### Windows code signing

1. Buy an OV or EV code-signing certificate from a CA (DigiCert, Sectigo, SSL.com,
   …). Alternatively, use Azure Trusted Signing through Tauri's `signCommand`.
   An EV certificate, or an OV certificate with enough download reputation,
   removes the SmartScreen warning.
2. Add the repository secrets `WINDOWS_CERTIFICATE` (base64 of the `.pfx`) and
   `WINDOWS_CERTIFICATE_PASSWORD`.
3. The workflow imports the certificate into the runner's user store, and
   Tauri signs `Inkstrip.exe` and the installer with SHA-256 and a DigiCert
   timestamp. The job fails if `Get-AuthenticodeSignature` isn't `Valid`. The
   output is then named `Inkstrip-<v>-windows-x64-setup.exe`.
   Hardware-token EV certificates can't be exported to a `.pfx`; use a cloud
   HSM or Azure Trusted Signing with `bundle.windows.signCommand` instead.

Never commit keystores, `.pfx` files or passwords. `.gitignore` already
excludes build output.

## Local development

```bash
# Android (needs Android SDK 36 + JDK 21)
cd apps/android && npm ci && npx cap sync android
cd android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk

# Windows (on Windows, Rust stable + Node 22+)
cd apps/desktop && npm ci && npx tauri build   # src-tauri/target/release/bundle/nsis/
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Regenerate icons from `apps/brand/inkstrip-icon-1024.png` with
`npm run icons --prefix apps/desktop` (Android mipmaps come from the same
command plus the adaptive foreground in `apps/brand`).

## Known limitations

- The apps need an internet connection to start. Projects already saved in the
  app stay on the device, but the studio itself is loaded from production.
- Each app has its **own storage**, separate from the browser's. Projects made
  in Chrome/Edge don't appear in the app automatically; use **Restore backup**
  with a backup file to move them.
- Android exports go to `Downloads/Inkstrip`. A multi-file export saves each
  file and shows a toast for each.
- On-device AI uses WebGPU when the WebView provides it, otherwise
  WebAssembly. That is slower on low-end phones.
- iOS and macOS builds are not included. Tauri could produce a macOS build
  with a signing identity.
