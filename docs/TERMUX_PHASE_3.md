# Install Phase 3 from Android Termux

No push or deployment was performed by Codex. Download the patch you need from
this session into Android Downloads. Do not apply both alternatives:

- `inkstrip-studio-phase-3.patch`: only Phase 3; requires the completed Phase 2
  editor. Export base is `8228f13a191b04d6b6e83baa6f0df8027f4288c2`. Applying Phase
  2 with `git am` on your phone can produce a different commit ID with the same
  files; that is expected. The preflight check below verifies patch compatibility.
- `inkstrip-studio-phases-2-3.patch`: Phase 2 followed by Phase 3, for repositories
  still at verified GitHub main `a910e3db97c89150ebdcf5da28348cbeef5ad93b` without
  Phase 2. The earlier Phase 1 audit documents are not required or replayed.

GitHub main was freshly checked before implementation. An unpublished phone HEAD
cannot be inferred from GitHub. Verify your branch, source state and patch first.
The old full-upgrade patches are not prerequisites if main already contains them.

## Inspect and back up

Grant shared-storage access once if necessary, then inspect:

```sh
termux-setup-storage
cd ~/grok-workspace
git branch --show-current
git status --short
git log -5 --oneline
node --version
```

The repository specifies Node 24. If status lists changes, back them up before
switching branches or applying patches:

```sh
git stash push --include-untracked -m "Before Inkstrip Phase 3"
git stash list
git status --short
```

The stash includes untracked files, not ignored files; separately preserve any
valuable ignored artwork. Browser IndexedDB projects are separate from source/Git
backups: do not clear browser site data or change the production origin.

With a clean tree, switch to main and inspect remote changes:

```sh
git switch main
git fetch origin
git log --oneline --left-right main...origin/main
git status --short
```

If strictly behind, use `git merge --ff-only origin/main`. If both sides have new
commits, inspect them, back up and use an ordinary merge; resolve and validate
before proceeding. Never reset away local work or force-push as a shortcut.
If remote source changes prevent the compatibility check, stop and request a patch
for your new HEAD instead of forcing an old patch onto it.

## Select exactly one patch and apply

If your chapter already has the Phase 2 pencil/full image editor, choose:

```sh
inkstrip_patch="$HOME/storage/downloads/inkstrip-studio-phase-3.patch"
```

If you still have the earlier studio without that editor and are based on the
verified GitHub commit above, choose the combined mailbox instead:

```sh
inkstrip_patch="$HOME/storage/downloads/inkstrip-studio-phases-2-3.patch"
```

The helper refuses to run on a different branch or dirty tree. Read failures;
do not skip the checks or rerun after partial application without recovery.

```sh
apply_inkstrip_phase3() {
  cd ~/grok-workspace || return 1
  test "$(git branch --show-current)" = main || return 1
  test -z "$(git status --porcelain)" || {
    echo "Stop: back up and resolve uncommitted changes first."
    return 1
  }
  test -f "$inkstrip_patch" || return 1
  git apply --check "$inkstrip_patch" || return 1
  git am --3way "$inkstrip_patch" || return 1
  npm install &&
  npm run typecheck &&
  npm run lint &&
  npm test &&
  npm run build &&
  npm run check:build
}
apply_inkstrip_phase3
```

Inspect `git status` and `git log -3 --oneline` afterward. The patch contains
source, tests and documentation, without `.env`, credentials, dependencies,
models or build output. No new environment variables/API keys are required.
Browser regressions additionally require Playwright Chromium and a running local
server; those checks were performed in Codex, while unit/build checks suit Termux.

If `git am` stops, inspect `git status`. Either resolve only the reported source
conflicts, `git add` the resolved files and `git am --continue`, or restore the
pre-application state with `git am --abort`. Do not use `git reset --hard`.
Keep the earlier stash; use `git stash apply` when ready and resolve conflicts,
then rerun validation. Do not remove that backup until your work is verified.

Only when you explicitly decide to publish after review:

```sh
git push origin main
```

That push may automatically trigger your connected Vercel production deployment.
Check the Vercel build, production chapter editing/export, and original recovery.
If remote main advanced, fetch, merge safely, re-test and push normally. HTTP 403
requires fixing your own GitHub authentication; this patch does not change it.
