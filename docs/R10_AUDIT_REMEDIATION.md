# R10 audit remediation

Claude Code implemented these fixes; Codex recovered and reviewed their source
and tests without recreating them.

| Defect           | Commit                                     | Verified implementation                                                                                                                                                            |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INK-AUD-001      | `c03de5351d23cdc47fc309ae0db3f822183d551f` | Bounded Project/Chapter/Page schemas at backup decode and storage writes; malformed stored records are set aside without deletion; production legacy metadata fixture retained     |
| INK-AUD-002/003  | `78c1afd9d40958b97e3b26669d96fdace0feed32` | CRC/chunk/scanline/decode validation; bounded PNG inflate; image/mask/reference validation before provider invocation; invalid outputs return controlled errors without image data |
| INK-AUD-004      | `fdf715a19e589661e3e0c7d010533a1a6d35d4dc` | `svg-capabilities.ts` supplies the importer allow-list and UI help; tests tie supported claims to allowed elements                                                                 |
| INK-AUD-005      | `559d72d962b833b618155dc7a7273e38525f39de` | Explicit loading/ready/failed states, accurate error and device budget, Return/Try Again, no stale unsaved/opening labels                                                          |
| INK-AUD-006      | `06096e543ad56a4cfce5545ee4c5f26afc51c6c2` | Image-selection toggle and explicit options button; keyboard/context-menu/long-press retained; CSS selectors scoped                                                                |
| Browser coverage | `b71d7b5e023472940508ea2a4344ea2218d03a75` | Audit UI suite at 1440/390/320; existing Editor/Chapter/Vector-hidden interactions updated to the correct target                                                                   |

The PNG tests use a local provider stub: no paid API calls. Invalid input makes
zero provider calls. Existing fixture edits replace truncated PNGs and incomplete
record casts with valid inputs, preserving the tests' intended validation paths.
The Chapter security suite now separately checks out-of-range metadata and
in-range image-header mismatches, asserting zero decodes in both cases.

Fresh audit browser checks passed at all three widths with no console/page errors.
The original full matrix passed all 49 local commands; the separate local release verifier also passed. Image-row geometry is identical to unchanged main at all three widths (zero tolerance).
Source limits: `dialogueBudget()` selects 16,777,216 pixels on supported desktop
devices and 4,000,000 on coarse-pointer or <=4GB devices. Raster additionally
enforces 16,384 pixels per side. These values are read from existing policy.

## Audit-finding verification matrix

Re-verified on the final R10 source (application code of `9a0ed0a`, tested as `a320325`/`bb0bf35`).
"Reproduction" is the audit's own procedure; each regression test failed against the
unfixed code before it passed.

| Bug ID      | Severity | Reproduction (audit)                                                                                                                    | Root cause                                                                                                                                                     | Fix                                                                                                                                                                   | Regression tests                                                                                                                                                                                         | Status          |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| INK-AUD-001 | High     | `audit/probe.mjs`: backup with project title `42`, `{}` or `null`; chapter width `-1`, seam `-1000000`, format `application/javascript` | `decodeBackup` validated IDs/associations/blobs but not record shapes; Library called `title.toLowerCase()`                                                    | Strict bounded Project/Chapter/Page schemas at decode and write; malformed stored records set aside in memory (never deleted) with a banner                           | `records.test.ts` (title/settings/unknown-field probes, production 5f9c537 metadata, quarantine); `test:r10:audit:browser` (stored bad record + real Restore control); `test:audit:probes` in `npm test` | Fixed, verified |
| INK-AUD-002 | Medium   | 24-byte PNG signature + 16×16 header as image and mask, local stub provider                                                             | Input guard read only MIME, size, 8 signature bytes and IHDR width/height                                                                                      | Full bounded PNG validation (CRC chunk walk, IHDR/PLTE/IDAT/IEND rules, bounded inflate, fast-png decode); mask must match image size; all before any provider call   | `image-edit.test.ts` (truncated, CRC, missing IEND, trailing bytes, oversize, mismatched mask, reference); `test:audit:probes` → 400, 0 provider calls                                                   | Fixed, verified |
| INK-AUD-003 | Medium   | Stub provider returns base64 of `89 50 4e 47`                                                                                           | Output check read base64 length and 4 bytes                                                                                                                    | Strict base64, bounded size, full PNG validation, exact requested 1024×1024; else 502 "artwork unchanged"                                                             | `image-edit.test.ts` (four-byte, bad/whitespace base64, truncated, wrong/excessive size, non-string); `test:audit:probes` → 502                                                                          | Fixed, verified |
| INK-AUD-004 | Low      | Assets help says gradients/clips/masks are rejected; audit `gradient.svg` imports                                                       | Help text predated the Phase D importer                                                                                                                        | Importer allow-list and help rendered from one module (`svg-capabilities.ts`)                                                                                         | `svg-capabilities.test.ts`; `test:r10:audit:browser` (help text, gradient/clip import, script SVG rejected)                                                                                              | Fixed, verified |
| INK-AUD-005 | Low      | Open a 1080×20000 page in Raster; stale "Opening…"/"Unsaved draft"                                                                      | Initial-load catch set an error but no state; status stayed "Opening"; touch-budget documents could also install before the worker refused them (found in R10) | Explicit loading/ready/failed states; failure panel with real error, device limits, Return/Try again, split hint; opening preflight before history/autosave           | `test:r10:audit:browser`, `test:r10:opening:browser` (five widths, before/after evidence), `opening.test.ts`, `test:r10:split:browser` (hint)                                                            | Fixed, verified |
| INK-AUD-006 | Low      | Click "Image options for X" toggles selection                                                                                           | `aria-label` described options while `onClick` toggled selection                                                                                               | Target named "Select image X" with `aria-pressed`; separate "Image options for X" button (`aria-haspopup`, `aria-expanded`); context menu, Shift+F10, long press kept | `test:r10:audit:browser` (mouse, Enter, Space, Shift+F10, context menu, touch long press), `test:r10:mobile:browser`, updated Editor/Vector-hidden locators                                              | Fixed, verified |

Screen-reader and physical-device execution were not performed (emulated Chromium only).

## Additional device-area failure path

Confirmed pre-existing on unchanged R9 main and recovered R10 HEAD. Evidence:
[a-mobile-load-before.json](r10-evidence/a-mobile-load-before.json),
[a-mobile-load-main.json](r10-evidence/a-mobile-load-main.json), and the new browser
regression's [pre-fix failure](r10-evidence/open-limits-before-fix.log).
The opening preflight now refuses device-oversized native documents before
installing ready/history/autosave, preserving any existing draft rather than
allowing a false ready/saved state. Three unit cases cover exact limits, hidden
sources and canvas/crop/output. Five-width browser checks cover fresh and retained
drafts, retries and returning to valid artwork; no original assertion was weakened.

Post-fix production-build opening and unchanged audit suites pass, as do R8 native/fresh-context recovery at zero pixel tolerance and R9 integration. Milestone A is verified; the final phase-wide matrix will run again after later milestone changes.

## Final-review capture correction

Additional Codex regression R10-CAP-001: C1 framed the no-selection fallback in document bounds, while the original affine capture semantics covered the whole source. A translated off-canvas layer could later expose filtered pixels that the mask had hidden. The focused full-source fallback restores intended behavior; explicit selections retain R5 framing. Source assets, native versions and committed audit fixes are unchanged. Before/after browser and unit evidence are retained.
