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
