# R11 test report

Every result below was produced in this session. "Blocked" and "not run" are
stated as such; no mocked AI result is reported as real.

## A. R10 verification gaps (closed)

GitHub-hosted runners, workflow `.github/workflows/r11-external.yml`.

| Check                                                                                                                                                                   | Where               | Result                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live release marker = current main                                                                                                                                      | runner → production | PASS: `aa7e1994…` at 1440/320/390 (run [41045880260](https://github.com/barbonselvar/inkstrip-manhwa-studio/actions/runs/41045880260), job 124029721346) |
| Live Chapter, Pathfinder, gradient, text on path, SVG, native reopen, Raster refinement, 4096² masked export, 0 failed assets, 0 console errors                         | runner → production | PASS                                                                                                                                                     |
| Live real Swin2SR inference                                                                                                                                             | runner → production | PASS: 16×24 → 32×48                                                                                                                                      |
| `test:studio:browser` on the built app (real model download, inference, compare, apply/reload, byte-exact original recovery, cancel, batch + recovery, mobile overflow) | runner, built app   | PASS on main's code (job 124029721573) and on R11 `dd54c89`/`ed1dfdd`/`7d39231` (jobs 124046482544, 124047886154, 124091014253)                          |
| Same live checks again during R11                                                                                                                                       | runner → production | PASS (jobs 124046482149, 124047886760, 124091014596)                                                                                                     |

Deterministic (mocked) coverage, which passes and is reported only as such:
route protection, generic provider errors without leaked responses, malformed or
mismatched PNG input (zero provider calls), invalid provider output, PNG
decompression bombs (`image-edit.test.ts`) and bounded upscale memory
(`enhance.test.ts`). Cancellation and original recovery are covered by the real
suite above. **Not separately tested:** provider quota/429 handling, worker memory
release after inference and model-download failure recovery (no deterministic test
exists; not added because R11 does not touch AI code). **R11 changes no AI code**,
and the real-model suite passed on the R11 build itself, so no AI release
exception is needed.

The development sandbox could not reach `inkstrip-manhwa-studio.vercel.app`,
`huggingface.co` or `grok.com` (proxy `connect_rejected`). Local browser suites
therefore run with `scripts/qa-offline-branding.mjs`, which fulfils only
`https://grok.com/*` (the platform branding pill) with an empty script.

## B. Static gates

| Gate                        | Unchanged main `aa7e199`                   | R11 `ed1dfdd`                                                        |
| --------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| Typecheck                   | PASS                                       | PASS                                                                 |
| ESLint                      | PASS                                       | PASS                                                                 |
| Prettier (files changed)    | —                                          | PASS                                                                 |
| Unit tests (`npm test`)     | 1,078 (200 + 59 + 121 + 698)               | **1,087** (200 + 59 + 121 + 707): +5 compaction, +4 commands; 0 fail |
| Audit probes                | PASS                                       | PASS                                                                 |
| Production build            | PASS                                       | PASS                                                                 |
| `check:build`               | PASS                                       | PASS                                                                 |
| `check:auth`                | needs dev server                           | PASS ("dev and build agree: sign-in off")                            |
| GitHub `validate` / `build` | PASS (main runs 40968013787 / 40968013719) | PASS on every pushed R11 HEAD                                        |

## C. R11 feature tests

### Open-time asset compaction

Unit (`asset-compaction.test.ts`, 5 tests): 63 orphans block the 64th asset and
compaction frees the pool; 46MB of orphans block a 3MB sample under the 48MB cap;
63 native import cycles reach the cap and reopening clears it with source bytes
intact; compaction keeps exactly `documentAssetIds` (hidden raster, Clone Stamp on
layer and mask, bitmap pattern, retained original), the **same Blob objects**, does
not mutate the loaded session, and the native file is **byte-identical** before and
after; missing references still fail validation.

Browser (`test:r11:browser`, real UI, 1440 px):

| Step                                | R10 main build                                         | R11 build                 |
| ----------------------------------- | ------------------------------------------------------ | ------------------------- |
| 63 Clone Stamp samples stored       | 64 assets                                              | 64 assets                 |
| 64th sample                         | refused ("at most 64 raster assets")                   | refused (same)            |
| Reload and reopen: artwork          | pixel-identical                                        | pixel-identical           |
| Opening writes storage              | no                                                     | no                        |
| Sample again after reopen           | **refused again** (`Stored assets 64 never reached 2`) | stored; pool = 2          |
| Paint with the sample, save, reopen | not reached                                            | pixel-identical; 2 assets |

Main log: [r11-browser-on-main.log](r11-evidence/r11-browser-on-main.log).

### Command palette

Unit (`commands.test.ts`, 4 tests): tab list identical to R10's rules for
Raster, Vector and Dialogue; ranking/prefix rules; disabled entries listed;
case-, accent- and punctuation-insensitive search including Arabic labels.

Browser (`test:r11:browser`) at 1440 (keyboard: Ctrl+K, arrows, Enter, Escape)
and 768/390/360/320 (real touch taps): search field focused; palette on top of
the Studio (`elementFromPoint`); a forced activation of disabled Undo does
nothing; "eras" + Enter selects Eraser exactly like the rail; Layers panel opens;
rows ≥ 44 px and inside the viewport; Escape closes only the palette; no
horizontal overflow; composite hash unchanged; History equals the rail's
(`Imported accepted image`, `Add paint`). Desktop, 390 and 320 screenshots were
inspected.

Defects found by these tests before commit: palette rendered **behind** the
Studio (z-index), and focus went to the Close button. Both fixed; the occlusion
assertion now guards the first.

## D. Native document compatibility

`test:r11:native-compat` uses each release's **own code** from its merge commit
to write a document with every feature that release accepts, then checks it with
R11. Also runs in the PR browser workflow (full history checkout).

| Release (writer) | Commit    | Envelope | Features written                                                         | R11 open, layers/masks/filters/styles/asset bytes | Compaction | Stable re-export | Same bytes as R10 writer | Undo/Redo | Original release reads R11 output |
| ---------------- | --------- | -------: | ------------------------------------------------------------------------ | ------------------------------------------------- | ---------- | ---------------- | ------------------------ | --------- | --------------------------------- |
| R6 (pre-R8)      | `6478fc1` |        8 | paint, hidden raster, layer mask + stroke, Clone Stamp, adjustment layer | PASS                                              | no-op      | PASS             | PASS                     | PASS      | yes                               |
| R7 (pre-R8)      | `02eb697` |        8 | same as R6                                                               | PASS                                              | no-op      | PASS             | PASS                     | PASS      | yes                               |
| R8               | `5f9c537` |        9 | + Smart Filter with mask, advanced gradient, advanced style              | PASS                                              | no-op      | PASS             | PASS                     | PASS      | yes                               |
| PR #21           | `db78593` |        9 | same as R8                                                               | PASS                                              | no-op      | PASS             | PASS                     | PASS      | yes                               |
| R9               | `401e925` |        9 | same as R8                                                               | PASS                                              | no-op      | PASS             | PASS                     | PASS      | yes                               |
| R10              | `aa7e199` |        9 | + bitmap Pattern Overlay (v3)                                            | PASS                                              | no-op      | PASS             | PASS                     | PASS      | yes                               |

Features a release rejected (e.g. schema-3 records before R8, bitmap patterns
before R10) were not written, as expected. Raw:
[native-compat.json](r11-evidence/native-compat.json). Pixel-level
native/reopen/export equality is covered by the browser matrix (§E: R8 recovery,
R9 integration, PR21×R8, recovery, long-page, production check).
No migration was added: R11 writes exactly the bytes R10 writes.

## E. Browser regression matrix

`scripts/r10-regression-matrix.mjs` (unchanged runner, original assertions and
timeouts) at **`ed1dfdd`**: suites importing `/src` on the QA dev server, all others
on the production build serving release marker `ed1dfdd…`, with the
offline-branding preload. Raw: [matrix-results.json](r11-evidence/matrix-results.json).

**Result: 56 / 60 passed in the run.** The four failures were investigated:

| Suite                            | In the run                                   | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench:raster:browser`           | failed: `grok.com` load refused              | Test tooling: this suite launches via `launchServer` + `connect`, which the first preload version did not wrap. Preload extended; **re-run alone passes** (errors `[]`).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `test:studio:browser`            | "Failed to fetch" (`huggingface.co` refused) | Sandbox egress, identical to R10. **Passes on GitHub runners against the R11 build** (§A).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `test:production:browser … --ai` | AI step "Failed to fetch" (`huggingface.co`) | Same. The non-AI production suite passed in the matrix; live production with real AI passes on GitHub runners (§A).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `test:r3:browser`                | timeout at `r3-brush-browser-check.mjs:468`  | Intermittent, pre-existing; **not attributable to R11**. Same step R10 recorded once and could not reproduce. Re-run alone (the matrix's exclusive slot, same dev-server setup): **R11 `ed1dfdd` 3/3 pass** (438–442 s) and **unchanged main `aa7e199` 3/3 pass** (440–445 s). The failing run's dev server logged one `styles.css` hot update ~40 s in (a doc edit re-triggered Tailwind's scan); a deliberate hot update at 40 s in a fourth R11 run still **passed**, so that lead is not confirmed. Root cause unconfirmed; no assertion or timeout changed. Recorded, not reclassified. |

Re-run evidence: `bench:raster:browser` re-run alone passed (errors `[]`); R3 A/B
logs are summarised above.

Passed (56): `test:adjustments:browser`, `test:appearance:browser`, `test:artboards:browser`, `test:chapter-display:browser`, `test:chapter-import:browser`, `test:color:browser`, `test:compound:browser`, `test:dialogue:browser`, `test:dialogue:ocr`, `test:dialogue:render`, `test:dialogue:security`, `test:dialogue:workflow`, `test:editor:browser`, `test:geometry:browser`, `test:homepage:browser`, `test:layers:browser`, `test:pathfinder:browser`, `test:pr21-r8:browser`, `test:preview:browser`, `test:pro:browser`, `test:production:browser`, `test:r10:audit:browser`, `test:r10:inspector:browser`, `test:r10:long-pages:browser`, `test:r10:masks:browser`, `test:r10:mobile:browser`, `test:r10:opening:browser`, `test:r10:patterns:browser`, `test:r10:recovery:browser`, `test:r10:split:browser`, `test:r11:browser`, `test:r2:browser`, `test:r2:gesture:browser`, `test:r5:browser`, `test:r6:browser`, `test:r6:layers:browser`, `test:r7:browser`, `test:r8:browser`, `test:r8:foundation:browser`, `test:r8:gradient:browser`, `test:r8:processing:browser`, `test:r8:recovery:browser`, `test:r8:styles:browser`, `test:r9:browser`, `test:r9:integration:browser`, `test:r9:svg:browser`, `test:raster-advanced:browser`, `test:raster-refinement:browser`, `test:repair:browser`, `test:retouch:browser`, `test:transform:browser`, `test:ui:browser`, `test:vector-final:browser`, `test:vector-hidden:browser`, `test:vector:browser`, `test:workflow:browser`.

Coverage of the brief's regression list: Raster editing (`pro`, `raster-refinement`,
`raster-advanced`, `r2`), Chapter Workspace (`chapter-display`, `chapter-import`,
`workflow`), brush stress (`r3`, see above), Layer Styles (`r8:styles`), Smart
Filters (`r8:processing`, `r8:browser`), Smart Filter masks (`r10:masks`), Pattern
Overlay (`r10:patterns`), Pathfinder (`pathfinder`), paths (`r9`), SVG (`r9:svg`),
gradients (`r8:gradient`), text and lettering (`dialogue:*`, `r9`), guides
(`r9`, `r9:integration`), native save/reopen (`r8:recovery`, `r10:recovery`,
`production`), recovery (`r10:recovery`), image splitting (`r10:split`), long pages
(`r10:long-pages`), mobile (`r10:mobile`, `r2:gesture`, `r11` at five widths), AI
(GitHub runners, §A), R11 features (`r11`).

## E2. GitHub Actions on R11 heads

| HEAD      | validate | build | continuity (R10 suites + `test:r11:browser` + native compat) | live production + real AI | built Studio + real AI | Vercel Preview status                            |
| --------- | -------- | ----- | ------------------------------------------------------------ | ------------------------- | ---------------------- | ------------------------------------------------ |
| `dd54c89` | pass     | pass  | cancelled (superseded by the `ed1dfdd` push)                 | pass                      | pass                   | not checked                                      |
| `ed1dfdd` | pass     | pass  | pass                                                         | pass                      | pass                   | not checked                                      |
| `3dd952a` | pass     | pass  | **fail**: palette occlusion first-frame race (test fixed)    | pass                      | pass                   | not checked                                      |
| `7d39231` | pass     | pass  | pass                                                         | pass                      | pass                   | Ready (Vercel status "Deployment has completed") |

The release candidate adds only documentation and evidence files on top of
`7d39231`; its own checks are recorded on PR #24 and in the final release report.

## F. Security

| Area                                       | Evidence                                                                                               | Result |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------ |
| PNG validation, provider output validation | `png-guard` and `image-edit` unit tests; audit probes                                                  | PASS   |
| SVG sanitisation                           | `image-policy`, `svg-capabilities`, `r8-security` unit tests; R9 SVG browser suite                     | PASS   |
| Native document validation                 | `files`, `r8-security`, `pattern-overlay`, compat test (old readers reject what they cannot represent) | PASS   |
| Backup restoration / record quarantine     | `backup`, `records` unit tests; recovery browser suites                                                | PASS   |
| Resource limits                            | Unchanged; long-page refusals and capability tests pass                                                | PASS   |
| Compaction safety                          | No open-time write; byte-identical native files; missing references fail closed                        | PASS   |
| New secrets                                | Diff scanned for keys/tokens: none. No environment or secret change                                    | PASS   |
| Dependencies                               | `package-lock.json` identical to main; no dependency added                                             | PASS   |

`npm audit --omit=dev` reports **pre-existing** advisories, identical on main:
`better-auth` 1.6.x (GHSA-965c-763c-88jm critical, GHSA-r4xp-prcw-77qf and
GHSA-q84f-53jg-9ppm high, adapter low) and `seroval` 1.6.9 via TanStack Router/Start
(two moderate). The better-auth issues concern magic link, OAuth proxy and device
login: this app mounts no auth route (`src/routes/api` has only `studio`),
configures none of those plugins and runs with sign-in off, so they are not
reachable. They are **not introduced or changed by R11**; updating better-auth
(fix 1.7.14) and TanStack (seroval ≥ 1.6.11) belongs in a separate dependency PR.

## G. Mobile

Emulated 1440/768/390/360/320 with real touch events for R11 features; the R10
mobile/inspector/masks/patterns suites (five widths) pass in CI on every R11 HEAD
and in the local matrix. No physical device was available; results are browser
emulation.
