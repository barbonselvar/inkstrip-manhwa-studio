# Creative editor feature inventory and clean-room implementation brief

Research date: 2026-10-20. This document records observable, documented
Photoshop and Illustrator workflows for planning original Inkstrip functionality.
It does not use Adobe source code, private APIs, assets, icons, branding, or
reverse-engineered file internals. It makes no claim of Adobe feature parity.

## Phase E implementation status (2026-10-23, development branch)

The historical inventory below is superseded for the Raster areas described in
[the Phase E audit](PHASE_E_RASTER_REFINEMENT.md). Implemented: source-resolution
morphology/local color matting and staged refinement; named selections; seeded
brush dynamics and eight factory recipes; mask density/feather/linkage/copy/paste,
group masks, thumbnails and undoable baking; native v5 with v1–v4 compatibility;
bounded high-resolution processing and measured native exports. Release status and exact deployment evidence are recorded in
[PR #4](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/4); the feature
inventory alone does not establish a deployment.

Limited: color-based hair refinement needs contrast and a useful rough selection;
affine mask placement, finite nonlinear source frames, 1,400-pixel previews,
device/payload budgets and sRGB Canvas color. Missing: semantic model selection,
matte color decontamination, sampled-image brush tips, stationary airbrush timing,
CMYK/ICC soft proofing and an unlimited/disk-backed tile compositor. These are not
advertised as implemented. Existing Phase D vector and AI functionality is retained;
Phase F has not begun.

## Repository snapshot and implementation baseline

- Repository: `barbonselvar/inkstrip-manhwa-studio`; default branch `main`.
- Original audited base: `75d3ea76298ce951d5b164d82c4b498a72efc886`.
- Selection milestone starts from verified remote development head `72c14ffb290b8d1518e7e34b473cb0dc0d60db81`.
- The state column includes development-branch changes described below.
- Stack: React 19, TanStack Start/Router, TypeScript, Vite 8, Radix UI, Zustand,
  Canvas 2D and worker modules; the homepage uses Three.js/WebGL.
- Chapter images are panel records in IndexedDB. `ChapterStudio` mounts the
  existing Pro Workspace from a selected panel.
- Pro documents keep imported source bytes as an image layer, document metadata
  and session-only undo history; `inkstrip-pro` IndexedDB sessions persist the
  current document with transactional revision
  checks. The renderer exports full-resolution raster images, native `.inkstrip`
  documents and supported vector/text SVG. Application to a chapter is explicit
  and guarded by an expected-media revision check.
- Existing Pro tools include move/hand, brush/eraser, eyedropper, rectangle,
  ellipse, line, polygon, pen/direct selection, text, rectangular/elliptical
  selection, lasso, layer masks, groups, blend modes, tonal adjustment fields,
  comic bubbles/captions, character assets, AI workflows and recovery/export UI.
- Raster and vector are presented as distinct entry modes on this branch, backed
  by the existing shared Pro document engine. Raster opens with the brush
  workspace; Vector opens with the pen workspace and a vector-focused tool rail.
  The mode switch retains the same document and editable layers. This is not
  full parity with either Adobe application.
- AI: Swin2SR runs in a browser worker; face detection is a local proposal flow;
  texture repair is a traditional local image algorithm; optional cloud editing
  requires the existing consent flow. The 3D homepage companion uses Three.js.

Complexity key: **S** small, **M** medium, **L** large, **XL** research-heavy.
Validation is a proposed acceptance check for a future implementation; deferred
rows are not current product claims.

## Photoshop functional inventory

| Area / feature                        | Expected observable behavior                                                                                                                                                                     | Engine capability                                                                   | Effort | Validation criterion                                                                          | Inkstrip development state                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace, panels, contextual options | Tool selection exposes relevant options; panels can be shown, hidden and arranged; documents can be tabbed                                                                                       | Responsive workspace shell, persisted layout, commands and focus management         | L      | Switch tool, resize viewport and reopen without losing document state                         | Partial: editor dialog, tool rail, inspector tabs; no custom dock system or tabs                                                                                                                                                                                                                                                                                                          |
| Tool discovery and shortcuts          | Searchable or discoverable tools, shortcut help, configurable key maps                                                                                                                           | Command registry, keymap resolver, conflict-safe editable bindings                  | M      | Every listed shortcut invokes the same command as its button; inputs retain normal typing     | Partial: core keyboard shortcuts only                                                                                                                                                                                                                                                                                                                                                     |
| Raster document and canvas            | Open full-size image; navigate with zoom/hand; show pixel dimensions and fit/actual-size controls                                                                                                | Canvas renderer and coordinate transforms; safe decode limits                       | M      | Input dimensions and exported untouched pixels match source                                   | Implemented: panel dimensions and source image layer; viewport controls exist                                                                                                                                                                                                                                                                                                             |
| Raster layers and groups              | Create, reorder, rename, hide, lock, group and adjust opacity/blend mode                                                                                                                         | Ordered scene/compositing model; nested traversal and transactions                  | L      | Layer order and visibility match the composite before/after save and reopen                   | Implemented layer-management milestone: hierarchy, multi-selection, duplication, links, clipping, merge/flatten and touch insertion; direct raster-pixel painting/channels remain partial                                                                                                                                                                                                 |
| Clipping, linking, merging            | Constrain upper content to lower alpha; link transforms; merge selected layers on request                                                                                                        | Alpha compositing, dependency graph, destructive merge command with undo            | L      | Clipped output respects lower alpha; merge can be undone; unrelated layers survive            | Implemented: alpha-preserving clipping, linked movement, guarded selected/visible merge and confirmed flatten; see ADVANCED_LAYER_ENGINE.md                                                                                                                                                                                                                                               |
| Pixel and vector layer masks          | Hide/reveal with grayscale masks and editable mask painting; invert or disable mask                                                                                                              | Separate mask surface/commands in document graph                                    | L      | Mask edits are undoable and source pixels remain identical                                    | Partial: selection/brush masks exist; channel/mask panel parity absent                                                                                                                                                                                                                                                                                                                    |
| Marquee and lasso selections          | Rectangular, elliptical, freehand and polygonal regions; add/subtract/intersect                                                                                                                  | Document-space selection paths, rasterization, boolean region composition           | M      | Selection hit-tests and operations survive zoom/transform and constrain paint                 | Implemented: rectangle, ellipse, freehand/polygonal selections; boolean operations, coverage preview, undo/redo and native persistence                                                                                                                                                                                                                                                    |
| Magic wand / color range              | Select connected or tolerance-matched colors                                                                                                                                                     | Flood-fill and color-distance kernels; optional connected-component processing      | L      | Known fixtures select only pixels within defined tolerance/connectivity                       | Implemented: full-resolution visible-composite sampling, seed-relative tolerance 0–255, four-connected wand or non-contiguous color range, optional boundary anti-aliasing                                                                                                                                                                                                                |
| Quick selection / object selection    | Add/remove a subject using brush or object proposal                                                                                                                                              | Segmentation proposals plus editable mask; local or explicitly authorized inference | XL     | Proposal boundaries are editable; no AI capability is claimed without an actual model         | Deferred; local face proposals exist for a separate feature                                                                                                                                                                                                                                                                                                                               |
| Select and mask refinement            | Feather, smooth, expand/contract, edge refine, preview against backgrounds                                                                                                                       | Selection morphology, distance transforms and edge-aware mask processing            | L      | Numerical parameters produce deterministic masks and undo restores the previous mask          | Partial: feather, inversion, add/subtract/intersect and combined coverage preview; no morphology or edge-refinement brush                                                                                                                                                                                                                                                                 |
| Brush and pencil                      | Paint strokes with size, hardness, opacity/flow, color, smoothing and custom tip                                                                                                                 | Stroke sampling, dab engine, deterministic raster worker; optional pressure events  | L      | Pointer stroke, undo/redo, source preservation and reopen are verified                        | Partial: editable round brush/Pencil strokes, pen-pressure size, coalesced input, smoothing, hardness/opacity/flow and presets; spacing/scatter/tilt/rotation dynamics remain missing                                                                                                                                                                                                     |
| Stylus pressure / tilt                | Map pressure/tilt to size, opacity, angle or flow when supported                                                                                                                                 | Pointer Events pressure/tilt normalization and device capability fallback           | M      | Mouse fallback remains stable; pressure changes a measured stroke property                    | Partial Phase A: real pen-pressure size, coalesced input and smoothing implemented; tilt and advanced dynamics remain missing.                                                                                                                                                                                                                                                            |
| Clone stamp                           | Sample a chosen offset and paint sampled source pixels                                                                                                                                           | Source-aware raster sampling, brush kernel and transaction history                  | L      | Sample offset produces expected pixels; repeated strokes are deterministic                    | Implemented: full-resolution merged-composite snapshots, desktop Alt/Option and touch source selection, aligned/non-aligned offsets, adjustable round brush, transformed target-layer mapping, undoable native strokes                                                                                                                                                                    |
| Healing / spot healing / patch        | Blend texture and tone from surrounding regions or selected patch                                                                                                                                | Texture analysis, patch matching and edge blending; distinct from generative fill   | XL     | Fixture-based before/after metrics and explicit boundary review                               | Implemented Phase A: automatic local donor search, rectangle Patch Repair, spatial Healing Brush, selection/mask clipping and native-resolution texture snapshots; advanced seam/semantic reconstruction remain missing                                                                                                                                                                   |
| Blur / sharpen / smudge               | Apply localized brush kernels                                                                                                                                                                    | Separable convolution or GPU kernels with mask/brush clipping                       | M      | Known impulse fixture matches reference kernel and is undoable                                | Deferred as dedicated Pro tools                                                                                                                                                                                                                                                                                                                                                           |
| Dodge / burn / sponge                 | Lighten, darken or alter saturation locally with range/exposure controls                                                                                                                         | Linear-light or documented pixel operations and brush masks                         | M      | Numeric fixture confirms selected tonal range and opacity behavior                            | Deferred                                                                                                                                                                                                                                                                                                                                                                                  |
| Gradient and bucket                   | Apply editable gradient fills or flood-fill contiguous regions                                                                                                                                   | Gradient interpolation, color-space handling, fill tolerance and region boundaries  | M      | Stops and fill regions match test fixtures and persist natively                               | Implemented editable standalone linear/radial gradient layers and Gradient Map stops/presets; bucket fill remains missing                                                                                                                                                                                                                                                                 |
| Transform / crop / straighten         | Scale, rotate, skew, distort, perspective-warp, crop and straighten non-destructively where feasible                                                                                             | Affine/projective matrices, resampling filters, crop metadata and preview           | L      | Transformation round-trips, canvas bounds and export dimensions are correct                   | Implemented crop/output sizing and Phase B2 active-layer Free Transform: move/scale/rotate/flips/pivot, skew/shear, real perspective and bounded 3×3 Bézier warp. Affine group/multi-object transforms and filtered projective minification are implemented; group perspective/warp, larger meshes and projective SVG remain missing; see PRO_COLOR_ENGINE.md.                            |
| Rulers, guides, snapping              | Show rulers/guides and snap to canvas, guides or objects                                                                                                                                         | Coordinate overlays and spatial hit testing                                         | M      | Guides do not appear in exports; snap targets are predictable and toggleable                  | Partial: grid and smart snapping toggles                                                                                                                                                                                                                                                                                                                                                  |
| Image/canvas size                     | Resize pixels separately from canvas bounds; preserve aspect constraints and interpolation settings                                                                                              | Resampler, bounds model, memory guard and explicit resolution units                 | L      | Pixel dimensions change as requested; canvas expansion retains placement                      | Implemented output sizing: aspect lock, nearest/bilinear/bicubic/Lanczos 3, premultiplied alpha and high-quality downscaling. Separate top-left canvas sizing retains native layer geometry; per-layer resampling and other canvas anchors remain missing.                                                                                                                                |
| Tone / color adjustments              | Brightness/contrast, exposure, levels, curves, hue/saturation, vibrance, balance, selective color, channel mixer, mono, threshold, posterize, gradient map, shadows/highlights, temperature/tint | Non-destructive adjustment stack, color transforms and consistent preview/export    | XL     | Golden-image fixtures test each operator and stack order at output resolution                 | Partial: non-destructive brightness, contrast, exposure, saturation, temperature, hue rotation, black/white/gamma levels and a five-point curve; plus per-layer Color Balance, Vibrance, Gradient Map, Threshold, Posterize, Channel Mixer and pointwise Shadows/Highlights; independent masked/clipped adjustment layers are implemented; channel-specific curves and ICC remain missing |
| Color models and profiles             | Manage foreground/background colors, swatches, RGB/CMYK/gray and embedded profiles                                                                                                               | Color management with profile-aware conversion; explicit unsupported-mode behavior  | XL     | Profile-tagged fixtures retain predictable appearance; unsupported conversion is reported     | Partial: simple hex RGB color UI; no embedded profile workflow                                                                                                                                                                                                                                                                                                                            |
| Channels and paths                    | Inspect color/alpha channels; save selections; convert paths/selections                                                                                                                          | Channel storage and raster/vector conversion                                        | L      | Saved alpha selections reopen exactly; path conversion preserves geometry within tolerance    | Partial: paths are editable vector objects; no channel panel                                                                                                                                                                                                                                                                                                                              |
| Filters and filter stack              | Preview and reorder blur, sharpen, noise, distortion, pixelation, edge, stylize, lighting and effects without destroying input                                                                   | Filter graph, deterministic CPU/GPU kernels, cache and invalidation                 | XL     | Stack reorder changes output predictably; disabling a filter restores prior result            | Partial: limited adjustment effects; no general editable filter graph                                                                                                                                                                                                                                                                                                                     |
| Liquify / deformation                 | Push, bloat, pucker or warp pixels with a brush and mesh preview                                                                                                                                 | Deformation mesh, inverse mapping and tiled resampling                              | XL     | Fixed control gestures match deterministic mesh fixture; operation is undoable                | Deferred                                                                                                                                                                                                                                                                                                                                                                                  |
| Layer effects                         | Non-destructive shadow, glow, bevel/emboss, pattern and gradient overlays                                                                                                                        | Style graph with blend/clip semantics and renderer parity                           | XL     | Style parameters render consistently in preview, save/reopen and export                       | Implemented: seven editable alpha-based effects, isolated style ordering, document-space sizes, padded native rendering; advanced blend/profile/style graphs remain missing                                                                                                                                                                                                               |
| Text and typography                   | Edit text content, font, size, weight, alignment, spacing, leading and transform                                                                                                                 | Font shaping/layout, Unicode, fallback and text object model                        | L      | Unicode sample lines reflow and export correctly with available fonts                         | Partial: editable basic text layer with small font family set                                                                                                                                                                                                                                                                                                                             |
| Smart embedded/linked assets          | Transform/filter embedded content while retaining source; update linked instances                                                                                                                | Immutable source asset graph, instance transforms and missing-link recovery         | XL     | Updating source updates instances; native reopen reports missing links safely                 | Partial: immutable embedded source and character assets, not linked Smart Objects                                                                                                                                                                                                                                                                                                         |
| Automation and batch                  | Repeat actions with recorded commands/actions, batch export and scripts                                                                                                                          | Serializable command graph, deterministic replay and permission sandbox             | XL     | Script/action fixture reproduces equivalent document; network/file access is constrained      | Partial: existing chapter batch editing; no macro/action scripting                                                                                                                                                                                                                                                                                                                        |
| File interoperability                 | Native editable file distinct from PNG/JPEG/WebP; PSD import/export only when actual layer semantics are verified                                                                                | Versioned format adapter, color/feature mapping and conformance suite               | XL     | Round-trip tested against documented fixtures; unsupported features are reported              | Partial: native `.inkstrip`, raster output; no PSD support                                                                                                                                                                                                                                                                                                                                |
| Performance and recovery              | Handle large images using budgets, incremental work, workers, checkpoints and crash recovery                                                                                                     | Tiling, dirty-region renderer, worker protocol, IndexedDB recovery journal          | XL     | Measured target workloads stay in stated memory/time budget; restart restores last checkpoint | Partial: worker rendering and local session persistence; no tiling/recovery journal                                                                                                                                                                                                                                                                                                       |
| Accessibility and touch               | Keyboard-operable panels, visible focus, screen-reader tool names, touch targets and reduced-motion behavior                                                                                     | Semantic controls, focus policy and pointer/touch abstraction                       | M      | Keyboard-only and mobile touch tests complete without lost operations                         | Implemented baseline: labeled tools/controls, keyboard shortcuts, touch handles/cancellation and desktop/320/390px tests; customizable shortcuts and physical-device coverage remain deferred.                                                                                                                                                                                            |

## Illustrator functional inventory

| Area / feature                        | Expected observable behavior                                                                                                                        | Engine capability                                                                   | Effort | Validation criterion                                                                | Inkstrip development state                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace, contextual properties      | Toolbar, artboard, layers, appearance, color, stroke, transform, align, typography, symbols, brushes and properties respond to selection            | Responsive panel framework, selection model, tool registry and layout persistence   | L      | Selection updates contextual controls; layout works at desktop and mobile widths    | Partial: shared Pro canvas and inspector tabs; no dedicated vector panel suite                                                                                                                   |
| Artboards                             | Create, select, rename, reorder, resize and export multiple bounded artboards                                                                       | Artboard model, document-space clipping and independent export targets              | L      | Objects retain coordinates on artboard changes; exported bounds match chosen target | Implemented C: multiple native artboards, editing, presets and independent/range exports; shared artwork                                                                                         |
| Selection / direct selection / groups | Select objects, groups, points and handles separately; marquee and magic wand selection                                                             | Scene graph, hit testing, selection state and path-node editing                     | L      | Object selection and node selection target distinct entities                        | Partial: layers/shape select and direct point mode; no complete group/magic-wand behavior                                                                                                        |
| Pen and curvature tools               | Draw cubic Bézier paths, add/remove/convert anchors and adjust handles                                                                              | Stable path geometry and pointer-driven node/handle interaction                     | L      | Known control points generate expected SVG path data and render within tolerance    | Partial: pen paths and anchor editing exist; curvature tool deferred                                                                                                                             |
| Pencil / smooth                       | Draw freehand paths and smooth/simplify them while retaining shape intent                                                                           | Input sampling, curve fitting and path simplification                               | M      | Smoothing reduces node count while bounded Hausdorff deviation is maintained        | Deferred                                                                                                                                                                                         |
| Scissors / knife / join               | Split paths at intersections or join compatible endpoints                                                                                           | Robust intersections, subpath decomposition and endpoint snapping                   | XL     | Geometry fixtures preserve fill and expected open/closed state                      | Deferred                                                                                                                                                                                         |
| Primitive shapes                      | Rectangle, rounded rectangle, ellipse, polygon, star, line, arc, spiral                                                                             | Parametric path generation with editable parameters                                 | M      | Each primitive exports as correct geometry and transforms without rasterization     | Partial: rectangle, ellipse, line, polygon; other primitives deferred                                                                                                                            |
| Cubic/open/closed paths               | Keep anchors and handles editable; open and closed paths render with proper fill rules                                                              | Path graph, fill rules, geometry validation and SVG serialization                   | L      | Edit-save-reopen retains anchors/handles and open/closed state                      | Implemented A/D: editable cubic contours, handles, fill rules and baseline geometry retained through native history and supported SVG.                                                           |
| Compound paths / joining / splitting  | Combine holes and subpaths; join or split selected segments                                                                                         | Winding/fill-rule handling, topology and intersection calculations                  | XL     | Donut/hole and self-intersection fixtures render and serialize consistently         | Implemented A: editable compound contours, holes and winding; joining/splitting deferred                                                                                                         |
| Simplify / offset / outline           | Reduce nodes, expand paths by offset, and convert strokes into path outlines                                                                        | Curve fitting, offset curves, joins/caps and robust boolean cleanup                 | XL     | Geometry stays within stated tolerance and has no unintended self-crossings         | Deferred                                                                                                                                                                                         |
| Boolean path operations               | Unite, subtract, intersect, exclude, divide, trim and merge actual vector regions                                                                   | Robust planar arrangement and fill-rule geometry, not visual stacking approximation | XL     | Reference geometry cases pass area, topology and boundary tests                     | Implemented B: seven bounded approximate filled-region Boolean operations; explicit eligibility limits                                                                                           |
| Appearance stacks                     | Multiple fills/strokes per object, opacity, blend, styles and ordered effects                                                                       | Ordered appearance model and vector/raster effect renderer                          | XL     | Appearance order affects output predictably and survives native round-trip          | Implemented D: up to 16 editable ordered fills/strokes, opacity, visibility, six isolated paint blends, clipboard and native v4; raster effects remain separate.                                 |
| Stroke controls                       | Alignment, caps, joins, dashed patterns, width profiles                                                                                             | Stroke expansion and vector serialization                                           | L      | Dash/cap/join fixtures match defined paths at different zoom levels                 | Implemented D: inside/center/outside on closed contours, caps/joins/miter, dash/dots and editable gradient strokes; variable width profiles remain missing.                                      |
| Gradients and patterns                | Linear/radial/mesh gradients and repeated pattern fills                                                                                             | Gradient stop model, pattern tile assets, mesh interpolation                        | XL     | Stops/pattern transforms remain editable and raster/vector exports agree            | Implemented D: linear/radial paints, stops/opacity, affine matrices and canvas handles; mesh/repeating pattern fills remain deferred.                                                            |
| Typography                            | Point, area and path text; font management, shaping, wrapping, kerning, tracking, leading, baseline, paragraph styles, outlines and reusable styles | Unicode text shaping, font measurement, path layout and optional outline conversion | XL     | Script-mixed text fixtures preserve line breaks, glyph order and export appearance  | Implemented D: editable ordinary/path text, grapheme-aware bounded curve metrics, offsets/alignment and SVG textPath; area text, contextual/RTL path shaping and embedded fonts remain deferred. |
| Pathfinder                            | Unite/subtract/intersect/exclude/divide object sets with editable resulting paths                                                                   | Same robust boolean kernel as path operations                                       | XL     | Geometry fixtures and undo/redo confirm topology and appearance                     | Implemented B: editable vector output with adaptive curve approximation and cancellable worker                                                                                                   |
| Symbols and instances                 | Define reusable vector symbols, place linked instances and edit source                                                                              | Symbol definition graph, overrides and safe relinking                               | L      | Editing symbol definition updates instances while preserving local transforms       | Deferred; existing character-image assets are not vector symbols                                                                                                                                 |
| Brushes                               | Calligraphic, scatter, art and pattern brushes with editable stroke geometry                                                                        | Brush stamping/repetition along paths and parameterized appearance                  | XL     | Spacing/rotation/scale fixture matches a deterministic path sample                  | Deferred: no vector brush engine; raster pen pressure and smoothing do not implement editable vector brush strokes                                                                               |
| Blend and envelope distortion         | Interpolate objects along blend steps or deform artwork into envelopes                                                                              | Correspondence mapping, interpolation and warp surface                              | XL     | Intermediate object count, endpoints and bounds match test cases                    | Partial: shared raster/native renderer supports bounded 3×3 Bézier layer warp; editable vector envelopes/blends and deformed SVG export remain missing.                                          |
| Clipping / opacity masks              | Clip groups to vector shapes or apply editable opacity masks                                                                                        | Clip graph and alpha compositing with SVG equivalents where possible                | L      | Hidden content remains editable and mask changes are reversible                     | Partial: raster masks and editable imported binary vector clips/masks; graded/multi-object group-alpha SVG masks are explicitly rejected.                                                        |
| Image trace / live paint              | Convert raster reference into editable paths or regions with adjustable thresholds                                                                  | Segmentation/vectorization, topology cleanup and region boundaries                  | XL     | Trace generates real editable paths; source image remains recoverable               | Deferred; no fake trace control                                                                                                                                                                  |
| Alignment, grids and snapping         | Align/distribute objects accurately; use guides, grids and snapping                                                                                 | Bounding boxes, geometry constraints and precision coordinate model                 | M      | Alignment centers and gaps match numeric expected coordinates                       | Implemented C: geometric align/distribute, cached snapping and guides; documented precision limits                                                                                               |
| Screens and production export         | Export selected artboards/assets at requested scales/formats; preserve editable native file                                                         | Export graph with feature validation and deterministic bounds                       | L      | Artboard and screen exports match requested dimensions; lossy options are explicit  | Implemented C–E: artboard/range PNG/JPEG/WebP, native v4 and guarded SVG paints/textPath/binary clips; explicit unsupported-feature errors.                                                      |
| AI interoperability                   | Read/write AI only with implemented format guarantees; do not disguise SVG as `.ai`                                                                 | Format adapters and explicit fidelity/conformance mapping                           | XL     | Verified samples round-trip with documented supported subset                        | Not supported; SVG is actual SVG only                                                                                                                                                            |
| Accessibility and touch               | Keyboard tools, focus states, screen-reader names, touch pen navigation and customizable shortcuts                                                  | Semantic tool registry, pointer support and accessibility controls                  | L      | Keyboard and stylus paths pass automated/manual interaction checks                  | Implemented baseline: labeled tools/controls, keyboard shortcuts, touch handles/cancellation and desktop/320/390px tests; customizable shortcuts and physical-device coverage remain deferred.   |

## Shared implementation direction

The current application uses Canvas 2D for raster compositing and SVG path data
for vector-like objects inside a shared versioned Pro document. This is the best
low-risk first browser renderer for device reach and export consistency. Keep the
existing Canvas 2D/worker path until benchmarks show a bottleneck; evaluate WebGL2
for large raster compositing and complex effects, then WebGPU only behind a
capability fallback. Use SVG as an interchange/export target, not as a claim of
Illustrator file compatibility. Prefer worker-side pixel operations, bounded
preview surfaces, immutable assets and metadata-based undo. Add a real path
boolean library only after reviewing its license and testing geometric edge
cases. Keep native Inkstrip documents versioned and migrate them explicitly.

The first launch mode does not need to dictate file compatibility. Raster and
vector entry modes can edit the same project safely while their tool/panel sets
grow; the original image remains available as a layer/reference and chapter
application stays an explicit action. Any feature whose engine is incomplete
must remain unavailable or clearly partial, never a decorative control.

## Public documentation used

- [Photoshop User Guide](https://helpx.adobe.com/photoshop/user-guide.html)
- [Photoshop tools and keyboard shortcuts](https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html)
- [Photoshop layers overview](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/get-started-layers/layers-overview.html)
- [Photoshop layer masks](https://helpx.adobe.com/photoshop/using/editing-layer-masks.html)
- [Photoshop smart filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html)
- [Photoshop color management](https://helpx.adobe.com/photoshop/desktop/adjust-color/color-profiles/color-management-in-photoshop.html)
- [Illustrator User Guide](https://helpx.adobe.com/illustrator/user-guide.html)
- [Illustrator tools](https://helpx.adobe.com/illustrator/using/tools-in-illustrator.html)
- [Illustrator workspace overview](https://helpx.adobe.com/illustrator/desktop/get-started/learn-the-basics/workspace-overview.html)
- [Illustrator paths and shapes](https://helpx.adobe.com/illustrator/using/artwork-essentials/paths-and-shapes.html)
- [Illustrator Pathfinder](https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/pathfinder-panel-overview.html)
- [Illustrator Image Trace](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/trace-images-to-convert-raster-into-vector-artwork.html)
- [Illustrator export](https://helpx.adobe.com/illustrator/using/exporting-artwork.html)

## Milestone 1 branch scope

This milestone adds two working chapter-image launch paths, visible from the
chapter selection controls and the individual image tools menu. Both open the
selected panel's original-size Pro document. A persistent Raster/Vector switch
changes the active tool palette and selects an appropriate starting tool;
switching never replaces the document or flattens layers. Existing Pro Studio,
save, undo/redo, export and explicit chapter-apply behavior remain the shared
foundation. Later milestones must add separately tested capabilities and update
the implemented/deferred matrix above.

## Milestone 2 progress (development branch)

- The existing layer model remains the shared editable document model. Grouping,
  sibling ordering, visibility, lock inheritance, opacity, supported blend
  modes, layer masks, transforms, history, autosave/recovery, and PNG/JPEG/WebP
  export are functional existing capabilities. They are not a complete
  Photoshop raster-layer system; general clipping masks, linked layers, merge,
  channels, and pixel-layer painting remain unavailable.
- Added a hard square-tip Pencil tool (`N`) that records an undoable stroke in
  the existing paint layer and renderer. Added three built-in brush presets
  plus named custom presets saved in browser-local storage. Brush strokes stay
  editable in the native `.inkstrip` document. These do not provide pressure,
  tilt, spacing controls, or a full brush dynamics engine.
- Added a Clone Stamp (`S`) that captures the visible merged composite as an
  immutable full-resolution PNG sample, then paints undoable strokes onto a
  paint layer. Source snapshots and stroke offsets persist as native assets;
  target layer transforms are handled by the renderer. Sampling uses the
  visible composite snapshot rather than a live current-layer source.
- Added a Healing Brush (`J`) that uses the same full-resolution sampled texture
  and brush mask as Clone Stamp, then shifts sampled RGB toward the target patch
  using deterministic local color adaptation. This is traditional pixel repair,
  not generative AI. Automatic Spot Healing and Patch Repair remain unavailable.
- Replaced the obsolete Webpack workflow with a Node 24 workflow matching
  `.nvmrc`; it installs from the lockfile and runs the app's TypeScript, Vite
  production build, and build configuration checks. Vite configuration and
  application build settings are unchanged.
- Earlier browser runs were blocked by missing Chromium. The selection milestone
  installs Chromium in its execution environment and runs real browser checks;
  see its validation report for results.

## Advanced selection milestone (System A)

Implemented on the existing shared Pro engine:

- Magic Wand (`W`) and Color Range analyze the visible composite in the worker at
  document resolution, independently of the bounded preview or navigation zoom.
  The wand optionally uses four-connected flood fill; Color Range finds all
  matches. Tolerance is the maximum difference in premultiplied sRGB/alpha
  channels, from 0 through 255, relative to the sampled pixel, without color drift.
- Optional anti-aliasing computes a symmetric one-pixel binomial coverage filter.
  This is boundary smoothing, not subject segmentation or edge matting.
- Add/subtract/intersect, inversion and feather work through the existing selection
  renderer. Operations after inversion preserve their boolean meaning. The blue
  overlay displays the composed mask, including holes and fractional coverage;
  it is excluded from exports. Feather extends document-edge coverage before blur.
- Active selection is optional document metadata. Completed gestures and color
  samples are single undo actions. Draft recovery, native save/reopen/import and
  existing stroke clips preserve the coverage. Old native documents still open.
- Brush, Pencil, Eraser, Clone Stamp, Healing Brush and selection-derived layer
  masks use the same selection renderer. Pixel frames map through layer transforms.
- Fixed an existing cache-ownership bug: Clone Stamp/Healing Brush no longer close
  borrowed worker bitmaps needed by redo, subsequent previews and exports.

Limits: existing document/device budgets remain 16 MP on desktop and 4 MP on
coarse-pointer/low-memory devices, up to 16384 px per side. Selections allow 100
regions, each capped at 200,000 nonzero row runs; highly fragmented masks fail
with an explicit error. There is no tiled or unlimited-resolution workflow.
Selection clips retain their document-space coordinate frame, applying boolean
operations and feather before mapping into transformed paint layers. Older clips
without a coordinate frame retain their original layer-local feather behavior.
Color sampling is merged-visible only; no current-layer sampler, perceptual/Lab
color distance, live tolerance reapplication, or Select-and-Mask edge refinement.
These limits do not imply Photoshop feature parity.

System B remains **partial**: single non-group layer duplication and the existing
compositor/groups/masks/history/native persistence are available. General clipping
masks, linked transforms, merge-selected and merge-visible remain **missing**.
System C remains **partial**: sampled Healing Brush with RGB mean adaptation is
available. Automatic Spot Healing, Patch Repair, local texture synthesis and
edge-aware blending in the Pro engine remain **missing**. Existing separate
retouch/AI workflows are preserved, not presented as these new Pro tools.
Future raster/vector features above retain their individual states.

Selection milestone validation:

- `npm run typecheck`: passes app and build-configuration TypeScript.
- `npm test`: 330 passing tests, including 31 Pro tests (9 new selection tests).
- `npm run lint`: passes with the existing Fast Refresh warning in `ui/button.tsx`.
- `npm run build` and `npm run check:build`: pass; no database URL is configured,
  so the supported build skips remote migrations and retains the PGLite fallback.
- `npm run test:pro:browser`: passes in installed Playwright Chromium, including
  real worker pixels, selection history/native reopen/PNG fidelity, transformed
  feather, source resolution above the preview limit, legacy tool regression,
  chapter isolation, AI handoff and touch interactions at 320/390 px.
- Desktop/mobile dev and built-output smoke checks show visible content, clean
  consoles, no page overflow and no final baseline divergence. A first built
  smoke run briefly missed the asynchronously initialized homepage canvas; a
  subsequent run found it with no application change. The generic branding
  heuristic reports existing game-card warnings because it detects a canvas;
  Inkstrip is an editor, so its metadata was not relabeled as a game.
- This verifies Chromium and emulated touch, not a physical Android device or
  every desktop browser. Browser checks are local; current Actions workflows
  run type/unit/lint/build checks and do not yet install Chromium.

## Advanced layer milestone (System B)

On top of verified selection head `72cb64c3d4e035ee6894eb55332002cb4676e695`, the shared layer engine now implements alpha-preserving clipping stacks, deep duplication, linked/multi-layer movement, consecutive merge-selected, merge-visible, confirmed flatten, layer thumbnails, context menus, nested group controls and mouse/native-touch insertion. Native metadata/history and the existing full-resolution compositor are shared by all workspace modes.

See [advanced layer semantics, safety guards and validation](ADVANCED_LAYER_ENGINE.md). Backdrop-dependent partial merges, nonconsecutive/cross-group merge selections and lossy ungrouping are explicitly refused. Links synchronize translation, not scale/rotation. Group transforms, channels, direct raster-pixel painting, tiled/unlimited documents and other deferred roadmap items remain outside this milestone. Earlier milestone inventories above are historical snapshots.

## Advanced raster repair milestone (Phase A, 2026-10-21)

Implemented on top of verified layer head `d8bb4090fd793df42c9eda49facc961d8ea9c3d0`:

- Automatic Spot Healing, user-defined destination/source Patch Repair and spatially varying Healing Brush, using real local texture sampling and normalized RGB tone adaptation. These are traditional algorithms, not generative AI.
- Selection-aware repair and painted mask editing; undo/redo, cropped immutable native-size repair assets, native save/reopen/import and shared raster export fidelity.
- Pen-pressure size and input smoothing with persisted stroke/preset metadata. Mouse/touch retain ordinary size. New sampled/repair textures retain a transform snapshot so they move with their layer.
- Chapter Raster/Vector launch controls remain visible on mobile without hover or desktop-only interactions. Touch repair/apply tests verify exact retained original bytes at 320px/390px.

[Repair algorithms, manual workflow, validation and limits](RASTER_REPAIR_ENGINE.md) documents the implemented scope. Automatic search is bounded to local translated patches and repair neighborhoods to one megapixel. Patch warping, Poisson/semantic reconstruction, advanced pen dynamics and physical-device validation remain missing. Older milestone paragraphs above are historical snapshots; the current layer engine remains implemented as documented in `ADVANCED_LAYER_ENGINE.md`.

Phase A is delivered. The Phase B crop/output-sizing increment below is implemented; the remaining Free Transform and warp systems are not complete. Advanced Phase C effects and remaining Phase D vector work are not represented as completed.

## Phase B — non-destructive crop and output sizing increment

Implemented: interactive eight-handle crop/move/freeform/aspect presets, numeric
crop dimensions, rotate/straighten, shaded boundaries/thirds, Apply/Cancel/reset,
undo/redo, native/local persistence and crop-aware raster/Chapter/SVG exports.
Image size supports aspect lock, nearest/bilinear/bicubic/Lanczos 3 output
resampling with scale-aware downscaling and premultiplied alpha. Canvas sizing
is separate, anchored at the top-left, and retains layer/source geometry.
Full-canvas selections, repair and Clone/Healing sampling remain independent of
output bounds. 320/390px Chromium touch checks cover handles and navigation.

Partial: existing layer move/scale/numeric rotation and snapping; geometry preview
rather than a full-size reconstruction preview; final-composite image resizing,
not per-layer resampling or higher-resolution rerendering of vector/text layers.
Missing: complete Free Transform Apply/Cancel, all layer handles, origin, flips,
skew/distort/perspective, warp mesh, alternate canvas anchors, ICC/linear-light
filtering and physical Android validation. No Photoshop feature parity claimed.

[Geometry architecture, validation and limitations](RASTER_GEOMETRY_ENGINE.md).
Next priority: a complete affine layer-transform transaction with touch handles,
origin, flips and consistent inverse mapping for editing/masks, before projective
transforms or warp.

## Phase B2 — active-layer affine, perspective and bounded warp

Implemented: live, non-destructive Apply/Cancel transactions; move, eight scale
handles, independent/aspect dimensions, rotation handle, flips, pivot, numeric
position/size/angle, sequential horizontal/vertical shear, modifier keys and
existing grid/center snapping. Shared forward/inverse mappings cover input,
hit testing, masks, selections, clipping, clone/repair snapshots and native
exports. Linked translation remains intact; original paths/text/assets and
layer relationships are retained. Perspective is actual homography sampling.
Warp is a smooth, editable nine-point quadratic Bézier surface with ±10%
control offsets and a positive-Jacobian guard. Both modes support native
save/reopen and history. 320/390px Chromium touch verifies actual handle edits
and navigation. Previous Phase B paragraphs describe the earlier increment.

Partial/missing: group/multiple-object Free Transform, larger/free-fold warp
meshes, simultaneous perspective-plus-warp, advanced minification, deformed
SVG export, ICC/linear-light processing, tiled/GPU processing and physical
Android testing. Affine SVG keeps vector/text geometry; projective/warp SVG is
explicitly refused. No Photoshop/Illustrator feature parity is claimed.

[Transform architecture, tests and limits](PRO_TRANSFORM_ENGINE.md).
Recommended next increment: group/multiple-object transform transactions and
quality/performance improvements for projective minification before expanding
warp complexity; Phase C color/effects remain subsequent work.

## Phase B finalization / Phase C color increment

Current behavior and limitations supersede the preceding B2 roadmap: see
[PRO_COLOR_ENGINE.md](PRO_COLOR_ENGINE.md). Affine group/multiple-object transforms
now preserve hierarchy, masks, clips, editable leaf geometry and isolated group
compositing in one undoable transaction. High-quality bounded projective
minification adds premultiplied multilevel footprint filtering.

Seven requested color operators now have editable per-layer parameters, numeric
controls, live preview, reset, captured-selection coverage, history, native
persistence and native-resolution raster rendering. Gradient Map includes
2–16 color/opacity stops and presets. Separate stack adjustment layers and group
adjustments remain missing; Shadows/Highlights is pointwise. Standalone gradient
layers (linear/radial, angle/scale/canvas controls) and editable layer effects are
**missing**, and are the next Phase C priorities. Group perspective/warp remains
missing; the existing individual warp mesh has not been expanded.

## Phase C completion

[Phase C layer contracts and limits](PHASE_C_LAYERS.md) supersede the earlier
missing states for standalone gradient layers, independent adjustment layers and
the seven requested editable layer effects. All are implemented in the existing
shared Pro engine, including native metadata, history, masks, clipping, group
semantics and native-resolution raster output. SVG representation remains missing
and is explicit rather than silently flattened. [Changelog](CHANGELOG.md).

Next: Phase D vector geometry, Boolean/compound paths, artboards, snapping,
appearance, text-on-path and SVG improvements. Existing cubic Pen/direct-anchor
editing must be extended rather than recreated.

## Phase D started (unreleased)

[Vector engine status](PHASE_D_VECTOR_ENGINE.md): exact cubic subdivision and
bounded-error arc metrics/inversion plus native subdivision transactions are
implemented and integrated into the existing Pen/Direct Select tools. Native
anchor selection, numeric coordinates/handles, corner/smooth/symmetric coupling,
canvas midpoint and numeric parameter/arc-distance insertion, reversal, guarded
deletion, history/native/export and touch 320px/390px checks are implemented.
Path editing remains **partial**: no multi-anchor selection, join/split paths or
conversion of imported raw SVG paths. Pathfinder, compound paths, artboards,
advanced snapping/appearance, text-on-path and SVG expansion remain missing or
partial as described there. Phase D is an unreleased draft; Phase C remains the
verified production release.

## Phase D Increment A — compound paths and SVG conversion (unreleased)

[Increment A contracts](PHASE_D_COMPOUND_SVG.md) supersede the previous missing
states for compound paths, fill rules and native SVG path conversion. Multiple
editable open/closed contours, holes/nesting, evenodd/nonzero rendering/hit tests,
create/release, subpath selection/editing, affine source-frame fitting, SVG command
conversion (including arcs), transform/viewBox/group/stroke handling and native
persistence are implemented. New feature files use a v2 envelope; legacy v1 files
remain supported. Native export no longer copies unused history assets.

Pathfinder, multiple artboards, precision snapping/distribution, multiple
fills/strokes, text-on-path and general SVG gradients/clipping/masks remain
**missing/partial**. Existing simple fill/stroke controls and captured SVG stroke
metadata do not imply complete advanced appearance. Phase D stays draft; no new
production release is claimed.

## Phase D Increment B — Pathfinder (unreleased)

[Pathfinder contracts](PHASE_D_PATHFINDER.md) supersede earlier missing Boolean
states. Unite, Subtract, Intersect, Exclude, Divide, Trim and Merge produce actual
editable vector regions using Clipper integer geometry and bounded adaptive cubic
approximation. Closed affine compound paths, holes, winding, neutral selected
groups, history/native/SVG and desktop/touch controls are implemented with explicit
relationship, precision and complexity guards. Original curves are approximated
by editable line anchors; no exact curve preservation or live Boolean stack is
claimed. Artboards, precision snapping, advanced appearance, text-on-path and
broader SVG compatibility remain missing/partial. Phase D remains draft.

## Phase D Increment C — artboards and precision (unreleased)

[Increment C contracts](PHASE_D_ARTBOARDS_PRECISION.md) supersede earlier missing
artboard/precision/alignment states. Implemented: multiple native artboards with
CRUD/order, numeric and touch move/resize, physical/pixel presets, optional
contained-artwork movement, fit/visibility, selected/range/all PNG/JPEG/WebP and
supported vector-only SVG exports, raster scale/alpha/clipping and native v3
persistence with legacy defaults. Original Chapter whole-canvas behavior stays
intact; board duplication copies boundaries, not artwork.

Implemented: zoom-aware grid, board, object, guide and anchor/endpoint snapping;
cached geometry, acquired Smart Guides and adjacent-peer equal-gap targets;
persisted grid/guides and guide locks; six geometric alignment operations relative
to selection/key object/board and selection center/gap distribution. Bounds exclude
stroke/effect expansion; perspective/warp cage snapping, tangent/curve-interior
snapping and richer measurement/spacing constraints remain partial/missing.

Next: **Increment D** multiple fills/strokes, stroke alignment, vector gradients,
appearance stacking and editable text-on-path; **Increment E** broader SVG,
performance/integration and complete release validation. Phase D remains draft.

## Phase D final implementation and release audit

[The final Phase D audit](PHASE_D_FINAL_RELEASE.md) supersedes the historical
increment inventories above for implemented functionality and explicit limits.
The existing Pen/anchor/compound/Pathfinder/artboard/precision systems are retained.
Multiple editable fills/strokes, vector gradient handles/stops, appearance stacking
and clipboard, editable text-on-path, native v4, expanded safe SVG interchange,
geometry caches and measured benchmarks are implemented. Release/production status
is established by the exact-SHA PR/CI/live record, not by this inventory alone.

Partial/guarded: SVG graded masks/group-alpha clips, external backdrop blending,
complex/contextual path text, embedded/custom fonts, non-linear SVG export,
repeat/reflect/mesh gradients, unlimited-size documents, and exact Boolean curve
preservation. See the audit for supported alternatives and rejection behavior.
Remaining Raster/AI work is a separate phase; no future AI tools are advertised.

## Cinematic homepage Release1 (2026-10-24)

Implemented: original nine-genre gallery, four multilingual dialogue composites,
three silent scenes, two action/SFX scenes, three-card CSS perspective,3s rotation,
keyboard/mouse/touch browsing, explicit and contextual pauses, reduced/quiet motion,
device-adaptive Aurora Flow and complete robot removal. Existing project library,
backup, stats, navigation, Chapter and editors remain intact. No native schema changes.

Validation and release evidence: `CINEMATIC_HOMEPAGE_RELEASE.md`. Physical Android
remains unverified. Dialogue Studio is a separate Release2 and must wait for
verified homepage production delivery; no OCR/translation/inpainting is claimed here.
