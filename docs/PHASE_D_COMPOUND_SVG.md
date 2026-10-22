# Phase D Increment A — compound paths and SVG geometry

This increment extends the shared Pro document/Canvas worker engine. Phase D
remains a draft; Pathfinder, artboards/snapping, advanced appearance, text-on-path
and the remaining SVG/release work must finish before merging PR #3.

## Editable geometry

`Layer.anchors` and `closed` remain contour zero. Optional `subpaths` holds up to
127 additional open/closed contours. The combined limit is 1000 anchors per path.
Legacy documents retain their original defaults. `fillRule` defaults to nonzero;
evenodd alternates nested filled areas and holes. Rendering, SVG output and fill
hit testing share the same rule. Stroke geometry follows every contour; open
contours close only for filling, not for stroking.

The existing anchor operations accept a contour index. Numeric controls and
Direct Select edit that contour, retaining all others, layer relationships,
transforms and immutable source references. Exact subdivision handles closing
segments too. The subpath selector and canvas/touch picking share the active
contour, and a gesture carries its contour index through preview/cancel/commit.

Create compound path requires consecutive sibling vector shapes with visible,
unlocked, neutral opacity/blend and no masks, clipping, links, active effects or
adjustments. Siblings inside supported nested groups work. Geometry is mapped
exactly into the bottom object's affine frame; all cubic controls survive. The
bottom object's fill/stroke becomes the compound appearance, as the UI states.
Release creates one editable layer per contour and deliberately removes hole
relationships. Both are undoable metadata transactions; unsupported relationships
or layer/geometry/memory limits fail before modifying the document.

New affine paths render beyond their local editing frame, so an anchor moved
outside an imported object's initial bounds stays visible. Legacy source frames
keep their clipping behavior. Fit vector frame to content rebases all contours
and source dimensions without changing world curves or the transform pivot. It
guards masks, captured color selections, painted strokes and nonlinear transforms
that cannot be rebased by a translation. Perspective/warp of extended paths
requires fitting first, rather than silently cropping out-of-frame geometry.

## SVG conversion and rendering

The parser supports absolute/relative M, L, H, V, C, S, Q, T, A and Z, repeated
parameters, multiple subpaths, exponent notation and compact arc flags. Lines
and quadratic/cubic geometry are retained exactly to floating-point precision.
Close preserves the preceding cubic handles; drawing after Close starts a new
open contour at the closed start. Exact line/quadratic degree reduction during
serialization avoids different cubic dash/flatness approximations.

Arcs use the SVG endpoint-to-center construction, including radii correction,
rotation, direction/large-arc flags, zero-radius lines and coincident-endpoint
no-ops. Tangent cubics use `4/3 * tan(angle/4)` and adaptive angular subdivision.
A degree-six Bernstein convex-hull bound on squared unit-circle radius gives a
conservative radial geometric error, carried through the ellipse's largest
radius. Conversion targets 0.01 affine document pixel using the affine matrix
norm; the reported bound is geometric distance, not equal-parameter angular
speed, and excludes floating-point roundoff. No polygon flattening is used.
Native conversions under nonlinear deformation retain the local tolerance;
projective/warp raster interpolation remains the existing engine's responsibility.

SVG affine lists support matrix, translate, scale, rotate about an origin,
skewX/skewY, reflections and nested transform inheritance. Native scale/shear,
coordinate and source budgets still apply. Root viewBox offsets and
preserveAspectRatio none/meet/slice alignment are supported. Source dimensions
are quantized to the native integer pixel grid. Negative local coordinates are
normalized before source-surface allocation, retaining the complete geometry.

Nested groups retain hierarchy and isolated opacity. Fill/rule, solid colors,
fill/stroke opacity, width, cap, join, miter limit, dash array and offset are
inherited/persisted/exported. Supported simple text retains its native text
object. Unfiltered affine vectors draw directly at document resolution in the
existing compositor, preserving sharp edges through transforms. Masks,
pixel-based adjustments and nonlinear deformation retain the existing source
surface pipeline; explicit frame fitting is available before those operations.

When an SVG viewport differs from the Chapter canvas, its source viewport is
captured as recoverable per-object masks. Off-viewport geometry is retained and
can be recovered by disabling/removing those masks. Moving a native child moves
its captured source mask with it; this is not a claim of general SVG group-clip
semantics. SVG mask export is still unsupported; native/PNG preserves it.

Basic uncropped SVG output avoids unnecessary wrappers/clips and can be imported
again with editable contours and styles. Crop output retains its required source
clip. Arbitrary SVG clip paths/masks, gradients, filters, use/external resources,
text spans/text-on-path and unsupported CSS remain explicit errors. Complete SVG
interoperability is Increment E, not claimed here.

## Persistence and safety

The internal document model stays version 1 and legacy native files still open.
Files requiring compound/fill-rule/new stroke/frame metadata use a version 2
native **envelope**. Older releases reject v2 instead of silently discarding holes
or styles; ordinary legacy documents continue to export as v1. No Chapter or
IndexedDB data migration is introduced.

Native exports embed only assets referenced by current/hidden layers, original
source metadata, Clone/Healing strokes and mask strokes. Unreferenced Undo assets
stay in the immutable session pool, but are not repeatedly copied into native
files. This prevents exponential file/asset growth across export/reimport cycles
without evicting any Undo source. The existing 64-asset/48MB/session and 70MB
native import budgets remain explicit.

SVG is parsed as data and never attached to the DOM. Allowlisted tags/attributes
and CSS properties reject scripts, events, external/data/javascript URLs,
entities, unsupported resources and malformed geometry. Colors must actually
parse in Canvas; context-dependent/unsupported colors fail instead of reusing a
previous color. Path, contour, transform, layer and device-memory budgets prevent
unbounded conversion. Errors leave the existing document and Chapter untouched.

## Validation

Algorithm/native tests cover command equivalence, exact quadratics, arc geometry
and declared bounds, radii/flag/degeneracy cases, affine composition, malformed
input, budgets, compound world geometry, open/closed release, independent contour
edits, frame/pivot fitting, locks/hierarchy/clip guards, history, source bytes,
v1/v2 persistence and 25 bounded native reimport/export cycles.

`test:compound:browser` exercises real UI/workers, winding/holes, source bounds,
subpath edits, creation/release, undo/redo, native/local reopen, SVG and PNG output,
independent Chromium SVG references, unsafe-input rollback, Chapter/source
handoff, and CDP touch at 320px/390px. Existing vector and Raster/AI/3D/browser
regressions remain release gates. Touch emulation is not physical Android testing.

The shared browser fixture waits for import completion and accounts for the
existing 50-entry history window; it does not increase that history limit.
An initial built-vector mobile cancellation check failed because synthetic touch
coordinates raced inspector-driven canvas resizing, leaving the object unselected.
Diagnostics retained unchanged geometry; waiting for stable artboard bounds before
pointer input fixes that fixture race without sleeps or relaxed assertions.
Two existing native-export browser assertions now compare the actual exported
original-source asset ID instead of a stale unused `assets.source` entry. Byte
equality checks remain unchanged. SVG reference tolerances were not relaxed.

Automated validation passes **542 tests**, including **243 Pro tests** and
28 new tests in this increment. TypeScript, lint (one pre-existing shared Button
fast-refresh warning), production build, build configuration and auth invariants
pass. No dependencies, environment variables or CI/deployment settings changed.

Dev and built homepage smoke checks wait for the project controls and lazy 3D
canvas via the supported `--ready-selector` option. Earlier generic readiness
captured startup/loading frames; the final desktop/mobile screenshots were
inspected with the complete interface, no runtime errors or horizontal overflow,
and no built/dev baseline divergence. Existing game-card classifier warnings are
unchanged; Inkstrip remains an image editor, not a game.

All **15 supported Chromium suites** passed on the final production build:
studio AI, editor, adjustments, retouch, workflow, UI/3D, Pro, layers, repair,
geometry, transforms, color, appearance, vector anchors and compound/SVG.
The final vector cancellation and new compound touch checks pass at both 320px
and 390px. No tests were skipped or assertions/tolerances/timeouts relaxed.
