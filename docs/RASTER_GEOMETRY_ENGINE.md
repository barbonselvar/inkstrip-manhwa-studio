# Raster geometry: Phase B crop and output sizing increment

Baseline verified before editing: `6445d775da92e726b1c074ac0bb312e1fcce3cdd`,
PR #1, branch `codex/raster-vector-studio-entrypoints`.

## Implemented

- Crop tool in both shared Pro workspaces, keyboard C. Eight edge/corner handles,
  freeform drawing, movement, freeform/aspect presets, numeric X/Y/pixel dimensions,
  rotated frame/straighten angle, shaded exclusions and rule-of-thirds guides.
- Crop drafts do not change the document, autosave or Chapter. Apply records one
  undo transaction; Cancel/Escape discards the draft; Enter applies. Apply/Cancel
  stay beside the canvas on narrow screens. Reset crop is undoable.
- Full source canvas remains visible for editing, with excluded areas dimmed.
  The Geometry inspector previews the crop/output bounds. This is a geometry
  preview; native-size reconstruction filters run during export.
- Image size controls set exact final pixel dimensions, aspect lock and one of
  nearest neighbor, bilinear, Catmull–Rom bicubic or Lanczos 3. The latter three
  widen their reconstruction kernels for downscaling and normalize at edges.
  Filtering uses premultiplied alpha so hidden RGB cannot contaminate edges.
- Canvas size controls extend/trim the canvas at its top-left origin without
  resampling or changing layer geometry. Trimmed source artwork remains in layers.
- Crop, canvas size and output size are independent editable document properties.
  Cropping does not silently reset an explicitly selected output size.
- PNG/WebP/JPEG output and Apply to Chapter use the same native-resolution output
  stage. Outside-canvas crop areas are transparent; JPEG fills them white.
- Supported vector-only SVG exports use the same crop/straighten/output matrix
  and clip to the original canvas; text and shapes remain vector geometry.
- Native files and local drafts preserve exact geometry metadata, source bytes,
  editable layers/masks/selection and existing repair data. Older native files
  lacking the optional fields retain their prior behavior.

## Coordinate and rendering contract

`ProDocument.width/height` remain **full canvas dimensions**. Optional `crop`
contains `{x, y, width, height, rotation}` in full canvas coordinates, with integer
output width/height and clockwise degrees around the crop center. Fractional
origins support numeric alignment. Crops can extend outside the canvas.
Optional `imageSize` contains `{width, height, resampling}` and describes the
final raster output grid. Neither changes layer coordinates or raster assets.

`composite()` still renders the full canvas. Preview, color analysis, repair,
merge validation and thumbnails keep this existing coordinate system. Clone and
Healing source capture explicitly requests a full-canvas snapshot, even when
output is cropped or resized. The export worker applies crop/straighten and then
resampling **after** layer transforms, masks, clipping, adjustments and blends.
Thus all layer kinds, masks and existing repair textures stay aligned, including
non-uniform output scaling. Source assets are not destructively resized.

`geometry.ts` defines forward/inverse crop coordinates, fixed-opposite-handle
resizing and the SVG/output affine matrix. `resample.ts` is a pure, bounded-row-cache
CPU filter; it does not allocate an entire floating-point intermediate image.
`output.ts` owns the final output surfaces and fills JPEG transparency after
resetting the crop transform. Existing worker cancellation terminates CPU work
without committing document/Chapter changes.

The device budget applies independently to full canvas, crop and final output:
16 MP desktop, 4 MP for coarse-pointer/low-memory devices, 16384px per side, plus
existing layer/source/asset limits. Invalid or oversized requests are refused;
resolution is never silently reduced. Small previews do not determine export size.

## Validation

- Geometry unit tests: frame inverses, all eight rotated handles/opposite anchors,
  aspect constraints, reverse drawing/movement/minimum size, output matrices,
  source/mask-preserving undo/redo, native roundtrip, malformed metadata and SVG.
- Resampling tests: exact identity, constant RGBA at both scales, pixel-center
  nearest sampling, hidden-color alpha isolation, strong checkerboard downscale,
  and allocation/dimension guards.
- `npm run test:geometry:browser`: real worker pixels, mouse crop/ratio/straighten,
  Apply/Cancel/Escape, alpha and JPEG bounds, all four filters, native import and
  local save/reopen, canvas vs image sizing, masks/text, full-canvas Clone capture,
  Chapter apply/original retention, and 320/390px Chromium touch/pinch/pan/undo/export.
- Existing Pro, layer, repair and Chapter/browser suites remain regression gates.
  Chromium touch emulation does not establish physical Android/stylus support.

Local validation on 2026-10-21: **388 automated tests passed**, including 89 Pro
tests (26 new geometry/resampling tests). TypeScript, lint (one existing Button
Fast Refresh warning), production build and build/auth configuration checks
passed. All ten supported Chromium browser suites passed against the production
build; geometry also passed on dev, including 320px/390px touch emulation.
Dev/production smoke had clean consoles, no overflow or baseline divergence.
Playwright was used because agent-browser is unavailable. The existing generic
canvas/game-card branding warnings remain unrelated to this editor increment.

## Partial and missing at the crop/output-sizing milestone

This section records the earlier increment. Phase B2 now implements the
active-layer affine/perspective/bounded warp features listed in
[PRO_TRANSFORM_ENGINE.md](PRO_TRANSFORM_ENGINE.md); its remaining limits apply
to the current branch.

This completes a crop and output-sizing increment, **not all of Phase B**.

- Existing per-layer move, scale, numeric rotation, snapping, center guides and
  Bézier editing remain available. There is no new complete Free Transform tool.
  Eight layer transform handles, transform origin, interactive rotation,
  skew/distort/perspective, flips and Apply/Cancel for layer transforms remain next.
- Warp mesh/control points/interpolation/persistence remain missing; no warp tool
  is advertised. Destructive crop is deliberately not exposed.
- Straightening uses the browser's native-size affine raster sampling before the
  selected image-size filter. Arbitrary-angle preview is geometrically accurate,
  but it is not a high-order rotated reconstruction filter.
- Image resizing resamples the completed composite. Enlarging it does not rerender
  vector/text layers at a higher internal resolution; SVG preserves vector scaling.
  Per-layer resampling, alternate canvas anchor positions, pixel-aspect/DPI,
  ICC/linear-light filtering and tiled/unlimited-resolution processing are missing.
- Undo history remains session-only (50 metadata steps), as in the existing engine.
  Saving/reopening preserves the applied geometry, not the prior history timeline.
