# Update system and owner-approved releases

## Signing strategy (free — nothing purchased)

| Purpose | Mechanism | Cost | Status |
|---|---|---|---|
| **Update authenticity** (installed apps only install genuine Inkstrip releases) | Ed25519 *update-signing key*. The release workflow signs every installer with the private key, which exists only as the `DESKTOP_UPDATE_SIGNING_KEY` secret of the protected `desktop-production` environment. The app has the public key built in (`apps/desktop/src/main/update-signature.ts`) and refuses any download whose signature, version, file name or SHA-512 do not verify. | Free | Implemented and tested; **the secret must be added by the owner (one command, below)** |
| **Integrity** | electron-updater checks the SHA-512 in `latest.yml`; the signature additionally binds that hash | Free | Implemented |
| **First-install trust** (removes the SmartScreen "Windows protected your PC" warning) | Windows Authenticode certificate. Free route: **SignPath Foundation** (free code signing for qualifying open-source projects: OSI-approved license, public repository, application and review). Paid routes (OV/EV certificate, Azure Trusted Signing) are *not* used. | Free if accepted by SignPath | Not configured. The repository currently has no OSI license (`apps/desktop/package.json`: `UNLICENSED`), which SignPath requires — owner decision. The workflow already signs automatically if `WINDOWS_CERTIFICATE`/`WINDOWS_CERTIFICATE_PASSWORD` (or a SignPath step) is added. |

A self-signed certificate is deliberately **not** used: Windows would not trust it, so it
would add nothing for users and could be mistaken for real trust.

The signed message is
`inkstrip-manhwa-studio-desktop \n <version> \n <installer file name> \n <sha512>`, so an older
signed installer cannot be replayed as a newer version and a modified file cannot pass.
Verification runs twice: right after the download, and again immediately before the
installer is started.

### One step for the owner: add the signing key secret

The key pair was generated on this PC. The private key is at
`%USERPROFILE%\.inkstrip-release\desktop-update-signing-key.pem` (readable only by your
account; back it up offline — losing it means future updates must be re-keyed with a new
app version). Add it to the protected environment (Claude Code was not permitted to write
secret stores):

```powershell
Get-Content "$env:USERPROFILE\.inkstrip-release\desktop-update-signing-key.pem" -Raw | & "C:\Program Files\GitHub CLI\gh.exe" secret set DESKTOP_UPDATE_SIGNING_KEY --env desktop-production --repo barbonselvar/inkstrip-manhwa-studio
```

Never paste the key into chat, issues, commits or logs. To rotate it, generate a new pair,
put the new public key in `update-signature.ts`, ship that version signed with the *old*
key, then switch the secret.

## Repository configuration (done with the owner's `gh` login)

| Item | State |
|---|---|
| Environment `desktop-production` | Created. Required reviewer: **barbonselvar** (self-review allowed — sole maintainer). Deployment branches: **`main` only**. |
| Environment secret `DESKTOP_UPDATE_SIGNING_KEY` | **Pending — owner command above** |
| Ruleset "Protect desktop release tags" | Active on `refs/tags/desktop-v*`: no update, no deletion, no force-move; bypass: repository admins. Tag *creation* stays open because GitHub does not allow GitHub Actions as a ruleset bypass actor on personal repositories; a bare tag publishes nothing (apps need a signed release). |
| Actions in desktop workflows | Pinned to commit SHAs; least-privilege `contents: read` except the approved publish/withdraw jobs (`contents: write`). |

## Owner workflow

1. **Implement & test** — PRs run `desktop-ci.yml` on Windows: unit tests, shipped-dependency
   audit, packaged build, offline E2E, window-design suite; an *unsigned test installer*
   artifact is uploaded. Nothing is published; merging never releases.
2. **Prepare** — `npm run release:prepare --prefix apps/desktop -- 1.1.1`, edit
   `apps/desktop/RELEASE_NOTES.md`, merge the PR.
3. **Start** — Actions → **Desktop release (owner-approved)** → Run workflow on `main`,
   version, channel `production`.
4. **Candidate** (read-only token): guard (main only, version = package.json, notes exist,
   tag not taken, newer than the latest desktop release), website + desktop checks, build,
   optional Authenticode, verification, offline E2E + window suite, candidate artifact.
5. **Approve** — GitHub pauses at `desktop-production`; review the run and click
   *Approve and deploy*.
6. **Publish** — checks the candidate's SHA-256 sums, signs the installer with the
   environment key and verifies it against the key compiled into the app (refuses
   production without a key), creates `desktop-v<version>` at the tested commit with
   installer, blockmap, `latest.yml`, `.sig`, `SHA256SUMS.txt`, Authenticode marker and
   notes, then re-downloads `latest.yml` to confirm.
7. **Installed apps** check at start and every 6 h, show version and notes, download with
   progress, verify, and offer **Install and Restart**.

### Rollback / withdraw

Actions → **Desktop release withdraw (owner-approved rollback)** → tag + reason. After
approval the release is marked as a prerelease: installed apps and the website stop
offering it; history is kept. Apps never downgrade, so publish a fixed higher version to
move users who already installed the withdrawn one.

## In-app behaviour (`apps/desktop/src/main/updater.ts`)

| Step | Behaviour |
|---|---|
| Release selection | GitHub API (cache bypassed) → newest published, stable `desktop-v<x.y.z>` with `latest.yml`, installer, blockmap and `.sig`, strictly newer than the running version; Android `app-v*` releases ignored |
| Transport | HTTPS from github.com through the session allow-list |
| Integrity + authenticity | SHA-512 (`latest.yml`) + Ed25519 signature with the pinned key; Authenticode publisher check in addition when the build is Authenticode-signed |
| Downgrades | Refused (`allowDowngrade = false` + strict version ordering) |
| Defaults | Check automatically: on · Download automatically: on · Install: only via *Install and Restart* |
| Before installing | Editors flush; "Save before updating?" for unsaved projects; recovery snapshots of anything still unsaved; re-verification; then silent NSIS upgrade and relaunch |
| Failure | Failed/cancelled/unverifiable downloads are deleted; the installed version keeps running |
| Offline / blocked | Calm "Can't reach GitHub right now" state; never blocks work |

### Tests

- Unit: signature valid / tampered file / wrong key / version replay / malformed; release
  selection requires the `.sig`; network-failure classification.
- `apps/desktop/test/update-signature-e2e.mjs` (packaged app, loopback feeds): a 1.1.1
  update signed with the real key downloads and verifies; the same installer with a
  signature from a different key is rejected and deleted.
- Earlier (1.0.0 → 1.0.1, loopback feed): full Install and Restart with data preserved.
- **Not tested:** a real published GitHub release (nothing has been published), Authenticode
  verification (no certificate).

### Recovery if an update fails

Program files are replaced; user data lives outside the install folder. If the app does not
start, download the previous `Inkstrip-Manhwa-Studio-Setup-<version>.exe` from its GitHub
release and run it, or reinstall the latest. Projects, settings, autosaves and backups stay.

## Project format versioning

`.inkstrip` container header version 3. Older files open in newer apps; files from a newer
app version are refused rather than rewritten. Files are written only by an explicit Save,
after the previous version is kept in backups.
