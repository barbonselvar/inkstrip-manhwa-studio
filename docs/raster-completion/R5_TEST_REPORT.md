# R5 test checkpoint — incomplete

Draft PR: https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/15  
Branch: `codex/r5-transform-geometry-engine`  
Base: `7538ee31d119276e37eae56c6694c9113f7e2e03`  
Audit checkpoint: `be5417f336ef33cbbae0e468b4f2c32087fa0443`

## Confirmed observations

| Command / check | Result and scope |
| --- | --- |
| `git fetch origin --prune`, GitHub main/open-PR inspection | Passed; isolated branch created directly from main; R3/R4/F1 not incorporated |
| `npm ci` | Completed with exit0 using the repository lockfile; no dependency additions |
| `npm test` before adding the new geometry test file | Completed baseline run; the final Pro group reported464 passed,0 failures/skips/cancellations. This was not the final R5 source |
| `node --experimental-strip-types --test src/lib/studio/pro/geometry-operations.test.ts` | **13 passed,0 failed/skipped/cancelled**, local draft only; output was read before disconnection |
| Intermediate `npm run typecheck` invocations | Invoked; no errors in the logs inspected at that point, but final completion status for the latest draft was not captured. Do not count this as final R5 validation |
| GitHub Actions on audit-only be5417f | Both passed: [Configuration40141470422](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40141470422), [Build40141470444](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40141470444). These checks test baseline code plus documentation, not the uncommitted R5 runtime drafts |

The 13 local cases cover nine-anchor source translation/IDs, shrink/re-expand source recovery, linked/unlinked/group mask alignment, crop/saved-selection/artboard/Dialogue coordinate shifts, captured-selection prematrices, invalid dimensions/budgets, affine mask-only preservation, invalid/locked/projective mask targets, linked-layer nudges, independent mask nudges, Undo/Redo, native metadata/source-byte round trip and content-angle normalization.

Do not combine the focused13 cases with the earlier baseline run into a claimed final R5 test count.

## Blocked / not completed

- Final combined unit/integration suite on the complete R5 runtime.
- Final TypeScript, ESLint, production build, `check:build`, `check:auth`.
- New selected-pixel algorithm and staging integration tests.
- R5 pixel-level/browser coverage, desktop and touch-emulated1440/768/390/360/320px.
- Crop/canvas/image-size actual pixel comparisons and final transform preview/export equality.
- Full Chapter/Raster/Vector/Dialogue/homepage/AI/import-safety regressions for the new runtime.
- Performance/memory benchmarks and resource-cap validation.
- Final implementation-HEAD GitHub Actions.
- Physical Android/stylus validation (not performed).

No benchmark timings, peak-memory measurements, browser passes or rendering-quality findings are claimed for R5.

## Infrastructure failure and reproducibility

Logs were written under `/workspace/r5-evidence` while the workspace was usable. Their persistence cannot currently be checked. The execution service first reported an exec-server transport disconnection, then explicitly reported no usable execution environment. The command wiring the selected-pixel workspace/renderer/UI stage was rejected before process creation; assume it is unapplied until the worktree is inspected.

Restore/reconnect this task's execution workspace, inspect the existing worktree and logs, then rerun every pending gate. The Draft PR must remain blocked; a documentation-only green CI result is not evidence that R5 editing works.

No existing assertions were weakened or removed. No source draft was pushed without its required final verification. Main remains unchanged and production was not deployed.
