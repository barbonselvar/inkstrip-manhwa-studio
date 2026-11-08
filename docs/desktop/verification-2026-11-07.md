# Desktop 1.1.0 continuation verification

> Subsequent independent QA, exact Actions evidence, new installer provenance,
> local 1,258-test results and remaining Windows blockers are recorded in
> [qa-continuation-2026-11-07.md](qa-continuation-2026-11-07.md).
> This file retains the earlier Windows-session findings as historical evidence.

This report supersedes the historical 1.0.0 release report. Verification started from
clean branch `desktop/windows-app` at `cbf9f51459c98332e78c1bc20ccf2317b9d2ceee`.
PR: https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/41.

## Corrections

- Release selection now requires the exact installer's signature and blockmap. A
  regression test reproduced acceptance of an unrelated `.sig` before the fix. A stray
  installer attachment no longer hides an otherwise complete release.
- Stability testing no longer returns success after caught workflow/console errors.
  It requires a full measured workload, records actual elapsed time and CPU samples,
  and includes error text in progress reports. Five outcome regression tests added.
- Six updater-service tests cover interrupted transfers, cancellation/retry,
  verification failure cleanup, project preservation, re-verification before install,
  and the requirement for an explicit install request. These use transport/verifier
  stubs, not a real Windows upgrade or real release signing key.
- Windows CI/release multi-command checks stop on a failed native command. Desktop CI
  now also runs feature and network suites and retains app logs for diagnosis.
- Updater source comments corrected to describe Ed25519 separately from Authenticode.

## Executed locally

| Check | Result |
|---|---|
| Website production `npm run build`, `check:build` | PASS; no database URL, migration skipped |
| Website typecheck and lint | PASS |
| Desktop typecheck | PASS |
| Script tests | 202 PASS; two directory-link tests blocked by EPERM |
| Website library/auth/release tests | 65 PASS |
| Studio tests | 151 PASS |
| Pro editor tests | 707 PASS |
| Composition tests | 86 PASS |
| Security probes | PASS, fail-closed responses |
| Desktop unit/service/outcome tests | 43 PASS on Node 24.22.2 |
| Shipped desktop dependency audit | PASS, zero vulnerabilities |
| Existing local release key vs embedded public key | MATCH, no private material displayed |
| Installer checksum | PASS for the existing 1.1.0 installer (see below) |
| Fresh packaged E2E launch in this restricted session | BLOCKED: process fails before debugger attachment |
| Fresh local installer build | Renderer/main and packaging succeed; NSIS compiler launch blocked (`spawn UNKNOWN`) |

The unmodified `npm test` command was executed with Node 26.13.0 and the supported
Node 24.22.2; both stop at two directory junction tests with EPERM. The remaining suites
were executed separately. Do not call the full command passed. Initial temp-file
permission failures were avoided by placing scratch files in the ignored `dist/` tree;
this does not change the tests. No tests were changed to skip or mask these failures.

## Recovered packaged-app evidence

Claude's scratchpad JSON files were read, rather than trusting the handoff's totals:

- Offline E2E: 13/13, failure null.
- Feature workflows: 6/6, failure null.
- Network transitions: 5/5, failure null.
- Window designs: 140/140 across 100/125/150/200%, failure null.
- Signed downloads: valid pinned-key download accepted; foreign-key download rejected;
  2/2, failure null. No installer was run by that test.

The preserved `titlebar-*.png` files are screenshots of the shell renderer page. They
do **not** show the whole composed native window, editor view or Windows caption
buttons, and are **not** proof of five installed-app screenshots or Windows Snap.

## GitHub configuration and checks

Read from GitHub on 2026-11-07:

- `desktop-production` exists. Required reviewer is `barbonselvar`, self-review allowed,
  administrator bypass enabled. Its only allowed deployment branch is `main`.
- Ruleset 26771348 is active on `refs/tags/desktop-v*`, forbidding update, deletion and
  non-fast-forward movement. Tag creation is not restricted by this ruleset.
- Signing secret presence remains **UNVERIFIED**: this session's GitHub CLI reports an
  invalid login / HTTP 401 even after the owner refreshed login. The connected GitHub
  tools can access PRs and Actions, but cannot list environment secrets. No secret was
  configured, overwritten, or rotated.
- The existing private-key file is present and matches the pinned public key. Its ACL
  grants access to the owner, SYSTEM and local Administrators, with inheritance off.
- At `cbf9f51`, the six other PR workflows passed. Windows desktop run 42410166835 first
  failed attaching Playwright after app startup. Its requested rerun (job 128523155653)
  passed all steps, including packaged offline E2E, 140 window checks, installer build
  and artifact upload. This result applies to that original commit, not later fixes.

No production release or withdrawal workflow was dispatched. No merge performed.

## Installed application and installer

- Installed executable: `%LOCALAPPDATA%\Programs\Inkstrip Manhwa Studio\Inkstrip Manhwa Studio.exe`.
- Installed version remains **1.0.0**. It was inspected with Computer Use at the library
  screen and closed normally, without a save prompt. The clean-exit marker was checked.
- A read-only backup of the closed app's roaming data and Workspace was copied to
  `dist/codex-work/pre-upgrade-backup/` (126 files, 11,236,387 bytes).
- Requested filesystem access to installation/data folders was not granted (only the
  desktop shortcut path was granted). No overwrite or installation was attempted.
- Existing installer: `C:\Users\ASUS\Desktop\inkstrip\dist\windows\Inkstrip-Manhwa-Studio-Setup.exe`.
  Version 1.1.0, 135,443,419 bytes, SHA-256
  `12065ce35e737ddf082c892bf1e0f06f4df64da221adea691dbe9dae21381363`.
  It matches `dist/windows/checksums.txt`, and is Authenticode **NotSigned**.
  It predates this continuation's fixes. Its old packaged app embedded commit `6f5cf07`
  while already containing the pinned update key, because it was built before the
  signing changes were committed. Do not label this installer as built from final HEAD.

## Still in progress / blocked

- The original 60-minute stability run remains active in its separate `stability-app`
  copy. Read the final JSON at the scratchpad path in CONTINUATION.md when it finishes.
  Progress already records one error; it cannot be called passed merely because it
  finishes or the old script returns zero. No complete result existed when this report
  was initially written. CPU/GPU usage was not recorded by that old harness; working
  set and JS heap were sampled. Memory leak conclusions require final data.
- Verify signing-secret presence with authenticated access; if absent, obtain the
  owner's explicit approval before securely storing the existing key.
- Install 1.1.0 only after access is available, then verify preservation, native controls,
  dragging/resizing/Snap, settings persistence, editing workflow and five full-window
  screenshots on the actual installed app.
- Real signed GitHub release, Authenticode validation, Windows 10, pen/tablet and
  multi-monitor coverage remain NOT TESTED. No production release is required to
  complete isolated update tests.
- Push the verified corrections, inspect their new PR checks, update this report with
  final commit and stability results, and update PR #41.

Recommendation at this checkpoint: **NOT READY TO MERGE**; validation/install and
signing-secret verification remain incomplete. No unexecuted check is counted as passed.
