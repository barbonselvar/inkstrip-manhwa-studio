# Update system and owner-approved releases

## Owner workflow

1. **Implement & test** — changes land on a branch; `desktop-ci.yml` builds the app on
   Windows, runs the unit tests and the offline end-to-end suite against the packaged
   app, and uploads an *unsigned test installer* artifact. Nothing is published.
2. **Prepare the release candidate** — `npm run release:prepare --prefix apps/desktop -- 1.0.1`
   sets the version and adds a `## 1.0.1` section to `apps/desktop/RELEASE_NOTES.md`.
   Edit the notes, open a PR, merge it normally. *Merging never releases anything.*
3. **Start the release** — Actions → **Desktop release (owner-approved)** → *Run
   workflow* on `main`, version `1.0.1`, channel `production`.
4. **Candidate job** (read-only token): release guard (main only, version = package.json,
   notes present, tag `desktop-v1.0.1` must not exist, must be newer than the newest
   published desktop release), full website checks, desktop checks, build, **sign**,
   verify Authenticode on app and installer + pinned `publisherName` + `latest.yml`
   SHA-512, offline E2E on the packaged app, upload the candidate.
5. **Approval** — the `publish` job targets the protected **`desktop-production`**
   environment. GitHub pauses and notifies the required reviewer (the owner), who
   reviews the run, E2E evidence and candidate artifact, then clicks *Approve and deploy*.
6. **Publish** — only this job has `contents: write`. It re-checks the SHA-256 sums,
   refuses unsigned production releases, creates `desktop-v1.0.1` at the tested commit
   with the installer, blockmap, `latest.yml`, `SHA256SUMS.txt` and the notes, then
   downloads `latest.yml` back to confirm the release.
7. **Installed apps** detect it (on start + every 6 h), show version and notes, download
   with progress, verify, and offer **Install and Restart**.

### One-time repository setup (owner, in GitHub settings — not done by this change)

- Settings → Environments → **New environment** `desktop-production`:
  - *Required reviewers*: the owner account; enable *Prevent self-review* only if
    another maintainer exists.
  - *Deployment branches and tags*: **Selected branches** → `main`.
- Settings → Secrets and variables → Actions (or environment secrets on
  `desktop-production`): `WINDOWS_CERTIFICATE` (base64 of the `.pfx`),
  `WINDOWS_CERTIFICATE_PASSWORD`.
- Optional: protect tags `desktop-v*` (Settings → Rules → Rulesets) so only Actions can
  create them.

Environment required reviewers are available for public repositories on every plan. If
the repository is private on a plan without them, the workflow still only runs on manual
dispatch by users with write access, but the extra approval pause is missing — keep the
repository's write access limited to the owner in that case.

Without a certificate, use channel **test-prerelease**: it publishes a *prerelease*
marked "test build", which installed apps and the website ignore.

## In-app behaviour (`apps/desktop/src/main/updater.ts`)

| Step | Behaviour |
|---|---|
| Release selection | GitHub API → newest published, non-draft, non-prerelease `desktop-v<x.y.z>` with `latest.yml`, the versioned installer and blockmap, strictly newer than the running version (`update-feed.ts`; the repo's Android `app-v*` releases are ignored) |
| Transport | HTTPS from github.com; requests outside the allow-list are blocked |
| Integrity | electron-updater verifies the SHA-512 from `latest.yml` (and blockmaps for differential downloads) |
| Authenticity | Automatic download/installation is enabled only if the running app is validly signed **and** `app-update.yml` pins a publisher; electron-updater then requires the downloaded installer's Authenticode signature to match that publisher. A checksum alone is never treated as authenticity. |
| Unsigned builds (like this 1.0.0) | Can check and show "1.x is available" with a link to the release page, but never download or install automatically |
| Downgrades | `allowDowngrade = false`, plus version ordering in release selection |
| Defaults | Check automatically: on · Download automatically: on · Install: only when the user clicks *Install and Restart* (`autoInstallOnAppQuit = false`) |
| Before installing | Editors flush; projects with unsaved file changes trigger "Save before updating?" (Save / Update without saving to file / Cancel); a recovery snapshot of every still-unsaved project is written; then a silent NSIS upgrade and relaunch |
| Failure | Failed or cancelled downloads are discarded; the installed version keeps running. Interrupted downloads restart (partial files are re-verified). Offline → "check later", never an error dialog |
| Settings | Help → Check for Updates…, Settings → Updates (auto check / auto download), About (installed version, signature state), release notes in the update dialog |

### Controlled update test (performed)

`apps/desktop/test/update-feed-server.mjs` serves a build folder on `127.0.0.1`. An
installed app started with `INKSTRIP_UPDATE_TEST_FEED=http://127.0.0.1:8765/` (accepted
only for loopback URLs) uses it instead of GitHub. Results are in
[desktop-test-results.md](desktop-test-results.md#update-test).

### Recovery if an update fails

The NSIS upgrade replaces program files only; user data is outside the install folder.
If the app does not start after an update: download the previous
`Inkstrip-Manhwa-Studio-Setup-<version>.exe` from the GitHub release and run it (it
uninstalls the broken version and installs over it), or reinstall the latest one. Projects,
settings, autosaves and backups remain in place.

## Project format versioning across app versions

`.inkstrip` uses the container's header `version` (currently 3). Older files are read by
newer apps; a file from a newer app version is refused with "made by a newer Inkstrip
version" instead of being rewritten. The app never rewrites a project file on open — only
an explicit Save writes it, after keeping the previous version in backups.
