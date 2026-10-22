# Phase D Increment C — artboards and precision (unreleased)

This increment extends the existing document, layer/history, compositor, pointer
and worker engines. PR #3 stays draft. Appearance/text-on-path (D) and broader
SVG/performance/release validation (E) remain unfinished; no production release.

## Document and editing contracts

- Up to 32 real named, ordered artboards in shared document coordinates. Each has
  X/Y, integer pixel width/height and transparent or solid background. Boards can
  extend outside the original canvas, including negative coordinates. Create,
  duplicate, rename, reorder, delete, numeric move/resize, orientation swap,
  presets, selected/all fit and boundary visibility use actual native metadata.
- The Artboard Tool (Q) has corner/edge handles, labels and boundary dragging.
  Pointer previews do not write history. Release or Enter commits one operation;
  Escape, pointer/touch cancellation, capture loss, blur or a second touch rolls
  back. Two fingers retain the existing pan/pinch behavior. Use the existing
  expand-canvas/inspector toggle on a small screen for more handle space.
- **Artwork stays stationary by default.** Deleting a board never deletes any
  artwork. Duplicating copies the boundary/background, not the shared artwork.
  Optional Move contained artwork translates fully contained root forests plus
  their linked members once through the existing layer engine. Partial root
  clipping stacks and locked members block the operation atomically. Resizing
  never scales artwork. Groups, masks, clips, source textures and original source
  references retain their relationships. Linked members can extend outside the
  board; this is stated in the UI rather than silently severing their links.
- A4/A3 use exact mm-to-inches conversion (25.4 mm/in); Letter uses inches.
  Document DPI (36–1200, legacy default 96) converts physical presets to rounded
  integer pixels. Pixel presets are DPI-independent: square 1080, landscape
  1920×1080, portrait 1080×1920 and webtoon 800×4000; numeric fields provide custom
  sizes. Changing DPI does not resample existing artwork or write print-density
  tags into browser-encoded raster files. The existing 16MP / 16384px-side native
  budget still applies, so oversized high-DPI physical presets fail explicitly.

## Rendering, export and compatibility

The original Chapter canvas width/height, crop, image-size settings and source
coordinates are unchanged. Vector Studio renders a virtual work area containing
that canvas plus artboards. Fit selected / Fit all uses a focused render viewport
(rather than magnifying a tiny full-workspace bitmap), including widely separated
boards. The canvas-fit button restores the full work area. Pointer, SVG overlay, grid phase, eyedropper,
selection coverage and navigator coordinates use the same world frame. During a
board drag the viewport stays fixed to the committed document to prevent fitting
feedback. The shared compositor accepts a viewport origin instead of translating
or rasterizing source objects. Affine/direct vector, masked local surfaces,
projective sampling, groups, clipping, adjustments and effects share that origin.

Selected or numbered/ranged/all artboards export independently in panel order:

- PNG/JPEG/WebP use the real renderer with exact board clipping and configurable
  0.1–8× raster scale. Transparent PNG/WebP and solid board backgrounds are
  supported; JPEG adds white behind alpha. Layer, effect, padded-output and device
  budgets are checked; source bitmaps are never decoded larger than native.
- SVG uses a board-sized world-space viewBox and root viewport clipping, retaining
  supported paths/curves/text/transforms. It has the same explicit unsupported
  masks/clipping stacks/adjustments/effects/nonlinear and gradient guards as the
  existing vector-only SVG exporter. Raster and paint layers are excluded, as
  labeled. This is not a claim of broader SVG feature completion.
- Safe filenames include panel order and a normalized sanitized board name.
  All/range exports are individual downloads, not a ZIP; browser multiple-download
  permission may apply. SVG batches have a 24M-character text budget and yield
  between boards; large documents should use smaller ranges. Whole-document export and Apply to Chapter continue to
  use the original canvas/crop. Boards are a separate export scope.
- New documents with artboard/layout metadata emit native envelope **v3**, so old
  releases reject them rather than silently losing boards/guides. Existing v1/v2
  documents remain readable and retain legacy output envelopes when unchanged.
  Missing board/layout data uses non-mutating defaults. Native/local persistence
  preserves boards, order, DPI, grid, guides and snap settings. Native files store
  current geometry and retained original bytes, not the session Undo timeline.

## Precision and alignment

- Reusable snap candidates are cached at gesture start, excluding the entire
  moving/linked forest. Axis candidates are sorted with binary range lookup;
  anchor point candidates are cached world coordinates. No path parsing or
  stationary-object bounds scan runs on each move event.
- Legacy Direct Select retains unsnapped editing until the user enables precision
  in the Precision panel or saves precision/grid/Snap settings. Adding an artboard
  also initializes those settings. This preserves old exact inverse-mapped editing.
- Acquisition is configured in **screen pixels**, divided by actual fit × zoom.
  Object edges/centers, artboard edges/centers, original canvas, grid, document
  guides, anchors and Bézier endpoints are supported. Native compound contours
  supply anchors; affine cubic derivative roots supply geometric bounds.
- A point drag first acquires the nearest anchor within a circular tolerance.
  Other axis candidates compete by distance, then explicit-guide / artboard /
  object / equal-gap / grid priority, with stable coordinate/ID ties. Grid does
  not quantize a point outside tolerance. Alt bypasses snapping.
- Snapping integrates ordinary and linked/multi-object movement, anchor movement,
  object and affine Free Transform resizing/movement, and board movement/resizing.
  Resize acquisition follows the actual handle, preserving finger grab offsets.
  Constrained rotated edges/aspect locks solve a feasible world-axis response;
  only actual resulting alignments are shown as guides. Perspective/warp cage
  snapping and tangent/interior-curve snapping are not claimed.
- Smart Guides show only acquired axes and clear on release/cancel/tool change,
  blur or pinch. Equal-gap targets use facing edges of adjacent overlapping peers,
  not a complete Illustrator constraint solver or measurement-label system.
- Grid spacing, independent grid visibility/snapping, guide visibility,
  horizontal/vertical guide creation, numeric movement, dragging with the Artboard
  Tool, lock and delete all persist. Locked guides remain snap targets but cannot
  move; hidden guides do not snap. At most 128 guides, finite bounded coordinates.
- Six align operations support selection, key object or active artboard.
  Horizontal/vertical center distribution and equal gaps keep first/last objects
  fixed and require three independent roots relative to Selection. Actual
  immutable translations are undoable; hierarchy and source pixels stay intact.
  Coupled or external links are rejected rather than translating shared members
  repeatedly. Geometric bounds exclude stroke/effect expansion; non-affine objects
  use their existing conservative transformed frame bounds. Arbitrary key-object
  distribution and custom gap distances remain future extensions.

## Validation

37 new algorithm/document tests independently check CRUD/order/source invariants,
physical units, negative unions, bounded ranges/names, v1/v3 round-trips, original
bytes, undo/redo, invalid input/budgets, clipping/locks/groups, grid/point/object/
board/guide acquisition, screen tolerance, equal spacing, cubic extrema/rotated
bounds, alignment/distribution and exact off-center/rotated/aspect handle snapping.

The dedicated Chromium suite exercises actual native/render workers through UI:
CRUD/order/history, off-canvas/negative exports, 2× alpha, PNG/JPEG/WebP/SVG pixel
oracles, masked/clipped groups, range downloads, alignment, guides, source bytes,
native reopen and desktop / 320px / 390px touch gestures, cancellation and guide
cleanup. No application hooks, fake worker results or physical Android claims.
Full supported suite results are recorded in the PR after the final run.

Regression investigation: the first complete run exposed new grid acquisition
changing an existing perspective-anchor test. The original test/tolerance was
retained; explicit precision opt-in for legacy Direct Select fixes the behavioral
change. Zero-extent line bounds and constrained/off-center handle acquisition have
independent regression cases. Browser test authoring also corrected a selector,
used the browser Image decoder for SVG, and accounted for subpixel touch delivery
without rounding document coordinates. Existing tests were not weakened/removed.

Validation totals for this increment: **610 automated tests passed**, including
**311 Pro tests** and **37 new algorithm/document cases**. TypeScript, lint,
production build, build configuration and auth invariant checks pass. Lint has
zero errors and one pre-existing shared Button fast-refresh warning.

All **17 supported Chromium suites** pass: studio (real neural AI), editor,
adjustments, retouch, workflow, UI/3D, Pro, layers, repair, geometry, transform,
color, appearance, vector, compound, Pathfinder and artboards. Final artboard-only
render/background refinements are rechecked with actual v3 file imports, local
save/reload, Chapter application/original recovery, Raster/Vector handoff and
raster/SVG pixel oracles at desktop and both touch widths. The homepage dev/build
smokes include visually inspected screenshots, no runtime errors/overflow and no
baseline divergence. The existing generic game-card classifier warning does not
apply to this image editor; no unrelated homepage branding was added.
