# Continuation report (2026-11-07)

## Latest independent QA checkpoint

Read [qa-continuation-2026-11-07.md](qa-continuation-2026-11-07.md) first.
QA fixes pushed at `7ec94e05122ddea2d667f3486cfa87bf0ba4672b`; local full tests
are 1,258/1,258. All four previously pending workflows passed on c10afca; new
regular checks also pass on 7ec94e0. Isolated Windows stability run 42416585169
has PASSED: 60 minutes, 1,717 cycles, zero errors/crashes; raw JSON/CSV/app log are
committed under docs/desktop/evidence.
No owner's Windows installation/backup was accessed by this Linux session.
Signing/authentication/production publication work is explicitly deferred.

If interrupted: read the completed stability evidence and current PR-head checks.
All seven regular workflows also passed on documentation head f2a35df. Do not
mark owner-PC blocked work passed.
Then finish owner-PC validation only when Windows access is available, with a
fresh verified backup and explicit permission before replacing the installed app.

## Historical Codex checkpoint (superseded by the latest QA above)

Started from verified clean HEAD `cbf9f51459c98332e78c1bc20ccf2317b9d2ceee`.
Read [verification-2026-11-07.md](verification-2026-11-07.md) first for exact results,
fixes, provenance and blockers. New desktop tests: 43 passing on Node 24.22.2.
Website build/check/typecheck/lint and remaining test suites pass, but the full npm
test command is blocked by two EPERM directory-junction tests in this restricted session.

The original stability process is still running; **do not start another copy** or stop it.
Its profile, exe copy and reports are beneath:
`C:\Users\ASUS\AppData\Local\Temp\claude\92551a3c0e7c043d\ea8f14e1-481d-439b-ae7d-20682c281b4d\scratchpad\`.
Read `stability/stability-results.json` when present; the progress file already records
one error. The old harness returns zero even for caught errors, so inspect errorCount
and error strings. The corrected harness on this branch fixes that false-success bug.

1. Finish collecting the original stability result and update performance/release reports.
2. GitHub CLI remains unauthenticated in this tool session despite owner login refresh;
   connected GitHub tools work for PR/Actions. Secret presence is UNVERIFIED. Never
   upload the existing key without the owner's separate approval if the secret is absent.
3. Installed 1.0.0 was closed safely (clean marker true), and user data backed up under
   `dist/codex-work/pre-upgrade-backup`. Installation/data filesystem access was not
   granted. It remains 1.0.0; do not claim an upgrade or installed 1.1.0 screenshots.
4. Local renderer/main packaging succeeds; NSIS compiler launch is blocked here. The
   existing verified installer is preserved, but predates these fixes. The original
   Windows Actions job was rerun through the connector and passed including NSIS/E2E.
5. Finish committing/pushing this continuation's fixes, inspect checks on the new head,
   and update PR #41. Do not merge or publish. Keep recommendation NOT READY until
   outstanding verification is resolved.

Logs and private data backups are in ignored `dist/codex-work`; do not commit them.
Scratch report copies for the user are in the Codex chat's `outputs/evidence` directory.

## Original Claude handoff

## Done this session
- Five live-switchable window designs on one native window shell (docs/desktop/window-designs.md); 140/140 window checks at 100–200 % scaling.
- Feature, network-transition, window-design and signed-update E2E suites; all passing on packaged 1.1.0.
- Free update signing: Ed25519 app-pinned key (src/main/update-signature.ts), verified after download and before install; release workflow signs in the approval-gated publish job.
- GitHub: `desktop-production` environment created (owner = required reviewer, `main` only); tag ruleset protecting `desktop-v*`; actions pinned to SHAs; rollback workflow.
- Installer 1.1.0 built: dist/windows/Inkstrip-Manhwa-Studio-Setup.exe (not yet installed on this PC: the owner's 1.0.0 was running).

## Left to do
1. Owner: add the signing key secret (command in update-system.md). The key is at %USERPROFILE%\.inkstrip-release\desktop-update-signing-key.pem; back it up offline.
2. Read the 60-minute stability results (scratchpad `stability/stability-results.json`, started 21:14) and add them to performance-report.md. Re-run with `node apps/desktop/test/stability-desktop.mjs --exe <exe> --minutes 60` if the file is gone.
3. Close Inkstrip 1.0.0, install dist/windows/Inkstrip-Manhwa-Studio-Setup.exe (1.1.0), and verify that projects are preserved.
4. Update desktop-test-results.md and final-release-report.md with this session's results, then update the PR #41 description.
5. Run the full `npm test`, `npm run build` and `check:build` once more before merge.
