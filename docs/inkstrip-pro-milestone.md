# Pro Studio milestone 1 — layered documents

This is a functional, independently testable extension of Inkstrip, not full
Photoshop/Illustrator parity. It is based on GitHub main
`0551f0dfbddc32977b7160d77d6dd53c9da545bb`. Existing chapters, single-image
editing, Swin2SR, retouch, character profiles, batch and export stay available.

## Use the workspace

Import/open a chapter image, then choose **Pro Studio · layers & vectors** for
the first checked image, or use an image's long-press/right-click tools menu to
open that specific image in Pro Studio. It starts from the current accepted
image, including accepted legacy edits. It does not overwrite the chapter.

- Left tools: move, hand, paint/erase, eyedropper, rectangle/ellipse selection,
  freehand/polygonal lasso, rectangle/ellipse/line/polygon, cubic pen, direct
  anchor selection and text. Hover titles show shortcuts; V/H/B/E/I/M/L/R/O/P/A/T
  select tools outside text fields. Space pans, wheel zoom is cursor-centered,
  and two-finger touch pinches without creating accidental strokes.
- Add a paint layer before painting (choosing a paint tool on another object
  creates one). Brush hardness, whole-stroke opacity and per-dab flow are real,
  independent controls. Erasing affects the paint layer, leaving lower artwork.
- Layers hold visibility, inherited group locks, rename, opacity and normal /
  multiply / screen / overlay / darken / lighten blend modes. Desktop rows drag
  to insert in the stack; arrows work by touch/keyboard. Duplicate/delete and
  Shift-select grouping are reversible. Groups isolate compositing; transforms
  stay on child objects. Ungrouping refuses effects that cannot be preserved.
- Properties edit transforms, text and vector appearance. Move snaps to a 10px
  document grid and center guides; grid and snap agree at every zoom. The
  southeast handle scales an object; precise width/height/rotation fields are
  available. Navigator click recenters the canvas. Panels collapse and their
  desktop width can be adjusted with a keyboard-accessible slider.
- Selections add/subtract/intersect, invert, feather, or select all. Polygonal
  lasso finishes with Enter/double-click/Finish. Masks store local selection and
  brush commands, support inversion/enable/remove and reveal/hide brush work.
  Rotated selections map all corners into object coordinates; ellipses use a
  96-segment boundary when converted to a local mask. Source pixels remain intact.
- Pen click creates anchors; drag creates mirrored incoming/outgoing handles.
  Direct select moves anchors/handles. Close path is explicit. Shapes retain
  fill/stroke and transforms. Editable multiline text retains font, size, weight,
  spacing, line height, alignment and color in saved/native documents.
- Bubble, thought, shouting and caption presets are editable vector geometry.
  Dialogue text is a separate text object; group the objects for hierarchy and
  shared visibility/opacity. Bubble tails are numeric properties.
- Adjustments use the existing traditional pixel engine (brightness, contrast,
  exposure, saturation, temperature, sharpening, noise reduction, box blur), plus
  original RGB hue rotation, levels/gamma and a five-point piecewise-linear tone
  curve. Black/white sets saturation to -100. None is labeled generative AI.

## Save, recover, apply and export

Autosave after idle and **Save draft** keep the editable Pro document on this
device. Back to chapter waits for saving. These do not apply pixels to a chapter.
History has up to 50 metadata states; pointer gestures are one step, navigation
is separate, and original Blob bytes are not duplicated in every history entry.

**Apply to chapter** first saves the Pro draft, renders a native-size PNG in the
worker and uses the existing expected-revision media transaction. Chapter original
recovery remains intact. Cancel applies to the render stage; once the atomic
chapter save starts it must finish. A changed chapter image or another tab's Pro
save blocks overwrite. A quota/validation failure leaves accepted artwork intact.
Errors offer a native recovery export and explicit confirmed leave-without-saving.

Export choices: native `.inkstrip` (editable metadata and embedded raster bytes),
PNG/JPEG/WebP full-resolution composite with quality controls, and **SVG · vectors
only** (raster/paint excluded explicitly). JPEG fills transparent background white.
Unsupported encoders show an error, rather than saving PNG under a WebP name.
Changing canvas size is explicit, does not resample source assets, and is undoable.

Native import validates version, ranges, references, budgets and assets. It
replaces only the editable Pro draft; the chapter stays unchanged. PNG/JPEG/WebP
assets become independent layers. SVG import is a strict unitless basic-vector
subset: shapes, paths, simple text, translate/scale/rotate. Scripts, HTML, external
references, event/style attributes, entities, images, filters, masks, reflected /
skewed transforms and unsupported group opacity are rejected. Markup is never
inserted into the page. SVG export refuses unsupported vector effects instead of
silently dropping them. Use native format for complete fidelity and multiline text.

The Assets panel browses existing project-isolated character references and can
place a reference as a raster layer. It never guesses identities. AI tools first
apply the current composite, then open the established Swin2SR/image-tools/Face Fix
workflow. These are explicit handoffs, not a new AI inference engine or automatic
transfer of Pro masks. Existing cloud modes still require explicit upload consent.

## Performance, compatibility and privacy

Separate browser database `inkstrip-pro` v1 owns self-contained assets. Existing
`inkstrip` v1 records/schemas and their garbage collection are unchanged. Legacy
panels open without migration or mutation; byte-exact originals remain recoverable.
Worker rasterization reuses decoded sources, transfers bounded preview bitmaps,
closes them after display and frees scratch canvases. Low-opacity brush scratch
buffers cover only stroke bounds. Expensive export is cancellable by terminating
its worker. No pixels are uploaded by this workspace.

Limits: 48 layers, 64 raster assets, 48MB embedded compressed assets, 100k brush
points, 16384px canvas side, 16MP desktop canvas/layer; conservative coarse-pointer
or low-memory devices use a 4MP canvas/layer cap. Combined decoded-source budgets
are bounded too. Large native imports may exceed a phone's practical memory even
within file caps. Errors offer smaller documents or existing bounded chapter strip
exports; output resolution is never silently reduced. Pro previews cap their long
side at 1400px; raster exports use exact document dimensions. Current Workers,
OffscreenCanvas, createImageBitmap and Canvas2D are required. WebGPU is not needed.

No new dependencies, secrets, environment variables, server services, Vite/Nitro /
Vercel settings or credentials are required. Existing cloud AI configuration and
model/license limitations are unchanged. See previous phase documentation.

## Explicitly deferred scope

| Area    | Still requires further development                                                                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raster  | Clone stamp, new healing/blur/sharpen brushes, move/cut selected pixels, clipping layers, Gaussian blur (current blur is box blur), full histogram/curves UI, smart objects and large-document tiled compositor |
| Layers  | Touch drag reordering of Pro layer rows (arrows work), arbitrary nested group creation/whole-group transforms, multi-object transforms/distribution, saved history across reload, named snapshots               |
| Vectors | Boolean path operations, arbitrary SVG/CSS/filter interchange, adding/removing existing path anchors, text flow/wrapping, font embedding, rich typography and PSD/AI formats                                    |
| Manhwa  | Dedicated Pro panel-split/merge/page object model, linked bubble-text layout and automatic character session presets. Existing chapter ordering, stitching and export remain functional.                        |
| AI      | In-canvas integration of legacy masks and AI result layers, new GPU/segmentation/generation models. Existing explicit AI handoffs work; no new face generator is claimed.                                       |
| QA      | Physical Android, Safari/Firefox, real GPU devices, paid cloud model output quality and sustained FPS benchmarks were unavailable.                                                                              |

## Verification

`npm run test:pro` tests document validation, geometry, path handles, layer ordering,
groups/locks, native serialization, SVG escaping, alpha/tone behavior and worker
cancellation. `npm run test:pro:browser -- http://127.0.0.1:8081` uses isolated
Chromium profiles, real worker pixels and CDP native touch events. It exercises
brush/erase/history, masks/selection boolean operations, blending/groups, cubic
anchors, text recovery, unsafe SVG rejection, native source bytes, PNG/JPEG/WebP
dimensions/transparency, expensive export cancellation, atomic quota rollback,
cross-tab revision conflicts, recovery export and safe chapter application.

Run the existing full unit/build/lint/Vercel and browser suites too. Screenshots
use only isolated synthetic artwork generated by QA; no projects are seeded into
the product. See the final delivery report for actual commands and results.
