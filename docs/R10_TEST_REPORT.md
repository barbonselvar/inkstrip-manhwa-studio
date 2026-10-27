# R10 test report

## Recovered Milestone A HEAD

Exact commit: `b71d7b5e023472940508ea2a4344ea2218d03a75`.
GitHub Actions build [40481033462](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40481033462)
and configuration [40481033491](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40481033491)
passed on that SHA. Neither workflow published browser artifacts; no completed
Claude browser matrix was recovered. Fresh checks were therefore run.

| Check                                        | Actual result                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                                     | PASS                                                                                                                                       |
| `npm test`                                   | PASS: 1,039 tests (200 scripts + 59 app/auth + 116 Studio + 664 Pro), zero failures; audit stub probes also pass                           |
| Typecheck                                    | PASS                                                                                                                                       |
| Lint                                         | PASS                                                                                                                                       |
| Prettier check on files changed against main | PASS                                                                                                                                       |
| Production build / build configuration       | PASS                                                                                                                                       |
| Auth configuration                           | PASS against actual validation dev server using supported `--dev-url`; initial exit 2 observed absent default server, not app disagreement |
| Audit browser                                | PASS at 1440, 390, 320px; no console/page errors                                                                                           |
| Full browser/native/R8/R9 matrix             | PASS: all 49 registered local commands on recovered HEAD (includes raster benchmark); separate release verifier also passes                |

Raw continuation evidence is retained in `/workspace/r10-evidence/`, including
handoff SHAs, recovered PR body, original CI logs, fresh command logs and matrix
results. No assertion has been weakened or skipped. Local browser source-import
tests use the existing test-only eager OCR dependency configuration; production
build uses the normal Vite configuration. External inference results will be
reported separately if blocked. Browser emulation is not physical Android testing.

## Post-fix continuation checks

The focused device-budget regression first failed on the unchanged build. After
the opening preflight fix, `npm test` passes **1,042 tests** (200+59+116+667),
typecheck/lint/build/check:build pass, and the new opening suite passes on dev
at 1440/768/390/360/320px. Claude's unchanged audit suite also passes on dev.
Production-build opening/audit regressions, R8 recovery (pixel tolerance zero) and R9 × R8 integration also pass. Auth configuration recheck passes. Initial
TypeScript checking caught a union-index assignment in the new test fixture;
it was corrected with typed branches without changing any assertion.

Baseline matrix: [a-browser-matrix.json](r10-evidence/a-browser-matrix.json).
Main geometry comparison: [a-row-geometry.json](r10-evidence/a-row-geometry.json).
Real Swin2SR and local OCR succeeded; there was no external inference block in
this environment. Dev/built smoke passed with matching visible content, no console
or page errors and no horizontal overflow. Screenshots were visually inspected.

## Milestone B verified scope

**1,052 unit tests pass** (200 scripts +59 app/auth +116 Studio +677 Pro), including
ten checkpoint/ordering/status/reachability tests. Typecheck, lint, formatting,
production build, build configuration and auth configuration pass.

`test:r10:recovery:browser` runs real transaction/security probes on the source
server and the same positive UI/pixel assertions against the production bundle at
1440/768/390/360/320px. Confirmed: atomic quota/interruption rejection; corrupted
bytes/index metadata, missing assets, wrong identity/page, unknown native/header/DB
versions; primary revision conflict; groups/clipping/layer and filter masks;
explicit restore/Cancel; Undo/Redo; primary quota/unavailability and retry; corrupt
checkpoint refusal through the UI; exact native save/reopen and PNG/preview output.
Every pixel comparison uses **tolerance0**. Header buttons have **zero overlapping
rectangles**. Desktop and 320px screenshots were visually inspected.

The unchanged R8 recovery suite passes (including fresh-context Chapter restore,
R3/R5 integration, exact source bytes and JPEG/WebP recovery), and the opening
regression passes twice on dev and again on the production build.

### Failures investigated during B development

- Visual review found the recovery button overlapping the mobile studio switcher.
  Both now have explicit grid placement; an overlap assertion was added.
- Retry exposed a gap between the request and its Loading state. The click now
  changes both atomically; the original terminal-state assertion is unchanged.
- A new ordering regression failed before the fix: late workers could evict newer
  checkpoints. Per-page revision ordering fixes it without weakening the test.
- A handler named `useCheckpoint` triggered the hook lint rule; it was renamed.
  A strip-only Node test rejected constructor parameter properties; the queue
  now uses ordinary erasable field declarations. No lint/test rules changed.
- A test waiter used an async predicate that this Playwright version treated as
  immediately truthy. Condition polling now checks actual committed records.
- A dev run started before Vite finished a source update and was reloaded. Another
  probe imported a second HMR-timestamped recorder singleton. The final test
  observes the durable checkpoint revision instead of an unrelated queue instance.
  Original logs are retained; no arbitrary delay, tolerance change or skip was used.

Evidence: [b-recovery-browser.json](r10-evidence/b-recovery-browser.json),
[b-retention-before-fix.log](r10-evidence/b-retention-before-fix.log). The final
phase-wide matrix and final-HEAD GitHub checks remain pending later milestones.

## C1 continuation checkpoint

C1:1055 unit tests (200 scripts,59 app/auth,116 Studio,680 Pro), typecheck, lint and production build pass. New mask UI suite passes dev and production bundles at1440/768/390/360/320 with zero pixel tolerance, real touch, local/document history, selection clipping, transformed capture, source retention, native/import and autosave reload. Unchanged r8-ui-browser-check passes five widths. Evidence: c1-mask-browser.json, c1-r8-ui.log. No physical Android claim. Initial transformed-capture test revealed full-document fields accidentally spread into a selection frame; explicit width/height bounds fixed this before commit. Assertions were preserved.

## C2 continuation checkpoint

C2:1059 tests (200+59+116+684), typecheck, lint and build pass. Five-width pattern suites pass on dev and built code, plus unchanged R8 UI. Resume rechecks of type/lint,4 pattern unit tests and desktop browser all pass. Pixel tolerance0 covers preview/export/reopen, source bytes, transparent edges, repeat seams, opacity/scale/offset, Cancel isolation, Undo/Redo and actual autosave reload. Missing assets, corrupt input, malformed records and predecode dimension mismatch have coverage. The actual401e925 legacy native reader rejects bitmap-v3 and accepts procedural-v2. No assertions weakened. Evidence: c2-pattern-browser.json, c2-old-reader.json and c2-r8-ui.log.

## C3 continuation checkpoint

C3 five-width dev and built suites pass at1440/768/390/360/320, including keyboard wrap/Home/End, no artwork nudge, contextual focus and open/closed panel/disclosure behavior. R9×R8 integration passes1440/390. Static/build gates and1061 committed tests pass;10 uncommitted tiled-kernel tests also passed. The first new browser probe used incorrect pre-existing tool labels (Brush/Text instead of Brush tool/Text tool); corrected only the locators, retaining assertions. Screenshot desktop/320 inspected.

## Milestone D continuation

D:1073 unit tests pass (200 scripts+59 app/auth+118 Studio+696 Pro), typecheck/lint/format/build/check:build/check:auth pass. Ten tile tests verify exact kernels/soft alpha/seams/borders, immutable source, cancellation, nonlocal fallbacks and work limits. Two capability tests compare displayed limits with actual opening/filter/AI validators. Eight built-browser long-page cases pass, including Hand pan, zoom/fit, painting, full-resolution PNG hashes, actual save/reopen, original source bytes and explicit resource refusals. Existing R8 processing integration passes. Initial new-test failures: incorrect Gaussian control label corrected; a post-paint reference incorrectly assumed filtering the whole composite. Diagnostics on R10 and unchanged401e925 both show R3 selecting the new Paint layer and identical3018 differing channels from that wrong assumption. The test now filters the sole raster first, retaining the zero-tolerance comparison, then paints/reopens/exports. Failure and target evidence are retained; no app regression or tolerance change was hidden.

## Milestone E continuation

E: five-width dev and built mobile/row checks pass. The new regression exposed32px selection/options/delete targets at768px before the coarse-pointer grid fix. Narrow filenames now receive at least120px measurable width and wrap instead of collapsing beside the48px thumbnail. Touch selection is tested after centering the actual target and verifying elementFromPoint, avoiding the toast/fixed footer overlay; no timing sleep or tolerance change is used. Existing selection/options behavior and audit assertions remain unchanged.1073 unit tests, type/lint/build pass.
