# Phase B2: non-destructive layer transforms

Baseline verified before writing: `ee35cebd3491474bfe71170b05e2a42567948ec1`,
existing branch `codex/raster-vector-studio-entrypoints`, PR #1.

## Delivered controls and behavior

Free Transform (F) operates on the active unlocked raster, paint, shape or text
layer. It provides eight scale handles, a rotation handle, draggable pivot,
move, independent/locked dimensions, numeric position/size/rotation/pivot,
horizontal/vertical flips and horizontal/vertical shear (skew). Reset controls
restore the starting transform, reset affine geometry or remove deformation.

A transform is a local draft. The existing worker renders live geometry, but
autosave/history retain the committed document. Apply validates and records one
history step; Cancel/Escape restores the previous geometry. Enter applies.
Switching tools or Raster/Vector modes discards an uncommitted draft. Native/raster
export, Chapter application and asset mutation cannot publish that draft.

Shift constrains move or temporarily toggles aspect lock during scaling; Shift
snaps rotation to 15 degrees. Alt scales around the pivot. Snap uses a 10px move
grid and the document center, with visible center guides. Pivot changes retain
the existing matrix, so moving the origin does not move the artwork.

Translation follows the existing layer-link contract: linked peers and selected
group descendants move together, with lock checks. Scale/rotate/shear/deformation
affect the active layer only. Layer IDs, order, parent IDs, clipping and link IDs,
masks, editable paths/text and immutable source assets are retained. Group-wide
Free Transform/multiple-object transform boxes are not implemented; use the
existing linked Move workflow or transform child layers.

Perspective mode exposes four independent corner controls and numeric control
coordinates. It uses an actual homography and inverse projective division for
pixels and input coordinates. Convex orientation-preserving cages are supported;
crossed, degenerate or vanishing-line cages are rejected. Affine flips can reverse
the result. No triangulated affine approximation is substituted.

Warp mode exposes nine editable control points in a 3×3 mesh. A tensor-product
quadratic Bézier surface smoothly deforms real pixels, masks, shapes and text.
This first version limits each control coordinate to ±10% of its source axis
extent around the identity mesh. Each Jacobian entry differs from identity by
at most 0.4, bounding its determinant below by 0.2 on the source domain; the mesh
cannot fold. Newton inversion uses analytic derivatives and a residual tolerance.
The displayed curves evaluate the actual surface, rather than only drawing a
control grid. Perspective and warp are alternative deformation modes per layer;
switching between them replaces the cage in the draft. Affine transformations
compose with either.

## Geometry and rendering contract

`Transform` retains its original positive `scaleX/scaleY`, position and rotation.
Optional `shearX/shearY` (degrees), `flipX/flipY`, pixel-space `pivot` and `deform`
fields are backward-compatible additions. Files without them retain legacy
geometry. A deformation stores source dimensions and normalized control points;
validation requires the dimensions to match the original layer geometry.

The affine matrix is:

`T(position) T(pivot) Rotation ShearY ShearX Scale Flip T(-pivot)`.

Deformation maps the original local plane first, followed by the affine matrix.
The pivot lives in the deformed local plane. Forward/inverse mapping is shared
by brush/pen/direct input, hit testing, selection frames, clone snapshots,
compositing, repair masks and bounds. Existing Move resizing also delegates to
the same scale math, including an applied pivot/shear/flip.

Masks, adjustments, text, paths and paint strokes render in their original local
plane. The complete masked surface then projects into the document using inverse
sampling. Clipping stacks still composite in document space, preserving base
alpha. Document-space selections and immutable sampled textures pull into the
original local grid using the captured forward mapping. Clone/repair snapshots
capture all new transform fields, so subsequent transforms move their pixels.

Non-affine repair derives its actual destination coverage at native resolution
before local donor analysis. Existing one-megapixel repair-neighborhood limits
remain in force. Source sampling, crop and output resampling stay separate:
repair/wand/merge operate on the full document; the prior crop/resampling engine
runs after the transformed composite during export/Chapter application.

Affine rendering remains on Canvas 2D. Perspective/warp use CPU inverse mapping
with premultiplied-alpha bilinear interpolation and transparent virtual samples.
Native export uses scale 1; the 1400px preview cap never determines export size.
Perspective bounds use exact projected corners; warp bounds include analytic
quadratic-edge extrema, including extrema between control points. All processing
stays in the existing cancellable worker, without new dependencies.

PNG/JPEG/WebP and native files preserve the result. Affine vector/text SVG uses
real matrix transforms and retains editable geometry. SVG export explicitly
refuses vector/text perspective/warp because those effects cannot be faithfully
represented by this SVG exporter. It does not silently drop effects or rasterize
native objects. Raster rendering of vector/text remains the existing Canvas
pipeline; their native model data remains editable.

## Validation

- Matrix composition/inversion; legacy compatibility; shear/flip/pivot order;
  all eight fixed-opposite-anchor scale handles; aspect/Alt scaling; angle snaps.
- Dense affine/projective/warp forward/inverse grids, analytic trapezoid mapping,
  straight projective lines, Bernstein weights and smoothness, extreme allowed
  mesh inversion, exact edge bounds and malformed/folded-cage rejection.
- Premultiplied edge colors, exact identity RGBA, real homography/warp samples,
  selection/snapshot mapping, locked links, one-step undo/redo, native masks,
  texture snapshots and SVG fidelity/refusal.
- `test:transform:browser` checks real worker exports against an independently
  composed Canvas affine reference and analytic perspective pixels; mouse
  corners/edges/rotation/pivot, numeric controls, live preview, Apply/Cancel,
  mode switching, selection-aware painting, clip alpha, clone and Spot Healing,
  editable shape/text, native/local reopen, exact original Chapter bytes,
  2000px source data beyond preview, and shared crop/resampling output.
- Chromium native touch checks at 320px/390px: scale, perspective and warp handles,
  pinch zoom/two-finger pan, history/export, Apply/Cancel visibility, no page
  scroll or horizontal overflow. Physical Android/stylus testing is not claimed.

Local validation on 2026-10-21: **423 automated tests passed**, including
124 Pro tests and 35 new transform tests. TypeScript, lint (one existing Button
Fast Refresh warning), production build and build/auth checks passed. All eleven
supported Chromium browser suites passed; transform checks also passed on dev.
Preview completion is tracked against the document actually drawn and exposed
through `aria-busy`, so layer comparisons wait for the current render instead
of a fixed delay. Playwright was used because agent-browser is unavailable.

## B2 milestone limits (historical; updated in the color increment)

This is an initial professional transform implementation, not Adobe feature
parity. Warp remains a bounded 3×3 quadratic surface; arbitrary mesh density,
folds, puppet warp, envelopes and simultaneous perspective-plus-warp stacks are
missing. Group/multiple-object Free Transform and object-edge snapping beyond
the existing document/grid guides are missing. Direct SVG deformation/export
is unsupported; native files retain it. Perspective must remain convex.

Nonlinear interpolation is bilinear with no anisotropic/mipmap reconstruction;
strong minification can alias. Filtering remains in premultiplied sRGB, without
ICC/linear-light conversion. Large deformations use CPU work and full surfaces,
not tiles/GPU acceleration; existing 16MP desktop / conservative 4MP device,
16384px-side, 48-layer and asset budgets remain unchanged. Browser/device memory
and sustained performance need further physical-device benchmarking.

Undo is the existing 50-step session history; reopening retains applied geometry,
not the prior undo timeline. The next transform increment should add group/multi-
object transactions and higher-quality projective minification, then broader
meshes with explicit fold handling. Phase C non-destructive color/effects remain
separate future work.


The subsequent [group/projective/color increment](PRO_COLOR_ENGINE.md) adds affine
group/multi-object transactions and multilevel projective minification. Its scope
and remaining-limit descriptions supersede those two missing items above.
