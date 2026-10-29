# R10 implementation report

Development only. Draft PR [#23](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/23).
No merge or production deployment is authorized for this continuation.

## Recovered checkpoint

Codex recovered Claude Code's existing branch `codex/r10-stability-professional-raster`
at `b71d7b5e023472940508ea2a4344ea2218d03a75`. Main is the R9 merge
`401e9251775dcf4eb64f4447488f65f4e9ae2536`. All six audit fixes were published;
no R10 uncommitted work or completed browser-matrix evidence was available in this
workspace. The six commits are retained unchanged. No competing R10 branch or PR
was created. No Milestone B implementation or R10 reports were present remotely.
The persistence design in the user's handoff is being continued after source inspection.

## Milestones

| Milestone                                       | Status (verified on the final source; see R10_TEST_REPORT.md)                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: six audit defects                            | Implemented and verified (`c03de53`…`b71d7b5`, device-area preflight `ad98099`)                                                                                   |
| B: checkpoints, save status, asset reachability | B1/B2 implemented and verified (`734391f`); B3 reachability analysis verified, asset deletion deferred                                                            |
| C: professional Raster improvements             | C1 (`b401381`, fix `9a0ed0a`), C2 (`d718e7b`), C3 (`a349c94`) implemented and verified; C4 prototype and proposal only (`38725b5`), production refusal kept       |
| D: long-page capabilities and tiled processing  | D1 capability notice (`7b31e54`) and lossless split (`06f73e2`); D2 local Smart Filter tiling (partial: compositor full-plane); D3 long-page tests; no cap raised |
| E: mobile improvements                          | Implemented and verified on emulated widths (`96a68a9`)                                                                                                           |
| F: regression, security and performance         | Full matrix 55/58 + 2 reruns passing, 2 AI steps blocked by huggingface.co (identical on main); CI browser workflow (`f4b0f91`); p50/p95 measurements             |

See the architecture, audit remediation, test, performance and roadmap reports
beside this file. Statuses will be updated with actual execution results.

## Codex continuation: completing INK-AUD-005

A focused coarse-device probe found a missing case on both R9 main and Claude's
R10 HEAD: a 1080x5000 image passes Chapter import and global native validation, but
exceeds Raster's 4MP device budget. The workspace installed history and entered
ready before worker initialization refused it; autosave could then persist that
unrenderable draft. The new failure panel therefore did not handle this case.

`validateOpeningSession` reuses native validation and the renderer's resource
preflight, checking canvas/crop/output and retained source budgets before history
and autosave are installed. Both accepted-image opening and existing-draft
recovery use it. No limit, native schema or rendering algorithm changed.

The new five-width browser regression fails on the unchanged build and passes
on the fixed dev build. It verifies retry, absence of a partially opened draft,
byte-exact retention of an existing legacy draft and subsequent valid-image opening.
Claude's original audit assertions remain unchanged and pass.

## Milestone B continuation

- Confirmed primary-save snapshots use separate `inkstrip-pro-recovery` v1
  storage. Native schema3/envelope9 and Pro storage v5 remain unchanged.
- Self-contained native checkpoints preserve editable layers, masks, clipping,
  R6 settings and R8 definitions, with stable IDs and original image bytes. SHA-256
  covers native content and canonical identity/revision/timestamp metadata.
- Atomic header/Blob writes retain up to three versions per page within 144MB/64
  entries. Existing index metadata is verified before pruning; a concurrent index
  change aborts the new write. Late older workers cannot evict the latest page
  revisions by virtue of finishing later.
- Serialization, hashing and checkpoint I/O run in an independent worker. A bounded
  queue retains one active job and the latest request per page (up to eight queued
  pages). Primary durability does not depend on successful checkpoint storage.
- Recovery in History requires explicit confirmation, verifies the selected
  checkpoint and image budgets, and records one undoable native import. Active
  operations cannot redirect it. Prior source assets remain available for Undo.
- Save status distinguishes saving, unsaved, saved, failed and unavailable storage.
  Save and recovery actions are accessible at all five tested widths. Rendering
  progress stays separate in the footer. Mobile header controls have explicit
  grid positions and a zero-overlap browser assertion. Retry enters Loading
  atomically with its request.
- Native export and reachability analysis share the same asset traversal. Undo,
  Redo, pending/rendering/checkpoint roots have regression coverage. **No asset
  deletion is implemented:** UI clone sources and worker lifetimes need explicit
  leases before complete reachability can be proven.

If the primary draft itself is unreadable, recovery offers an integrity-verified
native download for import into a separate document. The damaged primary is
retained. Checkpoints share browser storage/eviction risk; portable backups remain
necessary. A failed checkpoint never turns an acknowledged primary save into a
false failure or silently overwrites another revision.

## Milestone C1: paintable Smart Filter masks

The existing R8 transactional properties editor now includes an independent mask
canvas with R3 brush size, hardness and opacity, reveal/hide painting, R7 selection
clipping, local Undo/Redo, Reset, Finish and exact Cancel. Parent Apply and section
changes are disabled while a mask edit is active. Finished settings commit once
through the existing document history. The real composite updates after each
stroke; the grayscale mask updates while dragging. Existing enable, inversion and
density controls remain available after Finish.

Masks persist as existing native row-RLE selection coverage: no schema/DB bump
and no raster replacement. Painting is bounded to native 4MP source planes, 50
local strokes and 64M estimated brush/selection work; overflow retains the previous
valid draft and offers Undo/Cancel. The UI canvas alone is reduced to at most512px.
A translated-layer regression exposed the old selection-capture omission of the
layer transform; capture now uses the existing source-local selection mapping.

Dev and production-bundle five-width tests pass (1440/768/390/360/320), including
real touch events, soft opacity, clipping, exact Cancel, Undo/Redo, one document
history entry, unchanged source assets, native reopen, autosave reload and
zero-tolerance preview/PNG equivalence. The unchanged five-width R8 UI suite also
passes. Full unit tests:1055; typecheck, lint and production build pass. Physical
Android has not been tested. C2–C4 and D–F remain unfinished.

## Milestone C2: custom bitmap Pattern Overlay

PNG/JPEG/WebP bitmap patterns now use immutable document assets, with a version3
Pattern Overlay record (asset ID, width/height, scale and offsets). The document
remains schema3, envelope9, Pro DB5, recovery DB1. Procedural style version2
records and all existing rendering paths remain supported. The actual R9 main
native reader rejects bitmap style version3, accepts procedural version2, and
cannot silently flatten this extension.

Imports preflight complete headers before decoding, capped at512px per side,
2MB and one frame. Source bytes are preserved. Rotated JPEG axes are refused with
a PNG-normalization explanation. Missing/mismatched/unsafe references fail closed;
serialized dimension mismatches are rejected before decoding. Existing64-asset,
48MB pool and4MP style/render-work limits remain enforced.

Repeat sampling uses premultiplied bilinear interpolation across seams. Alpha,
blend and style opacity remain in the existing compositor. Draft assets are
isolated until Apply, Cancel leaks no assets, and asynchronous imports are aborted
when the editor closes. Preview workers are reinitialized for each staged pool
and stale replies cannot become the committed preview. Native export, remapping,
recovery and reachability traversal include pattern references. Undo retains the
original artwork and pattern assets. Global presets/clipboard refuse document-
owned bitmap references; duplicate the layer or save the native document instead.

Tests:1059 unit tests, typecheck, lint, production build; five-width dev and
production pattern suites and unchanged five-width R8 UI all pass. PNG preview
comparison remains tolerance0. Desktop/mobile screenshots were inspected.

## C3 continuation checkpoint

C3 adds keyboard ArrowLeft/Right/Home/End panel navigation and a contextual Tool settings jump into the existing inspector. Brush and text groups can be opened/focused without duplicate controls. Missing contextual sections fall back to panel top. Source artwork is unchanged by navigation. Five-width dev/built browser checks pass, including hidden-panel reopening, closed brush disclosure, focus,44px tab targets and no horizontal overflow. Existing R9×R8 desktop/mobile integration passes. Typecheck, lint, build and all workspace1071 unit tests pass (1061 committed tests plus10 pending tile tests).

## Milestone D continuation

D1 shares unchanged Raster limits among model/geometry/opening/decoder/Dialogue budget and capability UI. Chapter import, Raster/edit-export, Smart Filter and on-device AI limits remain independent and visible before import in Chapter and Assets. D2 runs local integer-neighborhood Smart Filters in halo tiles using the existing algorithms: Gaussian/Unsharp/High Pass, Median, Surface and edges. Native4MP and128M aggregate tap caps remain. Halo overhead is charged; jobs fall back to the original whole-plane path if it would exceed the same cap. Radial, seeded noise, Motion and Emboss retain their exact original whole-plane processors. Worker cancellation checks/yields occur between tiles; exports show percentage progress. D3 verifies actual1080×1920/5000/10000/20000 imports at desktop1440 and touch390. Raster supports through10000 on desktop,1920 on touch; larger cases are refused without changing accepted source dimensions. Zoom, Hand pan, brush, native autosave/reopen and full-resolution PNG hashes are exact. Spatial filters above4MP are refused. This is bounded filter tiling, not a full tiled document compositor; native source/output canvases still require full planes, so no cap is raised.

## Milestone E continuation

E gives360/320px rows a full-width thumbnail/name row with a two-line filename, preserving the existing selection target and all option/reorder controls. Coarse-pointer rows use the existing44px grid even at768px, where selection/options/delete were previously32px. Fine-pointer desktop row layout remains unchanged. Filename titles/accessible selection labels retain the full text; scroll margins protect keyboard/touch access near fixed footer controls. Five-width dev/built tests pass, including real touch selection, hit-target checks, Shift+F10, options, visible Save/Recovery and no overflow. The unchanged audit browser suite passes. This is emulated touch coverage, not physical Android.

## Final-review capture correction

Final review found and fixed a C1 regression: no active selection had been converted to a document-framed white mask, clipping source pixels temporarily outside the canvas. captureFilterMask now returns unframed full-source coverage for no selection and uses existing R7 source-local framing only for explicit selections. A before-fix built-browser regression fails on f4b0f91; five-width dev and built checks now pass with native metadata, moving the layer back into view and pixel-exact export. Enable/invert UI checks are also explicit.1075 unit tests, type/lint/build pass. The initial final-matrix run was intentionally stopped and preserved; its incomplete R3 stress run is not counted. A full matrix will rerun on the corrected source.

## Workspace recovery continuation

The interrupted workspace was not available. This workspace held `b71d7b5` with no
uncommitted changes; the ten pushed commits after it (`ad98099`…`9a0ed0a`) were
fast-forwarded without reset. Nothing was reimplemented.

- **Validation hold resolved by evidence.** The R3 stress failure at
  `r3-brush-browser-check.mjs:468` was re-run five times on the unchanged application
  code (alone, instrumented idle and under CPU load, concurrently with five suites, in
  the matrix's exclusive slot): all passed; the step takes ~0.3 s on both main and R10
  against a 30 s limit. The earlier failure's cause stays unconfirmed (its log was not
  pushed) and is recorded as such.
- **Full matrix** on the final application code: see R10_TEST_REPORT.md. The matrix
  runner sent the recovery suite to the production build although it imports source
  modules; fixed (`00dd895`), and the suite passes on the dev server.
- **D1 lossless split** (`06f73e2`). Image options offers "Split into N editable pages"
  when an image exceeds this device's Raster budget. PNG bands keep bit depth,
  channels, palette and tRNS (exact reconstruction verified for every PNG format);
  colour-managed or animated PNGs and transparent/profiled JPEG/WebP are refused with
  a reason. Parts use the normal import pipeline and sit right after the original,
  which is never changed; placing them is a normal, undoable reorder. Compatible
  reduced-resolution copies were not built (they reduce quality; design deferred).
- **Copy.** Three R10 messages had missing spaces ("up to1024px"); fixed (`bb0bf35`).
  The same pattern in older messages is left for a separate pass.
- **Formatting.** 16 unformatted R10 files formatted (`a320325`), data unchanged.
- **Performance.** Repeated runs (n = 7) with p50/p95 for import, open, brush, export,
  recovery and Smart Filter latency in R10_PERFORMANCE_REPORT.md.
- **Roadmap.** All twenty audit improvements classified, with designs for the
  high-risk items, in R10_ROADMAP.md.

## Known limitations (final)

- Arabic/RTL text on a path remains refused (prototype and proposal only).
- Asset deletion (B3) and a general tiled document compositor (D2) are deferred.
- Searchable command palette (#11), provider rate/cost controls (#16), controller
  extraction (#17), fonts (#18), PSD/OpenRaster (#19) and ICC/16-bit (#20) are design
  only or deferred.
- AI Enhance browser steps could not run here (huggingface.co denied; main identical).
- All UI testing is Chromium emulation; no physical Android/iOS/stylus testing.
- Older messages with missing spaces before numbers remain.
