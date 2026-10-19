# Pro editor: clean-room functional reference analysis

Reviewed 2026-10-19. Sources are Adobe's public Help Center documentation, not
application binaries, licensed application sessions or internal APIs. Live Adobe
application inspection was unavailable. No proprietary source, branding, icons,
interface artwork or file-format internals were obtained or copied.

## Public sources and findings

| Source | Observable workflow / design consequence |
| --- | --- |
| [Photoshop Layers panel](https://helpx.adobe.com/photoshop/using/layer-basics.html) | Layers have independent visibility, order, opacity and grouping. Keep document stacking separate from chapter image order. |
| [Photoshop layer masks](https://helpx.adobe.com/photoshop/using/masking-layers.html) | A mask controls visibility without deleting source pixels. Store selection geometry and brush commands separately from original image bytes. |
| [Photoshop undo/redo](https://helpx.adobe.com/photoshop/using/undo-history.html) | Reversible document actions are separate from canvas navigation. Group one pointer gesture into one history entry; do not copy full image buffers for every move. |
| [Illustrator drawing modes](https://helpx.adobe.com/illustrator/using/drawing-basics.html) | Object order determines drawing in front/behind. Explicit object hierarchy is preferable to destructive raster flattening. |
| [Illustrator anchor editing](https://helpx.adobe.com/illustrator/using/editing-paths.html) | Anchor points and direction handles remain editable. A path is geometry, not a screenshot of a line. |
| [Illustrator saving artwork](https://helpx.adobe.com/illustrator/using/saving-artwork.html) | Editable authoring data and interchange/export formats have different guarantees. Keep a native document, raster composite and vector-only SVG as distinct actions. |

These pages were fetched successfully and their titles/headings checked. Their
functional ideas inform original code. This is not a claim of exhaustive Adobe
feature parity, matching rasterization, or knowledge of Adobe internals.

## Functional analysis across workflows

Workspace: stable canvas and contextual settings, tool selection, layers,
properties and history are more useful than unrelated filter dialogs. On small
screens, the canvas stays above a switchable properties/layers drawer. Frequently
used tools need keyboard and touch access. Navigation transforms must never alter
saved image dimensions; pointer positions must use the inverse viewport/object
transform.

Compositing: ordered, isolated layers allow opacity, standard blend modes, hidden
and locked content, and groups. Masks affect alpha; erasing a paint layer must not
erase lower layers. Original pixels remain an immutable asset. Advanced clipping,
Photoshop-specific blend semantics and smart objects require separate work.

Selections/brushes: rectangle, ellipse and polygonal/freehand regions combine in
image coordinates, then become masks or constrain paint. Painting stores pressure-
independent brush commands with size, hardness, opacity and flow; erasing is an
explicit operation. Clone/heal tools require source sampling and context, not a
button that only changes a cursor. Existing Inkstrip texture repair is retained
and labeled as a traditional algorithm, never generative AI.

Vectors: shapes, fill/stroke, transforms, groups and editable text can share a
compositor. Native cubic Bézier anchors store incoming/outgoing control points.
Direct selection changes those points; it does not rasterize the object. Aligning
and grid snapping use document coordinates. Arbitrary boolean path geometry,
advanced typography and external-font layout are separate engineering projects.

History/persistence: keep metadata snapshots with bounded undo, immutable blobs,
transactional saves, conflict checks and native document backup. Existing chapter
originals must survive a flattened Pro result. A native Pro file is not PSD or AI.

Export/performance: derive PNG/JPEG/WebP from accepted document state at explicit
dimensions. Export supported vector content as escaped SVG without scripts,
embedded HTML or external resources. Do not silently drop raster content: label
vector-only export and reject unsupported masks/blends. Preview downsampling is
separate from full-resolution export. Workers, bitmap reuse, bounded temporary
canvases and explicit memory errors protect interaction latency.
