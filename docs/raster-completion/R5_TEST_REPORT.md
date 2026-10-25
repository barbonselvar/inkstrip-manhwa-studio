# R5 recovery validation report

Runtime under final acceptance: `f12094e5c805f08f93fe519950bc11cb8bc0049f` on
`codex/r5-transform-geometry-engine`. Recovery parent: `0c2b7cb4e7ae9ec7d82bf78fe1d8c819ee17136e`.
The final documentation/delivery HEAD and its GitHub Actions links are recorded in
[Draft PR #15](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/15).

Node24.19.0, npm11.9.0, lockfile install; Playwright Chromium156.0.8078.4 on the
replacement Linux executor. These are newly executed results, not the lost workspace's
13-test draft run. No physical Android, stylus, Safari or Firefox result is claimed.

## Unit, integration and build gates

| Gate                                                               | Actual result                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository access, source write, commands, dependency installation | Passed; fresh clone of the existing branch, `npm ci` exited0                                                                                                                                                                                       |
| Git commit / push authorization                                    | Local commits and authenticated push dry-run passed; final remote HEAD is in PR #15                                                                                                                                                                |
| `npm test`                                                         | **837 passed;0 failed, cancelled or skipped** (200 script +59 app/auth +91 Studio +487 Pro tests)                                                                                                                                                  |
| New test coverage                                                  | 24 new tests:12 geometry operations,8 selected-pixel,3 transform-session,1 PNG-policy. Internal oracles exercise all65,536 alpha/selection combinations and quantized premultiplied residual colors; these are not counted as65,536 separate tests |
| `npm run typecheck`                                                | Passed, including config TypeScript                                                                                                                                                                                                                |
| `npm run lint`                                                     | Passed                                                                                                                                                                                                                                             |
| `npm run build`                                                    | Passed. The standard database migration script reported DATABASE_URL unset and skipped its external migration; no production database operation occurred                                                                                           |
| `npm run check:build`                                              | Passed: Vercel output/server, browser/AI runtime artifacts, PWA and tslib bundling                                                                                                                                                                 |
| `npm run check:auth`                                               | Passed: dev/build both use the existing sign-in-off configuration                                                                                                                                                                                  |
| `git diff --check`                                                 | Passed                                                                                                                                                                                                                                             |

The focused tests cover all nine anchors, locked source rebasing, exact odd half-pixel
centering and inverse resize, group/linked/unlinked masks, captured selection prematrices,
crop/artboard/guide/Dialogue coordinates, budgets, independent mask geometry/nudging,
layer links/locks, history/native bytes, content-angle normalization, staging restrictions,
layer/group limits, alpha/color factoring, tight lifted frames and immutable revision guards.

## Browser acceptance

**All29 browser command suites passed**, plus the local production-build acceptance check.
The complete browser evidence inventory accompanies this report in `r5/validation.json`. The added
`npm run test:r5:browser` passed against the final production build at1440/768/390/360/320px,
with actual mouse/CDP touch selected-pixel handles. It checks initial-pose pixel equality,
Apply/Cancel, unchanged pixels outside the moved region, a single history transaction,
Undo/Redo, native byte retention/reimport, PNG export, Save/close exclusion of temporary
assets, independent mask transforms/nudges, percentages, content rotation, arrow nudges at
all four view quarter turns, anchored canvas pixels, pending output cancellation and real
Lanczos output dimensions. It reports zero browser errors and no horizontal overflow.

Existing browser commands are retained and run with their original assertions. This
includes Studio neural inference; editor; adjustments; retouch; workflow; UI; Pro; layers;
repair; geometry; transform; color; appearance; vector; compound; Pathfinder; artboards;
vector-final; raster-refinement; homepage; Dialogue OCR/UI/workflow/render/security;
Chapter import safety; R2 document and R2 gesture coverage. Exact per-command outcomes,
reruns and the production-build acceptance result are listed in the evidence inventory.
No source or assertion was weakened to make a run pass.

Dev and built homepage smoke checks use the existing readiness-selector option, await
visible content, and report no console/page errors, branding/auth warnings or overflow.
Built output agrees with the dev baseline. Desktop/mobile screenshots were visually
inspected, including the R5 workspace; early loading-screen captures were replaced with
ready-state captures. Production acceptance is local-only; it does not contact or deploy
the Vercel production application.

## Failures investigated and reruns

- Early background development-server lifetime failure caused connection/download timeouts.
  A persistent server replaced it; that run is not counted as a pass.
- Vite's first lazy ONNX/Tesseract dependency optimization and edits during reconstruction
  reloaded open QA pages. Several suites failed with navigation-destroyed contexts or missing
  dialogs/controls after reload. Their successful partial messages were not treated as full
  suite success. Affected suites were rerun against frozen built output; original logs remain
  in the execution evidence directory.
- The initial regression orchestrator supplied an invalid `:browser` suffix to three Dialogue
  commands. The actual supported workflow/render/security scripts were then run explicitly.
- Three module-level Dialogue probes import `/src` modules directly and therefore failed
  when pointed at built output. They passed on the frozen dev server with the supported
  commands; their built-server attempts are retained in the evidence inventory.
- The new R5 test initially assumed native IDs were preserved. Native import intentionally
  remaps IDs; assertions now compare real imported IDs and immutable bytes. No runtime rule
  was changed to satisfy that fixture assumption.
- Pixel benchmarking found feathered color error above2 premultiplied levels; the residual
  now factors quantized premultiplied color, reducing the measured maximum to1.459. Tight
  selected-pixel bounds and restoring the original centered preview pivot were also fixed.
- A real4MP canvas PNG exceeded the header-read budget because IDAT header reads speculatively
  charged compressed pixel payload. Exact header reads preserve the2MiB budget and pass both
  a600-chunk unit fixture and actual4MP worker PNG encode/redecode.
- Real neural inference initially stalled while the local Nitro QA server compressed WASM.
  A direct transport probe served identical11,210,254 bytes in0.225s with identity encoding;
  the compressed request exceeded20s without returning bytes. The local Studio QA context now
  requests identity encoding, with TLS verification enabled and unchanged model, runtime,
  deadlines and assertions. Real Swin2SR inference, comparison, apply/reload, original recovery,
  cancellation and batch enhancement then passed. No mocked inference is reported.

## Native workload measurements

`npm run bench:r5` runs the actual rendering worker, PNG encoding/decoding and export.
One sample per size, shared executor under concurrent browser load; timings are not phone
promises, latency percentiles or peak memory measurements. Source/selection fixtures are
procedural gradients and feathered ellipses, with layer opacity0.73 and Multiply.

| Canvas           | Lift/encode stage | Affine transform + Lanczos half-size PNG export | New PNG asset bytes | Maximum alpha difference | Maximum premultiplied color difference |
| ---------------- | ----------------- | ----------------------------------------------- | ------------------- | ------------------------ | -------------------------------------- |
| 128×96, alpha0.5 | 70.6ms            | 318.4ms                                         | 26,769              | 0                        | 1.0941                                 |
| 512×512          | 91.5ms            | 272.7ms                                         | 363,941             | 0                        | 1.4588                                 |
| 1024×1024        | 288.2ms           | 525.4ms                                         | 1,331,535           | 0                        | 1.4588                                 |
| 2000×2000 (4MP)  | 803.6ms           | 1277.3ms                                        | 4,590,225           | 0                        | 1.4588                                 |

The final encoded export dimensions are decoded and checked, not inferred from metadata.
Raw measurements are in `r5/benchmark.json`. The4MP staging cap remains independent of
unchanged ordinary document/device/source/asset/history budgets. No peak staging-memory,
physical-device throughput or arbitrary16.8MP selected-pixel throughput is claimed.

## Compatibility, limits and release disposition

Main remained `7538ee31d119276e37eae56c6694c9113f7e2e03` on fresh fetch. R1/R1.1/R2
native/import/history/source preservation are covered by the full tests and real browser
regressions. Existing native versions1–5/Dialogue7 and the separate unreleased AI6 boundary
are preserved. The lockfile, dependencies and native schema were not changed.

R3 `848ebf8` was inspected without merging. Its brush changes share UI files/scripts;
read-only patch applicability identifies conflicts in `package.json` and `pro-canvas.tsx`.
No combined-branch runtime test or clean merge is claimed. No published R4 ref/PR was found.
Selected-pixel and mask-only boundaries are explicit in the [gap inventory](R5_GAP_ANALYSIS.md):
4MP single-layer staging, no linked/clipped/effected/nonlinear starting layer, existing source
and asset budgets, retained hidden original, finite feather rounding, affine-only independent
mask geometry. Physical Android/stylus and other browser engines remain untested.

**All local gates passed; no known R5 release-blocking defect remains within the documented
supported scope.** Keep PR #15 Draft. Publication is not a merge/deployment approval. No main mutation,
unrelated merge, deployment or R6 work occurred. Any unfinished validation gate is identified
in the evidence inventory and PR, rather than marked complete.

## R3/R5 integration validation (2026-10-25)

`main` @ `d055027` (R3 merged) was merged into this branch with a merge commit (`690dcce`); no
published history was rewritten. Validated code commit: `3225ba4` plus the cross-engine unit test
in the following commit.

**Conflicts resolved.**

- `package.json`: both sides appended scripts after `test:r2:gesture:browser`; all four kept
  (`test:r3:browser`, `bench:r3:brush`, `test:r5:browser`, `bench:r5`).
- `pro-canvas.tsx`, `pro-properties.tsx`, `pro-workspace.tsx`: merged without textual conflicts.
  R3 (stroke recording, release catch-up, budgets, cursor, pressure curve, preset panel) and R5
  (mask Move/nudge, transform-draft cloning, selected-pixel transactions, Geometry commit) touch
  disjoint code paths. A cross-engine unit test confirms that after an R5 mask-only move, rotate
  and scale, R3's recorded mask stroke point and brush cursor both map back to the pointer, the
  artwork transform is untouched, and the stroke validates.
- `vercel.json`: the branch-only `git.deploymentEnabled` exclusion was removed. It never affected
  production, which deploys only from `main`. The file is identical to production `main`;
  branch pushes now create ordinary Vercel preview (non-production) deployments again.

**Integration defect fixed.** `r5-browser-check.mjs` and `r5-benchmark.mjs` wrote
`/workspace/r5-evidence/*.json` without creating the directory, so on a fresh machine the R5
browser suite failed after every viewport had passed. Directory creation added; assertions
unchanged.

**Independently verified here (ran in this environment).**

| Check                                                                                                                                                                                                                                        | Result                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| R5's own head `f6e6b76`, `npm test`                                                                                                                                                                                                          | **837 / 837** (matches the reported figure)                                                    |
| Combined branch, `npm test`                                                                                                                                                                                                                  | **848 / 848** = 813 baseline + 10 R3 + 24 R5 + 1 cross-engine; 0 failed, skipped or cancelled  |
| typecheck, lint, Prettier, build, `check:build`, `check:auth`                                                                                                                                                                                | pass                                                                                           |
| `test:r5:browser` at 1440/768/390/360/320                                                                                                                                                                                                    | pass after the evidence-directory fix (first run: all viewports passed, then the write failed) |
| `test:r3:browser` at 1440/768/390/360/320                                                                                                                                                                                                    | pass                                                                                           |
| 27 other Chromium suites (R1.1/R2, homepage, Dialogue ×5, editor, adjustments, retouch, workflow, ui, pro, layers, repair, geometry, transform, color, appearance, vector, compound, pathfinder, artboards, vector-final, raster-refinement) | pass                                                                                           |
| `production-vector-check --raster` on the built output at the integration commit                                                                                                                                                             | pass, no console errors or failed critical assets                                              |

**Not verifiable in this environment (blocked, neither confirmed nor refuted).**

- R5's reported real Swin2SR inference, comparison/apply/reload and batch enhancement:
  `test:studio:browser` reaches real inference after a successful image decode, but
  `huggingface.co` is unreachable from this sandbox ("Failed to fetch"). The same happens on `main`.
- Production `inkstrip-manhwa-studio.vercel.app`: denied by the environment network policy; no
  live smoke test was possible.
- R5's reported 4MP timings were not re-measured. Physical stylus/Android and other browser
  engines remain untested.
