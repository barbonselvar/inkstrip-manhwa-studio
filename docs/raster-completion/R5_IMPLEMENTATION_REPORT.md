# R5 execution recovery and implementation report

Branch: `codex/r5-transform-geometry-engine` · [Draft PR #15](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/15)

Published recovery checkpoint: `0c2b7cb4e7ae9ec7d82bf78fe1d8c819ee17136e`.
Initial reconstructed implementation commit: `2dd5875` (follow-up fixes and final delivery SHA are
recorded in the PR). Final runtime: `f12094e5c805f08f93fe519950bc11cb8bc0049f`. Main/base: `7538ee31d119276e37eae56c6694c9113f7e2e03`.

## Environment and recovery

The replacement executor became usable. Repository clone/access, terminal commands,
source writes, `npm ci`, tests, Git commit and authenticated push dry-run all worked.
The fresh workspace initially had no repository or old `/workspace/r5-evidence` directory.
Workspace/scratch/shared/tmp inspection, the published branch/PR reports and `git fsck
--no-reflogs --unreachable` found no recoverable unpublished drafts. No prior filesystem
snapshot is exposed by the available runtime interfaces. This is a reconstruction of the
missing drafts, not a claim that the lost local source or its old test logs were recovered.

The existing R5 branch and PR were reused. Both published audit commits remain ancestors.
No existing engine was restarted or replaced. Existing affine/projective/warp, rendering,
precision, crop/output, masks, native storage, resource policy and history were reused.

## Reconstructed work

- `geometry-operations.ts`: nine anchored canvas-origin operations; captured selection
  prematrix rebasing; ordinary/group/unlinked mask alignment; crop, artboard, guide and
  Dialogue region translation; affine mask-only placement and document-space nudges.
- Transform/Geometry controls: explicit scope, percentages, +/-90/180 content rotation,
  configurable large nudge step, percentage image size, pending cancellation/summary,
  canvas anchor selector and independent layer/mask targeting. Existing touch styling is reused.
- `transform-session.ts`: immutable origin/revision guard for preview and Apply; safe
  gesture cloning; one transactional publication; stale drafts cannot target a newer document.
- `selection-transform.ts` and worker/client integration: explicit selected-pixel lift,
  fractional alpha/premultiplied residual factoring, native-resolution immutable PNGs,
  tight visible-pixel transform frame and pivot, live floating preview, hidden editable
  original, one Apply transaction, native/export/history integration. Session persistence
  never receives an unaccepted stage. Worker cancellation and late replies cannot publish
  into a changed/unmounted document.
- Confirmed workload defects fixed: color rounding at translucent feather edges; drift
  from rounded odd center anchors; Restore initial transform losing the centered preview
  pivot; high-entropy chunked PNGs falsely exhausting the import header-reading budget.
- New reproducible commands: `test:r5:browser`, `bench:r5`; geometry, selected-pixel,
  revision, PNG-policy and actual browser/worker/native tests. Existing assertions remain.

## Safe supported scope

Whole-layer operations retain the normal existing16.8MP/16384-side and device budgets.
Selected-pixel staging is bounded to4MP and existing asset/source/layer/group budgets.
It accepts one visible unlocked affine raster/paint layer. Links, clipping stacks, enabled
layer effects and nonlinear starting layers reject explicitly; masks/adjustments on an
accepted layer are baked into the processed pieces, with the original retained hidden.
The selection itself stays at its original document coordinates. Feathered reassembly has
small measured Canvas/PNG rounding; see the exact metrics, not a lossless blanket claim.

Image Resize retains the existing professional output-grid workflow: the final cropped
composite is truly resampled; source layers do not undergo repeated destructive resizing.
Masks support independent affine transforms; nonlinear mask-only targets remain unsupported.
Existing bounded perspective/warp support was preserved, without introducing a new mesh engine.
No native fields or envelope versions were added, and source asset bytes remain immutable.

## Compatibility and publication controls

R1/R1.1/R2 source and regressions were inspected and exercised. R3's separate brush branch
was inspected read-only. Shared UI/import/script hunks need normal conflict resolution when
integrated later; a clean combined runtime is not claimed. No R4 branch/PR is published.
No R3/R4/F1 commit was incorporated, and PRs #6/#14 remain independent.

The Vercel Git configuration excludes only `codex/r5-transform-geometry-engine` from automatic
deployments. This prevents an ordinary requested branch push from invoking the existing
preview integration. No deployment command or hosting API was invoked. Main, production
configuration for other branches, dependency versions/lockfile and native formats are unchanged.

## Validation and disposition

Local validation passed: **837 automated tests,29 browser suites, typecheck, lint, build,
configuration/auth checks and local production-build acceptance**. No known R5 release-blocking
defect remains within the documented supported scope. Final test counts, browser reruns, measured staging results and remaining limitations are
recorded in [R5_TEST_REPORT.md](R5_TEST_REPORT.md). The PR stays Draft. No main write, PR merge,
Vercel deployment or R6 work occurred. Implementation delivery is not authorization to release;
any unresolved full-suite validation failure remains visible in that report.
