# R10 roadmap

Continue the existing branch and Draft PR #23. Do not merge or deploy.

1. Finish Milestone A's full regression matrix and source/main geometry comparison.
2. Implement/test separate confirmed-save recovery checkpoints, accurate save
   status and safe asset reachability analysis. Commit Milestone B after validation.
3. Extend R8 Smart Filter masks and Pattern Overlay; improve the existing inspector.
   Prototype shaped Arabic/RTL path text before any text-engine replacement.
4. Share capability preflight, validate bounded tiled processing and exercise
   1080x1920/5000/10000/20000 pages with explicit supported/refused outcomes.
5. Complete mobile controls, navigation, row readability and error recovery.
6. Run full R8/R9/PR21/native/history/export/security regressions, actual benchmarks,
   GitHub checks on final HEAD and update these reports with remaining limitations.

Milestone status must distinguish implemented/verified, partial, deferred and
blocked. Preserving original data takes precedence over unproven cleanup or
shaping shortcuts. Existing Claude implementation commits remain unchanged.

## Continuation checkpoint

A is verified and published as `ad9809966fe79746a91cd4e17b2ad8c1aeb3be3c`
(both GitHub workflows green). B1/B2 and B3 conservative analysis are implemented
and validated. Asset deletion is deferred under the handoff's explicit
analysis-first fallback. Next: paintable filter masks and bitmap patterns, using
the existing R8 architecture. No release authorization is implied.

## C1 continuation checkpoint

C1 paintable filter masks are implemented and verified. Continue with C2 bitmap patterns, C3 inspector, C4 shaped-text prototype, then D/E/F. No merge or deploy authorization.

## C2 continuation checkpoint

C2 bitmap Pattern Overlay is implemented and verified. Continue C3 inspector, C4 shaped-text prototype/proposal, D/E/F. An isolated RTL diagnostic currently fails a curved-versus-straight advance assertion and has not changed production text behavior.

## C3 continuation checkpoint

C3 implemented and verified. C4 prototype and concrete shaping-service proposal are documented in R10_RTL_PATH_PROPOSAL.md; production support remains deferred, with strict diagnostic failures retained. Continue D/E/F.

## Milestone D continuation

D1/D3 verified within existing budgets. D2 local filter tiling implemented/verified; nonlocal filters and the document compositor retain full-plane paths. No4MP/16.8MP/16384px cap was raised. C4 production shaping remains deferred by the documented prototype/proposal fallback. Continue E narrow-row/touch cleanup and F full regressions, measurements and exact-HEAD CI.

## Milestone E continuation

E implemented and verified on emulated1440/768/390/360/320 layouts. Continue F final full matrix, benchmarks, security/config checks and exact-HEAD GitHub validation. C4 production shaping and complete tiled document compositing remain explicitly deferred; no release authorization.

## Audit Top 20 — R10 classification

Classes: **Implemented in R10** (shipped and tested), **Partial** (shipped subset; remainder
listed), **Prototype** (isolated, not exposed as a feature), **Design only**, **Deferred**.
Statuses are verified against source and the final test matrix, not commit titles.

| #   | Audit improvement                                        | R10 class                   | Evidence / what remains                                                                                                                                                                                            |
| --- | -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Strict backup schemas + invalid-record quarantine        | Implemented                 | INK-AUD-001 `c03de53`; records.test.ts, r10 audit browser suite.                                                                                                                                                   |
| 2   | Complete bounded PNG validation, cloud input and output  | Implemented                 | INK-AUD-002/003 `78c1afd`; png-guard + endpoint tests; probes in `npm test`.                                                                                                                                       |
| 3   | Focused pixel/native/recovery/mobile browser gate in CI  | Partial                     | `r10-browser.yml` runs masks, patterns, inspector and mobile suites on every PR. Recovery, audit, long-page and the full historical matrix still run locally (`test:r10:matrix`); scheduled full matrix is future. |
| 4   | Shared capability preflight + lossless split/copy        | Implemented (copy deferred) | Capability notice/budgets `7b31e54`; device-area preflight `ad98099`; lossless split action (this continuation). Compatible reduced working copies deferred: they reduce quality and need an explicit design.      |
| 5   | Halo-aware tiled filters/styles with bounded caches      | Partial                     | Local integer-neighbourhood Smart Filters tile with exact halos `7b31e54`; nonlocal filters, styles and the document compositor stay full-plane. Caps unchanged.                                                   |
| 6   | Compact durable-save/failure badge on phones             | Implemented                 | Save status `734391f`, mobile layout `96a68a9`; recovery and mobile suites.                                                                                                                                        |
| 7   | Versioned recovery checkpoints + backup health           | Implemented                 | Separate checkpoint DB, SHA-256, confirmation/undoable restore `734391f`. Cross-session Undo timeline remains out of scope (documented contract).                                                                  |
| 8   | Accurate image selection naming + options control        | Implemented                 | INK-AUD-006 `06096e5`, mobile follow-up `96a68a9`.                                                                                                                                                                 |
| 9   | Terminal editor load-error state                         | Implemented                 | INK-AUD-005 `559d72d` + device budget preflight `ad98099`.                                                                                                                                                         |
| 10  | Capability-derived SVG/format help                       | Implemented                 | INK-AUD-004 `fdf715a`.                                                                                                                                                                                             |
| 11  | Compact contextual inspector + searchable command access | Partial                     | Contextual Tool settings jump and keyboard panel navigation `a349c94`. Searchable command palette not implemented (design below).                                                                                  |
| 12  | Independently paintable Smart Filter masks               | Implemented                 | `b401381`, no-selection capture fix `9a0ed0a`.                                                                                                                                                                     |
| 13  | Portable custom bitmap Pattern Overlay                   | Implemented                 | `d718e7b`; style v3 records in the existing immutable asset pool; old readers reject safely.                                                                                                                       |
| 14  | Reachability-based immutable asset collection            | Design + verified analysis  | Shared traversal and root coverage `734391f`; deletion deferred until UI clone sources and worker jobs hold explicit leases.                                                                                       |
| 15  | Controlled browser performance/memory diagnostics        | Implemented (local)         | Repeated runs with p50/p95 in R10_PERFORMANCE_REPORT; JS heap samples only (no GPU/process peak); no physical device.                                                                                              |
| 16  | Provider concurrency/rate/cost controls                  | Design only                 | Below. Needs a durable server-side store and owner policy decisions.                                                                                                                                               |
| 17  | Extract workspace/canvas transaction controllers         | Design only                 | Below. High risk; no authorization for a large refactor in R10.                                                                                                                                                    |
| 18  | Portable licensed fonts + predictable Arabic/CJK metrics | Prototype + design          | C4 prototype/proposal `38725b5` (font assets, HarfBuzz shaping). Font licensing decision required.                                                                                                                 |
| 19  | Layered PSD/OpenRaster interchange                       | Deferred (design outline)   | Not authorized in R10. Outline below.                                                                                                                                                                              |
| 20  | ICC-aware, 16-bit/wide-gamut pipeline                    | Deferred (design outline)   | Not authorized in R10. Outline below.                                                                                                                                                                              |

### Additional items evaluated (R10 brief §10)

| Item                               | Class       | Note                                                                                        |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Provider usage and cost protection | Design only | Part of #16.                                                                                |
| Canvas transaction architecture    | Design only | Part of #17.                                                                                |
| Arabic/RTL text on path (C4)       | Prototype   | Production refusal kept; R10_RTL_PATH_PROPOSAL.md lists adoption gates and failing metrics. |
| Arabic/CJK export consistency      | Prototype   | Depends on #18 font assets.                                                                 |

## High-risk designs

Each follows: current architecture · proposed design · compatibility risks · migration ·
test strategy · performance · complexity.

### #16 Provider concurrency, rate and cost controls

1. **Current.** `/api/studio/ai-edit` requires configuration, same-origin and a constant-time
   owner code; bounds upload bytes, PNG structure (R10) and a 110 s timeout. No per-principal
   rate, concurrency or spend accounting; the Vercel function is stateless.
2. **Design.** A small server-side limiter keyed by a hash of the access code: concurrent
   requests ≤ 1–2, requests/hour and requests/day ceilings, and an owner-set daily estimated-cost
   cap (requests × configured unit price). State in a durable KV (e.g. Vercel KV/Upstash) with
   atomic increments; fail closed (429) when the store is unavailable. Owner-visible health:
   remaining budget in the 429/200 response headers and an owner status endpoint.
3. **Compatibility.** Client already surfaces 429 as "quota or rate limit"; no document change.
4. **Migration.** New environment variables for limits and KV credentials; none for user data.
5. **Tests.** Fake KV with deterministic clock: concurrency, window rollover, cap, store outage
   (fail closed), no provider call when limited; existing endpoint tests unchanged.
6. **Performance.** One KV round-trip per request (~ms) against multi-second inference.
7. **Complexity.** S–M; needs the owner's choice of store and limits.

### #17 Workspace/canvas transaction controllers

1. **Current.** `pro-workspace.tsx` (~4.4k lines) owns session, history, autosave, checkpoints,
   tools and panels; `pro-canvas.tsx` owns gesture transactions. Revision checks and immutable
   assets protect data, but coupling makes conflict isolation and testing hard.
2. **Design.** Extract pure controllers without changing the renderer: `SessionController`
   (load/validate/install/persist/checkpoint, already partly in storage/recovery modules),
   `HistoryController` (commit/undo/redo, asset roots), and a `CanvasTransaction` object that
   every gesture/tool uses (begin → preview → commit/cancel) with a single active-transaction
   lock. Components subscribe via hooks.
3. **Compatibility.** Behaviour-preserving; native schema unchanged.
4. **Migration.** None for data. Code moved in reviewable steps, one controller per PR.
5. **Tests.** Existing 47 browser suites as the oracle; new controller unit tests for
   transaction ordering, cancellation and autosave races.
6. **Performance.** Neutral to positive (fewer whole-document re-renders/serializations).
7. **Complexity.** L (3–6 weeks); high regression risk; needs explicit authorization.

### #11 Searchable command access (remaining part)

1. **Current.** Tools in the toolbar; panels via tabs with keyboard navigation (R10 C3).
2. **Design.** A command palette (existing `cmdk` dependency) listing tools, panels and
   document actions from the existing tool table and tab list; no new actions.
   3–7. No data impact; test keyboard/touch at five widths; negligible cost; S.

### #19 Layered PSD/OpenRaster interchange (outline)

OpenRaster first (ZIP + PNG layers + stack.xml, open format): export raster/paint layers with
opacity, visibility, blend modes that map exactly; flatten-with-warning styles, Smart Filters and
vectors; import as new raster layers only. Strict size/entry limits reuse the backup ZIP budget.
PSD import/export needs a maintained library and licence review. Versioned capability contract;
never replaces native `.inkstrip`. Complexity L.

### #20 ICC-aware, 16-bit / wide-gamut (outline)

Current: 8-bit sRGB canvas pipeline; gradients interpolate in RGB/OKLab with explicit gamut
clipping. Design: a working-space contract (sRGB / Display P3) stored per document, ICC
profile retention on import, 16-bit storage for paint/adjustment planes behind a document
version fence; renderer conversions only at boundaries. Requires new native version, migration
(none forced; old documents stay 8-bit sRGB), reference renders for every blend/filter, and a
memory model (16-bit doubles planes). Complexity XL; deferred.
