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
