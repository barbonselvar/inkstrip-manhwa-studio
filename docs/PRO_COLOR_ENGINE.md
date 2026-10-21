# Group transforms, projective filtering and professional color

This increment extends the shared Raster/Vector engine. It preserves native v1
files, Chapter originals, existing repair/selection tools and editable geometry.
It does not claim Photoshop or Illustrator feature parity.

## Affine group and multi-object transactions

Free Transform (F) accepts multiple selected layers or a selected group. The
aggregate frame includes all descendants and linked peers, including hidden
children; selecting both an ancestor and child transforms that child once.
Move, scale, nonuniform scale, rotation, flips, both shears, pivot, aspect lock,
numeric controls, snapping, pointer/touch handles and Apply/Cancel use the existing
transactional preview. One Apply is one history entry. Locked descendants or
linked peers reject the whole operation before changing the document.

Groups retain the existing isolated-stack model with document-coordinate child
geometry. An affine world delta is composed with each leaf's existing matrix;
QR factorization returns editable transform fields. Child source-space warp or
perspective geometry remains intact. Parents, order, group opacity/blends, clipping,
local masks, selection/repair snapshot frames and original assets are unchanged.
The renderer therefore keeps its existing group/clipping semantics. Undo restores
all leaf transforms together; native save stores the resulting editable fields.

Group/multiple-object perspective and warp are **missing**. Group frames and pivots
are derived for each transaction, rather than stored as a new parent matrix.
Each resulting child must remain inside the existing scale/shear/position limits;
extreme combinations fail atomically. Individual perspective/warp remains supported.
An active document selection stays fixed in document space while its captured
local masks and paint clips move with the objects.

## Projective minification

The nonlinear inverse renderer measures the source footprint using a local inverse
Jacobian. Above 1.5 source pixels per output pixel it uses stratified samples
(up to 8×8) and a lazy box-filter pyramid. The smaller singular value chooses
minification level; extreme anisotropy also increases the level to bound work.
Pyramid storage is premultiplied Float32 RGBA: low alpha is not repeatedly rounded
and invisible RGB cannot bleed into opaque color. Odd edges use transparent
virtual source pixels. Both native exports and previews use the same sampler.

This reduces aliasing on strong perspective reductions; it is not an exact EWA
filter. Mild reductions retain bilinear reconstruction. The anisotropy cap can
soften narrow detail; filtering uses encoded sRGB rather than linear light/ICC.
Additional pyramid storage is about one third of source pixel count for ordinary
2D images (up to one plane for thin strips), with four floats per pixel. CPU work,
full surfaces and the existing 16MP desktop / conservative 4MP device budgets
remain. The reduced preview cannot display every native-resolution detail.

## Editable color pipeline

Properties → Professional color adjustments provides seven independently enabled
operations, numeric controls and individual/global Reset. Values are optional
`Layer.color` metadata; older files without it retain their exact existing behavior.
The order is fixed and visible in the inspector:

1. Color Balance: smooth luminance weights for shadows/midtones/highlights,
   three opposing color axes, optional gamut-safe luminance preservation.
2. Vibrance: saturation-dependent chroma gain; negative values desaturate.
3. Channel Mixer: independent 3×3 percentage matrix and per-channel constants.
4. Shadows and Highlights: weighted luminance lift/recovery, tonal width and
   chroma-preserving gamut compression. This is a pointwise operation, not a
   spatial local-contrast or detail-recovery filter.
5. Gradient Map: luminance lookup, amount, 2–16 editable color/opacity stops,
   inserted/deleted/interior-position stops, grayscale/sepia/cyanotype presets.
6. Threshold: weighted encoded-RGB luminance cutoff (inclusive at threshold).
7. Posterize: 2–256 evenly spaced per-channel levels.

Legacy adjustments/levels/curve precede this pipeline. A captured selection can
limit color coverage, including feathering and inverse/nonlinear coordinate
frames. The checkbox captures the current document selection into original layer
coordinates. Removing the document selection afterward does not erase that mask.
Color processing precedes the layer mask, geometry, clipping, layer opacity and
blend mode. Gradient stops interpolate premultiplied color and opacity; opacity
stops intentionally modulate layer alpha. Other color operations retain alpha.
Partial coverage blends premultiplied before/after pixels without dark fringes.

Numeric changes preview live and are undoable/coalesced with the existing history
contract. Native save/reopen persists parameters, captured selection and unchanged
source bytes. Raster PNG/JPEG/WebP and Chapter output share the native renderer.
SVG explicitly refuses active color adjustments, rather than dropping their
appearance. Text/shape layers remain editable and are never destructively rasterized.

## Deliberate remaining scope

Implemented: per-layer editable seven-operation color pipeline and gradient-map
stops/presets, affine group/multiple-object transforms, improved projective filtering.

Partial: professional adjustment architecture (fixed order on individual non-group
layers, not separate stack adjustment layers; no group adjustments); anisotropic
reconstruction is bounded; existing warp remains a bounded 3×3 mesh.

Missing: standalone linear/radial gradient layers, angle/scale/canvas gradient
handles, and all requested editable layer effects (drop/inner shadow, outer/inner
glow, stroke effect, color/gradient overlay). Existing vector stroke/fill controls
are not counted as new layer effects. Next priority is editable gradient layers,
then effects with padded bounds, explicit ordering and mask/compositing tests.

## Validation

Pure tests cover affine composition/inversion, nested/linked/locked forests,
local-mask retention, history/native/source fidelity, checkerboard minification,
alpha/odd edges/origins, all adjustment mathematics, gradient interpolation and
strict malformed-native rejection. The color Chromium suite exercises actual
worker pixels, controls/reset/captured selections, group masks/clips/opacity,
undo/redo, native reopen and PNG export. Native CDP touch emulation at 320px and
390px checks group handles/Apply and color controls without page scroll/overflow.
Physical Android hardware is not claimed. Existing transform browser suites
continue to cover pinch/two-finger pan, all individual transform modes, vector/text,
repair, native source detail and PNG/JPEG/WebP.

Local validation on 2026-10-21: **453 automated tests passed**, including **154 Pro
tests / 30 new tests**. TypeScript, production build, build/auth configuration
checks and whitespace checks passed. Lint has zero errors and one pre-existing
shared Button Fast Refresh warning. All **12 production Chromium suites** passed:
Chapter studio (real local Swin2SR), editor, adjustments, retouch, workflow, UI,
Pro, layers, repair, geometry, transform and color. Transform and initial color
checks also passed on dev. The final color suite additionally verifies local
save/reopen, Raster/Vector handoff and exact Chapter output/original bytes.

The first concurrent Chapter-studio run timed out at its 180-second two-image AI
batch wait; its single-image inference had passed. Rerunning the unchanged suite
with fewer concurrent browser processes passed, including batch inference and
recovery. This timing flake is retained in the validation record. Physical-device
performance remains unverified. Dev/production desktop/mobile smoke and screenshot
review found clean consoles, no overflow and no baseline divergence. The generic
canvas/game-card branding warnings are unchanged. Playwright was used because
agent-browser is unavailable.


The subsequent [Phase C completion](PHASE_C_LAYERS.md) implements the standalone
gradient layers, independent adjustment layers and seven editable effects listed
as missing at this earlier milestone. Its current contracts supersede that scope.
