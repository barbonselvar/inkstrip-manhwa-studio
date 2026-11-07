# Desktop 1.1.0 independent QA continuation

PR: https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/41  
Branch: `desktop/windows-app`  
Verified starting commit: `c10afca22011f7d3b2c0ecd755c38a225f20df66`  
QA implementation commit: `7ec94e05122ddea2d667f3486cfa87bf0ba4672b`

**Automated QA passed:** 1,258 local tests, all seven regular workflows on
documentation/build head `f2a35df387ee5ccff1912f42e8ba02c0564116c3`, and a controlled
60-minute Windows run with 1,717 cycles and zero errors/crashes on implementation
7ec94e0. Final evidence updates change documentation/data only.

**Installation is not verified:** this session cannot reach the owner's Windows
installation or backup. No replacement was attempted. Fresh backup verification,
permission to replace 1.0.0, migration and installed-window screenshots remain open.

Latest independently downloaded and hashed installer in this report:
[unsigned 1.1.0 test artifact, f2a35df](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417153007/artifacts/13591782546).
It is not a production release. Exact checksum and all run links appear below.

## Scope and environment

Continued the existing implementation. No application features, signing checks,
signature verification, authorization rules or update integrity protections were
removed or weakened. No production release, merge or owner-machine installation
was performed. No paid AI endpoint was called by this session.

This continuation runs in Linux with Node 24.22.1. There is no connected Windows
desktop, Windows filesystem, Android device, Android SDK or emulator here.
Authenticated GitHub connector reads and writes work. A normal CLI push failed
because no CLI credential was available; the tested files were committed through
the connector with a non-forced, expected-head-guarded branch update. Authentication
repair was not attempted. The local checkout was synchronized to the resulting commit.

## Exact baseline Actions evidence

All of these runs completed successfully on **c10afca**, before this session's fixes:

| Workflow | Run | Result |
|---|---|---|
| Desktop app (Windows) checks | [42413573885](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573885) | SUCCESS |
| Native apps (Android APK) | [42413573872](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573872) | SUCCESS; release job intentionally skipped |
| Raster continuity browser checks | [42413573835](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573835) | SUCCESS |
| R14 real AI editing checks | [42413573887](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573887) | SUCCESS, both jobs |
| Configuration checks | [42413573860](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573860) | SUCCESS |
| Node.js application build | [42413573866](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573866) | SUCCESS |
| External release verification | [42413573873](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573873) | SUCCESS; live-site job verifies main, not the desktop PR's renderer |

Job steps/logs were inspected for all four requested workflows. Their artifacts
were downloaded and JSON results inspected, rather than trusting workflow names
or top-level green status alone.

### Windows packaged evidence

- Desktop main/service/outcome tests: **43 passed**.
- Offline packaged E2E: **13/13**, `failure: null`.
- Editing, chapters, native draft and backup/restore: **6/6**, `failure: null`.
- Network transitions: **5/5**, `failure: null`.
- Five window designs at forced 100/125/150/200% scales: **140/140**, `failure: null`.
- Renderer/main compilation, Windows NSIS build and artifact assembly succeeded.
- The damaged-project IPC error in the log is the intentional corrupted-container
  rejection exercised by E2E; it is not an unexplained successful-path failure.
- Window automation covers geometry, maximize/minimize/restore/fullscreen,
  design switching, command palette and persisted design/accent. Its PNGs are
  **shell-page captures**, not whole native installed windows or physical DPI/Snap proof.

Fresh **unsigned development installer**, built from c10afca (not the old local build):

- [Windows artifact](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42413573885/artifacts/13591170125).
- `Inkstrip-Manhwa-Studio-Setup.exe`, version 1.1.0, **135,443,148 bytes**.
- SHA-256: `31287ddbe46a66cf2d6b8e0a262b47951ab7564f0f28fff46e37296a292c1d9b`.
- The downloaded EXE was hashed locally and matched the build log/checksums.
- This artifact was not copied to `C:\Users\ASUS\Desktop\inkstrip\dist\windows`
  because this session cannot access that computer. The historical file there
  must not be confused with this new artifact.

### Android evidence and the reproduced test defect

The APK compiled and passed package/SDK/permission/signature validation. Android
14 emulator attempt 1 succeeded; no infrastructure retry was needed. Test evidence
covers WebView runtime capabilities, bridge injection, writable IndexedDB/storage,
project creation/import, local Fast Anime inference/apply/original recovery,
Raster entry, identical-byte native download, and restart persistence (4/4).

The original main JSON contains **12 passes and 1 optional warning**, not 13
successful checks. The old summary counted optional failures as passes. Its warning
also falsely reported that Back failed to leave Raster: the detector looked for
`Raster Studio` anywhere in the page, which matches the chapter's `Open in Raster
Studio` button. The retained `android-main-05-final.png` visibly shows Chapter after
Back. This is evidence of a test defect, not a reproduced application navigation bug.

The correction checks the actual `[role="dialog"].pro-studio`, requires the same
chapter path after closing, and does not turn a failed CDP read/page reload into
success. Pass/failure/warning totals are now separate; two regression tests cover
the misleading-count defect. The navigation check remains optional as before;
no coverage was removed or required gate weakened.

Android loads the live production website. These smoke results do **not** establish
that this APK bundles the PR renderer or offers a fully offline cold start, nor
physical-device/touch/file-provider compatibility beyond the exercised flows.
The release-signing and publication steps were intentionally not requested.

### Raster and R14 evidence

Raster CI passed mask, pattern, inspector, mobile, R11 native/browser compatibility,
image picker and editor lifecycle suites. Saved R10 JSON covers five viewport widths
per suite with empty error arrays; picker reports 14 checks. This is Chromium
coverage, not proof of Firefox/Safari or every possible editor feature combination.

Both R14 jobs passed. Saved inference JSON verifies Swin2SR and Fast Anime at
1x/2x/4x, exact source/alpha preservation, baseline pixel parity at 1x/2x,
corrupt-cache recovery, cancellation and oversized-output refusal. Other artifacts
cover five-width preview/apply/original recovery, references/characters, retouch
ownership and tile parity. These models perform actual local inference after
download; this does not mean optional cloud AI works offline. Cloud-provider
timeout/error/cancellation behavior also has stubbed service/unit coverage, not
approval to spend money on a real provider.

## Local validation of the continuation

| Command/check | Result |
|---|---|
| `npm ci --no-audit --no-fund` (root and desktop) | PASS |
| `npm test` | **1,258 PASS**, zero failures/skips: scripts 206, library/auth/release 65, desktop 43, studio 151, Pro 707, composition 86; security probes also pass |
| Previously blocked directory-link tests | Both PASS in this Linux environment |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` and `npm run check:build` | PASS; no configured database URL, migration skipped by existing behavior |
| `npm run typecheck --prefix apps/desktop` | PASS |
| `npm run build --prefix apps/desktop` | PASS: static renderer, main and both preloads |
| `npm audit --omit=dev --audit-level=high --prefix apps/desktop` | PASS: zero vulnerabilities |
| `npm audit --audit-level=high` | Exit 0; seven **moderate** development-tool findings (minimatch/TypeScript ESLint chain), no high/critical findings |
| Invalid-executable stability probe | Expected nonzero exit; retained JSON says `completed: false`, `passed: false`, with launch error |
| Local browser tests | BLOCKED: Playwright Chromium 1248 download returns an invalid/truncated ZIP; actual browser smoke launch fails for missing executable |
| Browser dependency fallback | BLOCKED: package-manager privilege/setgroups failure; no sandbox/security configuration changed |
| Local NSIS, native Windows GUI and installed-app tests | BLOCKED: Linux executor, no connected Windows machine |
| Local Android build/emulator | BLOCKED: SDK/emulator unavailable; independent CI evidence above |

Detailed local logs are retained in ignored
`dist/codex-work/continuation-2026-11-07/`. No user project data or private signing
material is included in commits.

## Controlled stability validation

The original Windows temp profile/progress/error is inaccessible from this session.
Its original error has **not** been diagnosed, and the old run is not called passed.
Do not stop or duplicate it on the owner's PC if still active.

New isolated Windows run: [42416585169](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416585169),
source **7ec94e0**. Final status: **SUCCESS**. The final JSON and application log were downloaded and inspected.

The corrected harness starts its sustained clock after project creation/import/save,
so setup cannot consume part of the requested hour. It waits for asynchronous brush
commit before Undo, rejects an invisible artboard, saves launch/setup exceptions as
failed JSON, and closes its isolated app in `finally`. It samples Electron process
working set, aggregate CPU, process count and JS heap while repeatedly editing,
switching workspaces and saving offline. Its outcome still fails on any caught
workflow/console error, crash or incomplete measured interval.

Final measured result: **60 minutes + 1.319 seconds**, **1,717 cycles**, **116 resource
samples**, `completed: true`, `passed: true`, no crash, zero errors and an empty error
array. The retained application log has no warning/error/exception/crash entries.

| Measurement | Result |
|---|---|
| Working set start / warm-up (5.3 min) / end | 608 / 749 / 644 MB |
| Peak working set | 963 MB |
| Working-set change after warm-up | -105 MB |
| JS heap start / warm-up / end | 14 / 27 / 21 MB |
| JS heap change after warm-up | -6 MB |
| Post-warm-up aggregate Electron CPU mean / median | 15.44% / 15.42% |
| Post-warm-up aggregate Electron CPU p95 / max | 16.05% / 16.49% |
| App process count | 5 throughout sampling |
| Working-set range in final ten minutes | 540–644 MB |
| Logged successful project writes | 344; 17–115 ms, median 25 ms |

CPU values are the sum of Electron's per-process `percentCPUUsage` samples, not a
measurement of total host CPU load. Memory fluctuates and ends below warm-up in
this workload; this is encouraging sustained-run evidence, not a general proof
that no possible editing session can leak memory. The saved project container was
also revalidated after downloading it: one chapter, 20 panels, 41 assets; it remained
structurally readable. Its SHA-256 is
`a26e500afdb9dc2764e925bf9326bdedcfe1384ba81f2956fae611f23807ec78`.

Retained evidence: [raw JSON](evidence/stability-7ec94e0.json),
[sample CSV](evidence/stability-7ec94e0-samples.csv),
[application log](evidence/stability-7ec94e0-app.log), and
[complete workflow artifact](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416585169/artifacts/13594210443).
The original owner's earlier error is still inaccessible and remains undiagnosed;
this successful controlled run does not retroactively mark that old run passed.

## QA implementation Actions (7ec94e0)

| Workflow | Run | Checkpoint status |
|---|---|---|
| Desktop | [42416589382](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589382) | SUCCESS |
| Android | [42416589378](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589378) | SUCCESS |
| Raster | [42416589337](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589337) | SUCCESS |
| R14 | [42416589354](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589354) | SUCCESS |
| Configuration | [42416589365](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589365) | SUCCESS |
| Website build | [42416589388](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589388) | SUCCESS |
| External verification | [42416589447](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589447) | SUCCESS |

Implementation-head artifacts were downloaded and inspected again. Windows retains
13/13 offline, 6/6 features, 5/5 network and 140/140 window checks with null
failures. Android now records **13/13 main + 4/4 restart**, no optional warnings;
its actual dialog changes from open to closed while the chapter path stays the same.

The newer 7ec94e0 unsigned 1.1.0 installer is **135,443,797 bytes**, SHA-256
`6c9723df5d290e1f48a8964d79165075b12be3e81c0ed9907052ace700f72605`,
verified by hashing the downloaded EXE and comparing to `checksums.txt`.
Use [artifact 13591337495](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42416589382/artifacts/13591337495)
for implementation 7ec94e0 instead of the baseline installer above. A newer f2a35df
documentation-head build is linked at the top and at the end. It is an isolated
**unsigned test build**, not a published trusted production release.

## Installation, backup and screenshot status

No owner's Windows application was opened, closed, replaced or uninstalled here.
Last directly observed installation in the previous report was **1.0.0**; its current
version/process state cannot be independently confirmed from Linux.

Historical backup: `dist/codex-work/pre-upgrade-backup`, 126 files / 11,236,387
bytes according to the previous verification. Readability and completeness cannot
be reverified here. Before a real upgrade, preserve the 1.0.0 installation and
make/hash-verify a fresh backup of both roaming and local Inkstrip data, Workspace,
preferences, metadata/linked project locations and all externally saved project
files. Confirm the app is closed first. Obtain explicit permission **after** that
concrete backup and installer verification, **before** replacement.

Five historical whole-window JPEGs exist under `docs/desktop/screenshots/` and
show native controls plus the editor. They are archival evidence; the exact binary
and installed-version provenance is not independently established. They are **not**
new screenshots of installed 1.1.0. Fresh installed-window screenshots, native
dragging/resizing/Snap, physical DPI/display checks, upgrade/migration, recovery and
uninstall with data preservation remain **BLOCKED**, not passed.

## Continuation commands and readiness

First inspect Windows `git status --short --branch` and `git rev-parse HEAD`; never
overwrite uncommitted work. Verify that the checkout contains the tested PR head.
Required build/check commands at the repository root:

```powershell
npm ci --no-audit --no-fund
npm ci --no-audit --no-fund --prefix apps/desktop
npm run typecheck
npm run lint
npm test
npm run build
npm run check:build
npm run typecheck --prefix apps/desktop
npm run desktop:dist
Get-FileHash dist/windows/Inkstrip-Manhwa-Studio-Setup.exe -Algorithm SHA256
```

Use fail-fast native command handling in PowerShell 7:
`$PSNativeCommandUseErrorActionPreference = $true`. The CI artifact may be used
instead of a local rebuild only after checking its exact source SHA and checksum.
The expected local output remains `C:\Users\ASUS\Desktop\inkstrip\dist\windows`.

After installation permission and a verified backup, test **the installed EXE**:

```powershell
$exe = "$env:LOCALAPPDATA/Programs/Inkstrip Manhwa Studio/Inkstrip Manhwa Studio.exe"
node apps/desktop/test/e2e-desktop.mjs --exe "$exe" --out dist/codex-work/installed-e2e
node apps/desktop/test/features-e2e.mjs --exe "$exe" --out dist/codex-work/installed-features
node apps/desktop/test/network-e2e.mjs --exe "$exe" --out dist/codex-work/installed-network
node apps/desktop/test/window-designs-e2e.mjs --exe "$exe" --out dist/codex-work/installed-windows
```

These scripts use disposable profiles; **also** verify actual backed-up user projects,
preferences and migrations on the owner's installed application, retaining original
copies. Capture five whole native windows with Computer Use, not page screenshots.
Do not uninstall the owner's working installation merely to automate a destructive
check: use an isolated Windows test installation for uninstall/data-retention tests.

| Milestone | Assessment at checkpoint |
|---|---|
| Existing development | Preserved; no new application-code defect reproduced |
| Continuation local checks | PASS for executable checks above; GUI/platform checks blocked |
| Baseline CI | VERIFIED on c10afca |
| QA implementation CI | All seven regular workflows VERIFIED on 7ec94e0 |
| 60-minute stability | VERIFIED PASS on isolated Windows runner, source 7ec94e0 |
| Owner-PC 1.1.0 installation | NOT VERIFIED |
| Production release ready | NO; explicitly out of this session's scope |

Signing certificates, Ed25519 secret setup, SignPath, production authorization,
GitHub CLI authentication repair and production publication remain deferred.
Do not merge PR #41 or publish an unsigned installer as a trusted release.


## Archival window images (not current installation verification)

| Design | Historical image |
|---|---|
| Modern Windows 11 | [design-1-modern-windows-11.jpg](screenshots/design-1-modern-windows-11.jpg) |
| Neon Gaming | [design-2-neon-gaming.jpg](screenshots/design-2-neon-gaming.jpg) |
| Developer Compact | [design-3-developer-compact.jpg](screenshots/design-3-developer-compact.jpg) |
| Creative Studio Pro | [design-4-creative-studio-pro.jpg](screenshots/design-4-creative-studio-pro.jpg) |
| Minimal Borderless | [design-5-minimal-borderless.jpg](screenshots/design-5-minimal-borderless.jpg) |

All five were visually inspected in this continuation. None is relabelled as a new
capture of the owner's installed 1.1.0 application.


## Final documentation-head verification

Documentation head `f2a35df387ee5ccff1912f42e8ba02c0564116c3` changes reports only;
its application and QA implementation match 7ec94e0. All seven regular workflows
also passed on that exact head:

| Workflow | Successful run |
|---|---|
| Desktop Windows | [42417153007](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417153007) |
| Android APK/emulator | [42417152985](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417152985) |
| Raster continuity | [42417153046](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417153046) |
| R14 real AI | [42417153018](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417153018) |
| Configuration/full tests | [42417152999](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417152999) |
| Website build | [42417153021](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417153021) |
| External verification | [42417153022](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417153022) |

Artifacts were inspected again: Windows 13/13 + 6/6 + 5/5 + 140/140, all null
failures; Android 13/13 + 4/4. A fresh unsigned 1.1.0 NSIS installer from f2a35df
was downloaded and verified: **135,443,141 bytes**, SHA-256
`654ddb9320c96fd6d6a92133478d24e8e0ced77207c0e1c8c0a88c59838b778b`.
[Download that development artifact](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/42417153007/artifacts/13591782546).
It has not been copied to or installed on the owner's PC.

**Final readiness:** QA fixes and automated local/CI validation are complete for the
executed scope, including the controlled hour. Owner-PC installation, fresh backup
verification, migration, native manual controls/Snap/physical displays, fresh five
installed-window captures and installed-version uninstall/recovery remain blocked
by lack of Windows access. Signing/publication are deferred. PR #41 is not merged;
no production release is ready or claimed.
