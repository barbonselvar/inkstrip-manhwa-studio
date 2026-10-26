# R8 test report

**PASS: 1,007 unit tests, 42 registered browser suites, existing raster browser benchmark, R8 worker benchmark and local production-build acceptance on current main's immutable test-merge candidate.** Exact-candidate source CI is green. PR19 stays Draft; R8 did not merge or deploy production.

## Revision and recovery record

Recovered branch `codex/r8-layer-effects-smart-filters-gradients` at `244a1d6` without uncommitted source changes. All completed R8 functionality was retained. The interruption was an OCR/Vite initialization failure, not a lost implementation.

Final full matrix candidate: `1f43b387dc96466e5c68b60f4dc779e496e74adf`, with independently verified parents current main `bfcbdf99248e75bfe10d8d1df6d71bb5acd6a596` and branch `2b3c30a8f3f24b67106047648edc97f2c323fb38`. Final R8 code is `130410b`; its following commits document integration. This candidate includes PR20's externally merged changes without merging them into the R8 branch. All application trees are recorded in [validation.json](r8-evidence/validation.json); final documentation-only publication is checked against those same combined tree IDs. Exact publishing SHA and final CI links are on [Draft PR19](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/19).

[Configuration CI40314424480](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40314424480) and [Build CI40314424520](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/40314424520) check out that exact candidate. Final publishing-head CI is independently verified before delivery.

## Local gates

Fresh npm ci passed; lock/dependencies are unchanged. Unit totals: 200 repository scripts + 59 app/auth + 108 Studio + 640 Pro = 1007; 0 failures/skips. The original main had 942; PR20 adds three cases and R8 adds 62. The final candidate's complete checks ran locally and in CI.

| Command               | Result | Elapsed |
| --------------------- | ------ | ------- |
| `npm test`            | PASS   | 21.00s  |
| `npm run build`       | PASS   | 5.73s   |
| `npm run typecheck`   | PASS   | 10.97s  |
| `npm run lint`        | PASS   | 8.47s   |
| `npm run check:build` | PASS   | 0.15s   |
| `npm run check:auth`  | PASS   | 0.18s   |

## Full final browser matrix

R3 dense-stroke stress ran alone before built-server work. Source-module tests use the immutable dev server with `scripts/vite-browser-qa.config.mjs`; other suites use that candidate's actual production build. The existing QA transport preserves bytes and production WebAssembly MIME behavior for the local built server. Production configuration/assertions are unchanged. There are no arbitrary test delays, model mocks or skipped required suites.

| Command                          | Result | Elapsed |
| -------------------------------- | ------ | ------- |
| `test:r3:browser`                | PASS   | 381.01s |
| `test:studio:browser`            | PASS   | 43.27s  |
| `test:editor:browser`            | PASS   | 14.33s  |
| `test:adjustments:browser`       | PASS   | 13.97s  |
| `test:retouch:browser`           | PASS   | 5.06s   |
| `test:workflow:browser`          | PASS   | 13.27s  |
| `test:ui:browser`                | PASS   | 17.01s  |
| `test:pro:browser`               | PASS   | 37.12s  |
| `test:layers:browser`            | PASS   | 30.19s  |
| `test:repair:browser`            | PASS   | 24.26s  |
| `test:geometry:browser`          | PASS   | 20.68s  |
| `test:transform:browser`         | PASS   | 31.71s  |
| `test:color:browser`             | PASS   | 22.87s  |
| `test:r6:browser`                | PASS   | 61.27s  |
| `test:r6:layers:browser`         | PASS   | 99.04s  |
| `test:r8:foundation:browser`     | PASS   | 4.79s   |
| `test:r8:browser`                | PASS   | 46.10s  |
| `test:r8:styles:browser`         | PASS   | 25.70s  |
| `test:r8:processing:browser`     | PASS   | 1.83s   |
| `test:r8:gradient:browser`       | PASS   | 40.25s  |
| `test:r8:recovery:browser`       | PASS   | 11.78s  |
| `test:appearance:browser`        | PASS   | 24.44s  |
| `test:vector:browser`            | PASS   | 25.36s  |
| `test:compound:browser`          | PASS   | 37.77s  |
| `test:pathfinder:browser`        | PASS   | 45.04s  |
| `test:artboards:browser`         | PASS   | 28.41s  |
| `test:preview:browser`           | PASS   | 13.21s  |
| `test:vector-final:browser`      | PASS   | 62.44s  |
| `test:raster-refinement:browser` | PASS   | 48.73s  |
| `bench:raster:browser`           | PASS   | 19.03s  |
| `test:homepage:browser`          | PASS   | 45.63s  |
| `test:dialogue:ocr`              | PASS   | 6.91s   |
| `test:dialogue:browser`          | PASS   | 16.07s  |
| `test:dialogue:workflow`         | PASS   | 9.08s   |
| `test:dialogue:render`           | PASS   | 1.64s   |
| `test:dialogue:security`         | PASS   | 2.53s   |
| `test:chapter-import:browser`    | PASS   | 24.74s  |
| `test:r2:browser`                | PASS   | 65.18s  |
| `test:r2:gesture:browser`        | PASS   | 8.33s   |
| `test:r5:browser`                | PASS   | 47.92s  |
| `test:r7:browser`                | PASS   | 189.97s |
| `test:chapter-display:browser`   | PASS   | 38.99s  |
| `test:vector-hidden:browser`     | PASS   | 11.32s  |

The separate R8 real-worker benchmark and unchanged local `production-vector-check` with candidate SHA/`--raster --ai` also pass. This is local candidate acceptance, not live production deployment verification. Dev/built desktop/mobile smoke pass with clean consoles, visible content, no horizontal overflow or baseline divergence; required screenshots were visually inspected.

## R8 unit/pixel/browser coverage

- Nine real style families; spread/choke, gradient stroke, repeat/offset, relief direction/depth, alpha/order, enable/disable exact source, copy/paste/duplicate/remove/history and Quick Mask exclusion.
- Filter kernels/parameter validation, seeded noise, alpha-aware blur, order, filter-selection masks plus layer masks, R6 pre-stack source/no double filtering, native reopen, hidden layers and R5 transforms.
- Five gradient types,128 stops/midpoints, RGB/OKLab, opacity/smoothness/reverse, actual touch stop reordering and source-local endpoint gestures; Escape/pointer cancellation, R7 masks and exact history/export.
- Properties at1440/768/390/360/320: legacy access, no duplicate controls after upgrade, creation Cancel/no history, one-entry Apply, before/after and rapid parameter jobs.
- Native3/envelope9/store5, actual old-reader rejection/old-writer VersionError, autosave reload, blocked-write close/latest changed settings and390px fresh-context Chapter recovery. Complex style/filter masks/groups/clipping/R6/R7/R3/R5 metadata and source bytes survive. PNG/JPEG/WebP per-format decoded recovery comparisons use tolerance 0.
- Untrusted data: future/mismatched schema/types/keys, invalid numeric/curve/stop/mask records, huge dimensions/work, prototype keys and corrupt JSON reject before embedded image decoding. Presets and aggregate visible-work limits are tested.
- Boolean/compound regression: either filtered operand, enabled or disabled, rejects before losing a stack; all source geometry/settings stay exact. Existing unfiltered operations retain functionality.

## Diagnosed failures preserved

1. The first candidate `44c36b7` timed out waiting for legacy `Gradient type`. R8's launcher had replaced legacy controls. The implementation restores schema1/2 direct controls and keeps schema3 transactional. Original Appearance assertions and new transition checks pass.
2. At source `244a1d6`, the original OCR test failed because Vite first optimized Tesseract/idb-keyval during worker inference. Original main `02eb697` failed identically; logs are retained. The facade-only warmup was incomplete; an import-only runtime warmup can also return before a scheduled reload. Test-only eager startup pre-bundling removes the race. An empty-cache original-test run passed in 7.75s with zero reloads, and final full-matrix OCR passes again. Models, production OCR and test assertions are unchanged. Diagnostic wrong-root/aborted warmup experiments are retained separately and never counted as passes.
3. Inspection found actual filter metadata loss in Boolean/compound operations: one source stack became zero output records while the filtered operand disappeared. Two new tests fail before and pass after the fix; 38 focused geometry tests, final 1,007 tests and full browser matrix pass. The original failure evidence is committed.
4. Strict halo tests exposed the R6 coverage-preserving default differing from Smart blur requirements. The implementation uses an explicit shared premultiplied coverage mode and full preview invalidation; original R6 defaults/assertions remain unchanged. Initial new fixture/context/typing mistakes were corrected before counting results or measurements.

The recovered/resumed original-base matrix and nine-suite post-fix rerun were already green. PR20 then merged externally, so the entire final matrix was repeated against current main rather than representing stale CI/results as current-base validation. [Historical evidence](r8-evidence/recovery-validation-history.json).

## Performance, compatibility and limitations

[Worker measurements](r8-evidence/render-benchmark.json) cover512²/1024²/2000² filtered/masked/styled and4096² gradient-only. Exact native RGBA/source hashes and12-request→2-job coalescing pass. Actual timings/RSS and retained4MP/128M work limits are in the [implementation report](R8_IMPLEMENTATION_REPORT.md). No downscaling or device extrapolation is claimed.

Current main's PR20 legacy access/deactivation is included in all final regressions, including its new suite. PR21 remains unmerged/untested in combination and has three actual Git conflicts plus documented native/UI semantics requiring integration. See [parallel analysis](R8_PARALLEL_INTEGRATION.md). Physical Android/stylus, custom pattern asset import, independent filter-mask brush, larger tiled/GPU processing and ICC/16-bit editing are not claimed. No confirmed release blocker remains against the tested main; merging/deploying still requires explicit user authorization.
