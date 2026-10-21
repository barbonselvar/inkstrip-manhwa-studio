# Phase C — gradient layers, effects and independent adjustments

This release completes the current Phase C scope in the existing Pro document and
worker renderer. It adds no dependency or server data migration, and retains
original Chapter/source assets. It does not claim Adobe feature parity.

## Editable gradient layers

Layers → Gradient layer creates a standalone native layer with linear or radial
geometry. Properties edits angle, scale, normalized center, 2–16 color/opacity
stops, interior stop positions, add/remove and existing presets. The canvas
previews committed metadata live. Free Transform, duplication, groups, linking,
opacity/blends, local masks and clipping use the shared layer model.

Interpolation uses premultiplied encoded-sRGB stops. A linear gradient projects
onto the rotated plane's support width; radial gradients use a rotated ellipse.
Scale and center are relative to the original editable layer plane. Native export
uses pixel centers at full source resolution; reduced preview is approximate.

## Layer effects

Properties → Editable layer effects provides Drop Shadow, Inner Shadow, Outer
Glow, Inner Glow, Stroke, Color Overlay and Gradient Overlay. Each has independent
enable/opacity/reset; relevant color, radius, distance, angle, stroke position or
gradient controls are real editable parameters. Style order is editable. Layer
opacity and the existing layer blend mode apply once to the completed result.
Exterior styles composite behind the masked fill; interior styles and overlays
retain its alpha. Ordering is bottom-to-top within each plane. Styles use an
isolated source plane; individual backdrop-dependent style blending is not a UI
feature. The layer's blend mode blends the complete styled result with its backdrop.

Shadows use translated alpha silhouettes; glows use blurred source alpha. Blur is
a bounded three-pass separable box approximation to Gaussian blur. Stroke uses
separable max/min alpha morphology (square/Chebyshev footprint), with inside,
outside and center placement. Zero-width strokes and zero-radius glows do not
alter antialiased edges. Overlays are clipped to the original fill coverage.
Gradient Overlay is anchored to the masked artwork's projected alpha bounds.
These are traditional image operations, not generative AI.

Effects run after source adjustments, masks and projection, in document pixels.
Sizes remain fixed in document pixels when object geometry scales. Isolated groups
can have effects; children render before the group's styles and opacity.
Clipping stacks use the completed base alpha, including its exterior styles.

The renderer computes enough padding for nested style extents, draws all layers
and groups on that shared working plane, then crops to the original document.
Artwork outside the document can therefore cast shadows into it. Padded working
area is capped at three times the device area budget, with a 2048px padding cap;
large styles on narrow/large documents can be refused with a clear error. Radius
is limited to 64px, distance to 256px and stroke to 64px. Native source artwork is
retained and undo/native backup remain available. This is a CPU/full-surface
renderer, without a tiled or GPU style graph.

## Independent adjustment layers

Layers → Adjustment layer creates a separate operation over visible siblings
below it in the same isolated group. Existing tonal/detail properties and all
seven professional color operators are editable. Layer masks, captured selection,
transformed coverage, opacity and blend mode limit the filtered result. A clipped
adjustment filters its artwork base/stack; it cannot serve as an artwork clipping
base. Adjustments preserve backdrop alpha, including Gradient Map opacity stops,
which attenuate adjustment strength rather than erasing the backdrop.

An adjustment's transform moves its coverage plane, without geometrically
transforming the backdrop pixels. It is selected in the Layers panel rather than
stealing artwork hit tests. Painting its mask uses existing local coordinates.
Moving an adjustment changes its scope by order/group. Grouping or ungrouping that
would change the backdrop is refused. Partial selected merges involving an
adjustment are refused; Merge visible includes its backdrop and retains the
existing native pixel-equivalence guard. Full-root selected merges also retain
that guard. Styles on adjustment layers are refused as they are not artwork.

## Native documents, history and exports

Native v1 gains gradient/adjustment kinds and optional gradient/effect metadata.
Current code reads previous v1 documents without migration; older app versions
may reject new kinds. Schema validation bounds geometry, stops, styles, masks and
relationships. Duplication/history/native save retain metadata, editable paths,
text, masks, relationships and source bytes. Undo history remains session-only.

PNG/JPEG/WebP, crop/resize output and Chapter application all use the same native
compositor. SVG remains explicitly vector-only and refuses gradient layers,
adjustment layers and active effects rather than silently dropping their
appearance. SVG representation of these new features belongs to Phase D.
Shadows/Highlights remains pointwise; ICC/linear-light color and arbitrary
reorderable adjustment operators remain outside this release.

## Validation and release gates

Algorithm tests cover gradient geometry/interpolation/alpha; blur normalization;
morphological inside/outside extents; shifted shadows; inner/outer coverage;
overlay ordering; fractional alpha; zero-sized effects; padding/hidden groups/
cycles/budgets; native/history/source fidelity and unsafe grouping/merge refusal.
The appearance Chromium suite covers real worker pixels, all seven editable
styles, off-document shadow casting, independent adjustment backdrop/mask/clip/
group behavior, merge equivalence, native/local reopen, PNG/JPEG/WebP, original
Chapter bytes and Raster/Vector handoff. Native touch checks at 320px/390px exercise
layer creation, controls and reopen. Physical Android/stylus is not claimed.

This phase must pass all existing unit/type/lint/build/configuration and browser
suites, including actual local AI inference and homepage/3D regressions, before
merging. The release uses a normal merge commit at the exact tested PR head.
Production verification must complete before beginning Phase D; an unavailable
Vercel credential is a blocker to a manual deployment, not permission to create
a replacement project or publish an old preview.

Local release validation (2026-10-21): **484 automated tests passed**, including
**185 Pro tests / 31 new appearance tests**. TypeScript, production build,
build/auth configuration and whitespace checks passed. Lint has zero errors and
one pre-existing shared Button Fast Refresh warning. All **13 production Chromium
suites** passed: Chapter studio (actual local Swin2SR single/batch inference and
recovery), editor, adjustments, retouch, workflow, UI/3D, Pro, layers, repair,
geometry, transform, color and appearance. The new suite also passed on dev.
Dev/built desktop/mobile screenshots show clean consoles, no overflow and no
baseline divergence; generic canvas/game-card warnings remain unchanged.
