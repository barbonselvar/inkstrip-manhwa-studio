# Phase D — vector engine (unreleased)

Phase D starts from verified Phase C production merge
`e025d3995999c05921a057b601f88f44dea52460`, after live Chapter/Raster/Vector,
appearance/mobile, AI and 3D verification. Its branch is
`codex/phase-d-vector-engine`. It must remain a draft until the whole phase is
implemented and release gates pass. Phase C remains the production release.

## Implemented geometry and anchor-editing increment

`bezier.ts` extends the existing native cubic-anchor representation:

- Exact De Casteljau subdivision, point evaluation and analytic derivatives.
- Adaptive arc length with a global absolute error bound from control-polygon
  and chord bounds. Work/depth limits fail explicitly instead of silently
  returning unjustified precision.
- Bounded arc-distance inversion, including collinear cubics with nonuniform
  parameter speed, backtracking cusps and zero-length segments.
- An immutable native segment-subdivision document transaction, including the
  closing segment of closed paths. Both adjacent handles are updated without
  flattening. Source bytes, layer transforms, styles, masks and relationships
  are retained. Layer/ancestor locks, imported raw SVG paths, endpoints and the
  1000-anchor limit are guarded.

The geometry is now integrated into the existing Pen, Direct Select and Vector
appearance controls in both Studios:

- Select anchors on the canvas or by number. Numeric X/Y moves both attached
  handles with the anchor. Individual incoming/outgoing X/Y remains editable.
- Corner handles are independent. Smooth handles stay collinear while retaining
  the opposite length; symmetric handles mirror position and length. Changing
  modes creates useful tangents from neighboring anchors when needed. Alt/Option
  dragging breaks coupling into a corner. Collapsed handles remain finite.
- Dragging with the Pen creates symmetric handles. Older documents with no
  anchor mode keep their independent-handle behavior. Optional `Anchor.mode`
  persists within the existing version-1 format; no source pixels are replaced.
- An on-curve diamond inserts an exact midpoint; numeric insertion supports
  cubic-parameter percentage or percentage of traveled arc distance. Segment
  length is displayed in source-layer pixels. Both adjacent handles are updated,
  and adjacent symmetric modes become smooth when their lengths change.
- Reverse open or closed path traversal without flattening or changing its
  geometric locus. Closed reversal retains the first anchor.
- Remove handles or delete an anchor with clear geometry-changing descriptions.
  Direct Select's Delete/Backspace edits the anchor rather than removing its
  layer. Keep at least two anchors for an open path and three for a closed path.
  Minimum-topology violations and locked ancestors are guarded.
- Live pointer previews, pointer cancellation and one-step gesture undo use the
  existing history. Numeric updates coalesce by anchor/property. Native/local
  save/reopen, raster/SVG output and Chapter handoff use the shared engines.
- Direct Select uses screen-space 44px touch hit regions, resolves nearby
  controls against the insertion diamond, and maps points through the existing
  inverse affine/perspective/warp mapping. Existing two-finger pan/zoom cancels
  an in-progress anchor gesture without modifying geometry.

No replacement Pen or graphics engine was introduced. This is a working anchor
editing increment, **not a completed Phase D release**.

Tests independently verify analytic endpoints/derivatives, dense whole-curve
subdivision equivalence, quarter-circle length reference and declared error,
cusp traveled length, inverse distance, native open/closed geometry,
locks/limits, undo/redo and native/source roundtrips. Additional anchor tests cover
coupling, mode conversion, degenerate tangents, deletion topology, reversal,
perspective coordinates, mask/clip/source preservation and SVG cubic output.

## Remaining Phase D scope

- Remaining path editing: join/split open paths, multi-anchor selection, explicit
  additional keyboard modifiers.
- Robust Pathfinder Boolean operations. Compound fill rules are implemented in Increment A.
- Multiple artboards and artboard-aware native output.
- Precision object/anchor snapping and alignment.
- Expanded stroke/fill/appearance behavior, preserving editable objects.
- Text-on-path layout using arc metrics and typography persistence/export.
- SVG import/export for new vector geometry and appropriate Phase C gradients,
  adjustment/effect handling, with explicit unsupported-feature errors.
- Full native/history/export/mobile/AI/3D regression and release gates before
  merging; live production verification before the following phase.

Compound paths and SVG conversion are implemented in [Increment A](PHASE_D_COMPOUND_SVG.md),
including independent contours, winding, safe native/PNG/SVG persistence, affine
vector rendering and source-frame fitting. Raw legacy SVG data has an explicit
undoable native conversion. Handle removal and deletion still change geometry;
no curve-preserving simplification is claimed. Multi-anchor editing, join/split,
precision snapping and the remaining vector phase are unfinished. General SVG
clips/masks, gradients, effects and nonlinear export remain explicit limitations.

The original foundation passed 497 automated tests. The editor increment adds
17 algorithm/document/history tests (514 total, including 215 Pro tests).
`npm run test:vector:browser` checks real controls/workers, invariant curve pixels,
arc-distance insertion, coupling/Alt, pointer cancellation, reversal, keyboard
deletion, undo/redo, transformed mask/clip metadata, native/local persistence,
SVG/PNG fidelity, source retention and Chapter/Raster/Vector handoff. It also
checks Chromium CDP touch at 320px and 390px, cancellation, pinch/pan and no page
scroll/overflow. This is emulation, not physical Android testing. The full phase
release gates remain pending with the remaining Phase D implementation.

Earlier anchor-editing increment validation: all **514 automated tests** passed. TypeScript, production
build, build configuration and auth invariants passed; lint has only the existing
shared Button fast-refresh warning. All **14 supported Chromium suites** passed
against built output: studio AI, editor, adjustments, retouch, workflow, UI, Pro,
layers, repair, geometry, transforms, color, appearance and vector anchors.
Dev/built homepage smoke checks rendered desktop/mobile with no runtime errors
or baseline divergence, including the existing 3D canvas. Desktop and mobile
editor screenshots were inspected. The initial vector test fixture incorrectly
discarded remapped asset IDs on native reopen; preserving the actual exported
asset map fixed the fixture, and the full suite then passed. No tests were skipped
or tolerances/timeouts relaxed to obtain these results.

Increment A validation: **542 automated tests (243 Pro)** and **15 Chromium
suites** pass, including new compound/SVG references, native/history/export,
Chapter/Raster/Vector, repair, real neural AI, homepage 3D and 320px/390px touch.
TypeScript, lint, build/configuration and auth checks pass with the existing
shared Button lint warning. [Increment A](PHASE_D_COMPOUND_SVG.md) records
geometry/persistence limits and investigated fixture/readiness failures.
Phase D remains incomplete and must stay draft until Increments B–E pass release
validation; main and production have not been changed by this increment.
