# Installer configuration

Built with electron-builder 26.18.0 → NSIS 3 assisted installer
(`apps/desktop/electron-builder.yml`, `apps/desktop/resources/installer.nsh`).

```bash
npm ci
npm ci --prefix apps/desktop
npm run desktop:dist        # builds renderer + main + installer, then assembles dist/windows
```

Output:

```
dist/windows/
├── Inkstrip-Manhwa-Studio-Setup.exe      byte-identical copy of the versioned installer
├── release-notes.md
├── checksums.txt                         SHA-256 of every deliverable
└── update/                               what a desktop-v<version> release publishes
    ├── Inkstrip-Manhwa-Studio-Setup-<version>.exe
    ├── Inkstrip-Manhwa-Studio-Setup-<version>.exe.blockmap
    ├── latest.yml                        electron-updater metadata (references the versioned name)
    ├── SHA256SUMS.txt
    └── release-notes.md
```

## Wizard (verified by hand on Windows 11, see desktop-test-results.md)

1. **Welcome** — name, version, what is installed, offline note, and that user data is
   kept outside the install folder.
2. **Installation options** — *Only for me* (default, no administrator rights) or
   *Anyone who uses this computer* (elevates only when chosen).
3. **Install location** — default `%LOCALAPPDATA%\Programs\Inkstrip Manhwa Studio`
   (per-user) / `Program Files` (all users); Browse…; space required/available.
4. **Shortcuts** — Start menu shortcut always; *Create a desktop shortcut* (checked).
5. **Installing** — progress bar.
6. **Finish** — *Run Inkstrip Manhwa Studio*.

Also: Installed Apps entry (name, version, publisher, icon, size, uninstaller),
`.inkstrip` and `.inkstrip-project` file associations, upgrade-in-place (silent for
automatic updates, keeps the user's shortcut choice), `requestedExecutionLevel:
asInvoker`, `deleteAppDataOnUninstall: false`, `warningsAsErrors: true`.

## Self-contained

The installer contains the Electron runtime, the production renderer (all JS/CSS, WASM
runtimes for AI/OCR/codecs, fonts, icons, gallery art) and the main process with
`electron-updater`. It downloads nothing during installation and installs offline.
Optional AI models and OCR data are not bundled (size/licensing); they download on first
use with verification.

## Signing

The current build is **unsigned** (no certificate was available). Windows SmartScreen
will show "Windows protected your PC" → *More info* → *Run anyway*. The release
workflow signs automatically when the `WINDOWS_CERTIFICATE` (base64 `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD` secrets exist; electron-builder then signs the app and
installer (SHA-256, timestamped) and pins the publisher in `app-update.yml`. An OV/EV
certificate or Azure Trusted Signing (cloud HSM) is required for production updates.
Nothing in this repository claims the build is signed.
