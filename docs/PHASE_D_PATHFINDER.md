# Phase D Increment B — filled-region Pathfinder

This increment extends the existing Pro document, contour, Canvas worker and
anchor editing engines. Phase D remains draft: artboards/snapping (C), advanced
appearance/text-on-path (D) and broad SVG/performance/release validation (E) are
still required before a production release.

## Geometry and accuracy

The pinned `clipper-lib` 6.4.2 package (JavaScript Clipper 6.4.2.2, Angus Johnson's
Clipper/Vatti algorithm with the JavaScript port and JSBN) supplies integer
polygon union, difference, intersection and XOR. Its native evenodd/nonzero fill
rules normalize each input independently, including holes, nested contours,
self-crossings, coincident edges and tangencies. PolyTree hierarchy assigns holes
to connected components. This is actual geometry, not masks, CSS or pixels.
Licenses and attribution are served under `public/licenses/clipper-lib-*`.
`@types/clipper-lib` is pinned for TypeScript declarations.

Source cubic anchors remain untouched while preparing the operation. Adaptive
De Casteljau subdivision measures both control points against the finite endpoint
segment **after applying the affine transform**. A control-hull capsule bounds
curve/chord geometric deviation by the selected tolerance. Collinear loops and
backtracking are subdivided rather than discarded. The depth budget is 20.
Primitive/raw SVG arcs use Increment A's bounded conversion at one quarter of
the chosen document tolerance (adjusted by the affine matrix norm).

Tolerance defaults to **0.1 document pixel**, configurable from 0.02 to 1 pixel.
Integer coordinates use **10,000 units per pixel**. Endpoint and intersection
rounding introduce additional grid-scale error; repeated clipping can accumulate
roundoff. Nearly coincident geometry within that grid may collapse or change
contact topology. No global topological guarantee is claimed for arbitrarily
thin or ill-conditioned features. There is no post-Boolean curve fitting.

Results are **closed native line-anchor paths**, with nonzero winding and hole
contours. They are editable with the existing anchor/handle, compound,
fill/stroke, layer and transform tools. Exact original Bézier preservation is
**not** claimed. Legacy bounded source frames are intersected geometrically;
new overflowing affine paths use their complete filled geometry.

## Operation semantics and appearance

Layer stack order defines front/back, independently of checkbox order.

| Operation | Geometry and appearance |
| --- | --- |
| Unite | Union of all fills, one compound object, back object's fill/stroke. |
| Subtract | Back fill minus every front fill, back appearance. |
| Intersect | Region common to every fill, back appearance. |
| Exclude | Odd coverage parity across all fills, back appearance. |
| Divide | Partition at every overlap boundary, separate connected cells. Frontmost covering fill owns each overlap; strokes removed. |
| Trim | Each input minus all inputs above it; connected visible pieces retain their source fills, strokes removed. |
| Merge | Trim, then union compatible solid fills (case-insensitive color) across visible regions; separate connected components, strokes removed. |

Strokes are not expanded into regions. The panel explains appearance changes and
provides contextual tooltips. These operations replace source vector objects in
one immutable, undoable transaction; they are not a live parametric Boolean
relationship. Native files preserve resulting geometry, not the session Undo
history. Save a native backup first to retain original vector objects after
closing the editor. The original Chapter raster remains recoverable.

Empty output is blocked by default without removing anything. The explicit
**Allow empty result** checkbox permits removal of the selected objects in one
Undo step. No empty or unsupported result silently deletes source artwork.

## Hierarchy, supported cases and guards

Selections contain 2–16 filled shapes, directly or within selected neutral nested
groups. Roots must be consecutive siblings; children of an unselected containing
group retain that group. A selected group forest is flattened only within its
selected range. The surrounding hierarchy, unselected layers, source metadata,
selection, canvas and native assets are preserved. Existing group opacity,
effects and compositing outside the selected forest remain in place.

Operands must be visible, unlocked, opaque, affine filled shapes. Every contour
must be closed. Selected masks (including disabled metadata), captured selections,
painted strokes, clipping stacks/followers, links, effects, adjustments,
non-normal blending, translucent or stroke-only fills, text, perspective/warp,
empty groups and zero-area normalized operands are rejected. Release those
relationships or convert the content deliberately before retrying. General SVG
resources remain Increment A's explicitly unsupported cases.

## Worker, limits and atomicity

The UI only runs selection eligibility checks. Clipper and adaptive subdivision
run in a dedicated short-lived geometry worker; no raster assets are copied.
Cancellation terminates it, including a synchronous clipping call. A 12-second
watchdog terminates over-budget work. Worker errors/timeouts/cancellation expose
an error or retained-document status; no partial result reaches history.

Budgets include 4096 aggregate input vertices, 20,000 conservative segment-box
pair overlaps, 16,000 output vertices per clipping call and 256 intermediate
Divide regions. World coordinates must remain within ±1,000,000 pixels before
integer conversion. Results still obey the existing 48-layer, 128-contour,
1000-anchor/path, 16MP/source, 16384px-side and device-memory limits. Tight
approximations or highly intersecting artwork may be refused; use fewer objects
or a coarser tolerance rather than silently reducing output quality.

The worker builds an immutable candidate. The caller checks the original
history document is still current, validates geometry, asset references and
source budgets, then commits once. Failures leave the input document and Chapter
unchanged. Existing native envelope v1/v2 handling is unchanged; results use
ordinary Increment A path metadata and require no migration or new format.

## Validation

New algorithm tests use independent polygon coverage/area and analytic circle
lens oracles. Cases cover all seven operations, random multi-rectangle coverage,
concavity, disjoint/identical/reversed operands, edge/vertex/curve tangency,
near-coincident edges, self-crossings/degeneracy, both winding rules, nested
holes/islands, transformed geometry, legacy clipping, nested groups, guarded
relationships, source immutability, budgets, native/history/SVG and subsequent
anchor/compound editing. Worker tests verify success, cancellation, crash/error
and watchdog termination without committing partial geometry.

`test:pathfinder:browser` exercises the actual UI and geometry/render workers:
independent rectangle and ellipse pixel oracles, every operation, editable
results, native/local reopen, SVG export/reimport, PNG/JPEG/WebP output, undo/redo, source bytes,
unsupported/empty rollback, explicit empty removal, cancellation, keyboard Space,
Chapter application and Raster/Vector mode handoff. Touch emulation at 320px and
390px checks multi-selection, 44px buttons, subtraction, resulting anchor dragging,
history/native/export and no page scroll or horizontal overflow. Physical Android
hardware is not claimed.

The initial dev run was interrupted by Vite's first optimization/reload of the
new dependency; it was rerun after the optimizer settled. The initial new ellipse
pixel oracle sampled pixel corners and treated anti-aliasing as binary. It now
samples centers and excludes only a derived 0.85px band (pixel half-diagonal plus
curve conversion/subdivision error); independent area/point geometry tests were
unchanged. Native PNG/SVG roundtrip comparison tolerances are unchanged.

Validation totals: **573 automated tests pass**, including **274 Pro tests** and
**31 new tests** (27 geometry/document tests and four worker lifecycle tests).
TypeScript, production build, configuration and auth checks pass. Lint has zero
errors and the pre-existing shared Button fast-refresh warning.

All **16 supported Chromium suites** passed: studio AI, editor, adjustments,
retouch, workflow, UI/3D, Pro, layers, repair, geometry, transforms, color,
appearance, vector, compound and Pathfinder. Final Pathfinder-only selection,
status and mobile layout refinements were rebuilt and rechecked through the
Pathfinder suite, including finer numeric tolerance, native/history/export,
320px/390px touch and inspector overflow. Existing suites were not removed or
skipped. Dev/built homepage smoke waited for real controls and the lazy 3D canvas;
desktop/mobile screenshots were inspected with no console errors, overflow or
build/dev divergence. Existing game-card classifier warnings are unchanged.
