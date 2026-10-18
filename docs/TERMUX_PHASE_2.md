# Apply Phase 2 safely from Android Termux

Download `inkstrip-studio-phase-2.patch` from the chat attachment/link to Android
Downloads. This is an incremental editor patch, not the earlier full upgrade.
It was validated on GitHub main at
`a910e3db97c89150ebdcf5da28348cbeef5ad93b`. It also works if the Phase 1 audit docs
are already applied. Existing local implementation history was retained through a
merge (`ca83fa0`); only the subsequent Phase 2 commit is exported, so old changes
and audit commits are not replayed. Do not apply both an older upgrade and this
patch blindly. No deployment is performed by this session.

Grant shared storage access once if needed:

```sh
termux-setup-storage
```

Inspect and preserve local work first:

```sh
cd ~/grok-workspace
git branch --show-current
git status --short
git log -5 --oneline
```

If status lists changes, save them before switching branches or applying a patch:

```sh
git stash push --include-untracked -m "Before Inkstrip Phase 2"
git stash list
git status --short
```

This stash includes untracked files, but not ignored files. Keep separate copies
of any valuable ignored artwork files; do not add credentials to Git. If status
is still dirty, stop and resolve that before proceeding. Do not use reset --hard.

With a clean working tree:

```sh
git switch main
git fetch origin
git status --short
git log --oneline --left-right main...origin/main
```

If main is strictly behind, update with `git merge --ff-only origin/main`. If both
sides contain unique commits, inspect them first and use an ordinary merge after
backing up; resolve conflicts and validate before applying. Do not force-push or
reset away your commits. If the remote changed since this patch was prepared,
the ancestry check alone does not guarantee compatibility; the patch check below
must pass too. If it fails, stop and request an updated patch for your exact HEAD.

```sh
git merge-base --is-ancestor a910e3db97c89150ebdcf5da28348cbeef5ad93b HEAD
# Continue only if the previous command returned success (exit code 0).
git apply --check ~/storage/downloads/inkstrip-studio-phase-2.patch
# Continue only if there were no errors and git status is clean.
git status --short
git am --3way ~/storage/downloads/inkstrip-studio-phase-2.patch
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run check:build
git status --short
git log -3 --oneline
```

The project currently specifies Node 24 in `.nvmrc`; check `node --version` first.
Android package availability may differ. Browser regression scripts additionally
need Playwright Chromium and a local server; the standard unit/build checks above
are suitable for Termux. The production browser checks were run in the Codex
session. Inspect any package-lock changes from installation rather than committing
them automatically. No API key or new environment variable is needed for Phase 2.

If `git am` stops, `git status` explains the conflict. Either resolve the source,
add only resolved files, and use `git am --continue`, or return to the pre-application
state with `git am --abort`. Keep your earlier stash until everything is verified.
To restore it, use `git stash apply` (not pop), resolve conflicts if any, and keep
the stash backup until satisfied. Re-run validation after restoring source changes.

Only after your review and explicit decision to publish:

```sh
git push origin main
```

A push to the connected Vercel repository may immediately trigger production
deployment. Verify the Vercel build and test the production website yourself after
publishing. A 403 still requires fixing your own GitHub credentials or repository
permissions; the patch does not change authentication. If push is rejected because
remote main advanced, fetch, merge safely, re-test, and push normally.
