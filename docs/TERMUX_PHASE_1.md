# Android / Termux — Phase 1 documentation patch

This phase contains an audit and plan, not the new image editor. It does not
change application behavior. Do not reapply the previous full studio upgrade.

Download **inkstrip-studio-upgrade.patch** from the Codex response: tap the file,
then Download/Save if a preview opens. Save to Android Downloads. Grant Termux
storage access if necessary:

```sh
termux-setup-storage
cd ~/grok-workspace
git branch --show-current
git status
git log -5 --oneline
```

## Back up before changing the repository

This creates local backups and does not discard anything:

```sh
backup_dir="$HOME/inkstrip-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
git bundle create "$backup_dir/history.bundle" --all
git diff --binary > "$backup_dir/unstaged.patch"
git diff --cached --binary > "$backup_dir/staged.patch"
git ls-files --others --exclude-standard -z > "$backup_dir/untracked-files.list"
tar --null -T "$backup_dir/untracked-files.list" -czf "$backup_dir/untracked-files.tar.gz"
```

Git backups do **not** contain your browser's IndexedDB projects and artwork.
Keep the existing browser profile/domain and do not clear its site storage.
Ignored local environment files remain in place; do not upload them in a patch.

If `git status` is dirty, stop before `git am`. You may save the edits as your own
commit, or explicitly stash tracked and untracked edits:

```sh
# Only when there are unsaved changes, after the backup above:
git stash push --include-untracked -m "Before Inkstrip Phase 1 patch"
git stash list -1
```

Record the stash entry if you created one. Do not restore an older unrelated
stash when there was nothing new to stash. Stashes are local, not a cloud backup.

## Verify branch, history and the intended patch base

```sh
git switch main
git status
git fetch origin
git log --left-right --cherry-mark --oneline main...origin/main
```

If a fast-forward is possible, this preserves your history:

```sh
git merge --ff-only origin/main
git rev-parse HEAD
```

The freshly verified remote base for this export is:

```text
a910e3db97c89150ebdcf5da28348cbeef5ad93b
```

The Codex workspace had older, patch-equivalent commits with different hashes.
The Phase 1 patch contains only two new documentation files and is validated
against the remote commit above. Your phone's unpublished HEAD is not assumed
identical: check it. Do not force it to match using reset or rebase.

If `--ff-only` fails, stop automatic application. The graph has diverged. The
`--cherry-mark` output can identify already-applied patches (`=`). Preserve the
bundle and inspect both histories; do not apply the old feature patch again.
If a normal merge is appropriate, it preserves both histories:

```sh
# Optional reconciliation only after inspecting the clean repository and backup:
git merge --no-commit --no-ff origin/main
git status
```

Review conflicts and staged changes before committing a merge. Use
`git merge --abort` if uncertain. After a merge or if remote main has advanced,
the base hash changes: request verification/regeneration for that base rather
than blindly applying an old patch. Never use force-push as reconciliation.

## Apply only to a clean, verified base

```sh
cd ~/grok-workspace
expected_base=a910e3db97c89150ebdcf5da28348cbeef5ad93b
if [ "$(git branch --show-current)" != main ]; then
  echo "STOP: switch to main after preserving your changes."
elif [ -n "$(git status --porcelain)" ]; then
  echo "STOP: the working tree is dirty; back up and save/stash changes first."
elif [ "$(git rev-parse HEAD)" != "$expected_base" ]; then
  echo "STOP: the patch base differs; verify history before applying."
else
  git am --3way ~/storage/downloads/inkstrip-studio-upgrade.patch
fi
```

Then inspect the result:

```sh
git status
git log -1 --oneline
git show --stat HEAD
```

Expect a single new documentation commit affecting only
`docs/PHASE_1_AUDIT.md` and `docs/TERMUX_PHASE_1.md`. Author/committer hashes may
differ between Codex and Termux because `git am` records your committer metadata.

If application fails and you want to abandon that application attempt:

```sh
git am --abort
git status
```

For a failure you choose to resolve, inspect `git am --show-current-patch`, edit
only the conflicting files, `git add` them, and use `git am --continue`. Do not
use `--skip` unless intentionally omitting that commit. No `reset --hard` is
needed. Do not run `git am --abort` when there is no active am operation.

If you created a stash earlier, restore that **recorded** entry with
`git stash apply <recorded-entry>`, review any conflicts, and keep it until your
work is verified. Restoring uncommitted edits makes the tree dirty again; save
that work intentionally before publishing. Do not automatically drop stashes.

## Install and validate

Use Node 24 or a supported Node 22 >=22.12; verify `node --version`. The existing
Vite/Tailwind native packages may have Android-specific restrictions. Physical
Termux installation was not tested here: if a native package fails, retain the
log and use GitHub Actions/Linux for validation rather than changing dependency
versions at random. The ONNX integration is browser-only and needs no native
CUDA runtime.

```sh
cd ~/grok-workspace
node --version
npm ci --no-audit --no-fund
npm run typecheck
npm run lint
npm test
npm run build
npm run check:build
git status
```

`npm ci` reproduces the lockfile. Use `npm install` when deliberately updating
manifests; it was also exercised for the baseline audit. Neither is a deployment
command. Phase 1 changes no dependency files. Existing lint/deprecation/build
warnings and the unrelated Webpack workflow are explained in the audit.

Optional browser AI regression requires Playwright Chromium and a supported
Linux environment; do not assume a desktop Chromium binary runs in Termux.
It is separate from `npm test`. The existing AI downloads public weights and
runs locally; no API key or environment-variable setup is required.

## Publish only when you choose to

Codex has not pushed or deployed. If you elect to publish after validation:

```sh
git fetch origin
git status
git log --oneline origin/main..main
git push origin main
```

A non-fast-forward rejection means the remote changed: fetch, inspect, and
reconcile without force-pushing. A 403 means the Termux credential needs write
access; do not paste tokens into commands or into chat.

A push to main may trigger Vercel. Check the Configuration checks workflow on
GitHub, then the matching commit in Vercel's Deployments view; require Ready/
success before calling it deployed. The extra Webpack workflow currently fails
and is not the Vite build pipeline. Finally open
https://inkstrip-manhwa-studio.vercel.app/ in your normal browser. Phase 1 adds
only documentation, so no visual editor change is expected.

Proceed to Phase 2 only after explicitly approving it in the Codex conversation.
