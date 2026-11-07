# Continuation report (2026-11-07, stopped at usage limit)

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
