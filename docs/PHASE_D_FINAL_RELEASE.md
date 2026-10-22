# Phase D — vector engine release audit

This audit supersedes the incremental “unfinished/unreleased” inventories once
PR #3 has passed its final gates and merged. The release record is in the PR;
a build alone does not establish production deployment. The existing shared
Raster/Vector renderer, document model, immutable asset pool and history remain
in place. There is no claim of Illustrator feature parity.

## Implemented capabilities

| Capability               | Implementation and practical boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pen and direct selection | Existing cubic Pen, editable anchors/handles, corner/smooth/symmetric modes, exact subdivision/insertion, reversal and numeric geometry retained.                                                                                                                                                                                                                                                                                                                                        |
| Compound paths           | Native multiple open/closed contours, holes, even-odd/non-zero fills, editable individual subpaths, make/release and winding-aware hit tests retained.                                                                                                                                                                                                                                                                                                                                   |
| Pathfinder               | Seven real Clipper Boolean operations retained. Adaptive polygon approximation defaults to 0.1 document px; results are editable line anchors, not exact original cubics. Existing degenerate/complexity guards and worker cancellation remain. Advanced paint/mask relationships must be simplified explicitly before operations that cannot preserve them.                                                                                                                             |
| Artboards                | Up to 32 persistent movable/resizable/reorderable boundaries, presets/DPI, backgrounds, optional contained-artwork movement, viewport fit, individual/range/all exports retained.                                                                                                                                                                                                                                                                                                        |
| Precision                | Cached acquisition geometry, zoom-aware grid/object/anchor/artboard/guide snapping, smart guides, transformed alignment/distribution and persistent guides/settings retained.                                                                                                                                                                                                                                                                                                            |
| Multiple paints          | Up to 16 ordered editable fills/strokes per shape or text object. Visibility, independent opacity, duplicate/remove/reorder/reset, appearance clipboard and six isolated paint blend modes. Basic fill/stroke remains the backward-compatible fallback.                                                                                                                                                                                                                                  |
| Strokes                  | Centered strokes; inside/outside strokes on closed native shapes; width, colors/gradients, dash arrays/dots, offset, caps, joins and miter limit. Inside/outside alignment on open contours/text is explicitly disabled. Non-zero outside coverage retains overlapping contour topology.                                                                                                                                                                                                 |
| Vector gradients         | Linear/radial fills and strokes, 2–16 editable color/opacity stops, hard stops, presets, endpoints/center/focal/radius, angle, numeric affine gradient matrices, object-bound/user-space coordinates. On-canvas endpoints, center/radius and intermediate stops use inverse coordinates and one-step gesture history/cancellation. Pad spread; repeat/reflect/mesh gradients are unsupported.                                                                                            |
| Appearance UI            | Dedicated responsive panel with real stack controls, paints/strokes, numeric gradient editor and on-canvas G tool. Imported binary clipping geometry can be enabled, disabled or removed without changing underlying artwork.                                                                                                                                                                                                                                                            |
| Text on path             | Create ordinary text with the existing Text tool; Shift+T attaches new editable text to the selected shape contour. The text owns a copied editable Bézier baseline; the original shape survives. Content, installed family, size/weight (Properties), tracking, start/end trim, independent position, baseline, alignment and traversal direction remain editable. Direct Select edits its baseline using the existing anchor engine.                                                   |
| Typography metrics       | Fonts resolve before rendering/measurement. Cached adaptive arc lookup has a 0.01 local-px geometric/length budget, finite depth/visit limits and binary distance lookup. Unicode grapheme clusters retain combining marks and emoji. Latin/Greek/Cyrillic/CJK and common characters are supported. Contextual/RTL scripts and bidi controls are rejected for path text rather than rendered with invented shaping. Font availability can differ across devices; fonts are not embedded. |
| SVG interchange          | Standard paths/cubics/compound paths, supported primitives/arcs, nested groups and affine transforms, physical units at 96 CSS DPI, viewBox fitting, winding, opacity/stroke styles, local gradients/inheritance/transforms, binary clips/masks, uniform text and editable textPath. Inkstrip’s standard SVG stacked-path representation reopens as a single editable appearance stack after validating identical geometry/styles/clipping.                                              |
| Native/history           | Optional appearance, gradient, path-text and binary-clip data use native envelope v4; internal document geometry remains v1. Readers accept envelopes 1–4; legacy documents keep legacy defaults and their existing envelope when new features are absent. Artboards/guides/DPI remain intact. Old releases reject v4 explicitly. Native/local reopen, undo/redo, shared Raster mode, source bytes and Chapter handoff retain editable data.                                             |
| Exports                  | The shared native-resolution compositor renders paints, text, masks, layer clips and effects for PNG/JPEG/WebP. Native export retains immutable source assets. Vector SVG contains actual paths, local definitions and textPath, including supported aligned-stroke coverage. Artboard bounds/export scaling continue through the same render engine.                                                                                                                                    |
| Mobile/accessibility     | Existing touch pan/pinch, 44px acquisition regions and cancellation retained. Responsive panels, labeled numeric controls, disabled states, G/Shift+T/A keyboard tools, touch gradient handles/stops, and 320/390px regression coverage. No physical Android-device claim.                                                                                                                                                                                                               |

## SVG safety and explicit compatibility limits

SVG is artwork interchange, not a lossless substitute for a native project.
XML is parsed as detached data, never injected into the document. A whitelist
rejects script/event handlers, foreign content, images/external resources,
executable URLs, entities/DOCTYPE, unsupported properties/elements, duplicate
IDs, cycles, excessive nesting, and oversized geometry. Input is bounded to 1 MB,
4096 nodes, 48 native layers and the existing geometry limits. Imported local
references resolve only inside that SVG. Failures leave the document unchanged.

Supported clipping/mask definitions contain a single compound geometry source;
opaque binary alpha or white luminance masks become persistent editable vector
clips, including mask-region bounds. Graded masks, multi-source definitions,
object-bounds group/text clips and multi-object group-alpha clipping are rejected
explicitly. Leaf clips and single-object user-space group clips are supported.
Raster masks, clipped layer stacks, raster effects/adjustments and non-linear
transforms continue to render and save natively; vector-only SVG export rejects
those unsupported representations and directs users to native/PNG.

External backdrop blend modes, filters, patterns, embedded/external images,
nested SVG viewports, CSS stylesheets, complex text runs, variable/custom fonts,
repeat/reflect gradients and contextual/RTL path shaping are not supported.
External textPath must explicitly disable kerning and ligatures; ordinary text
uses the existing uniform/default font-shaping behavior. Standard SVG export of
path-text start/end regions keeps exact trimmed boundary cubics; native v4 keeps
the full untrimmed baseline, trim/position settings and original source object.
SVG does not preserve native editor IDs/history or invisible unpainted objects.
No claim of universal SVG losslessness or wide-gamut color management is made.

## Performance and limits

Precision bounds no longer deep-clone native paths or build an inverse mapping
per anchor. Exact cubic extrema remain; straight segments use their endpoint
bounds. Snap candidate indexes are still acquired once per gesture. Weak caches
reuse immutable-layer paint bounds and baseline arc tables. Radial gradients use
an analytic affine Canvas paint plane; the scratch surface is released after the
pattern bitmap is captured. Geometry and glyphs remain editable native data.

Reproduce with `npm run bench:vector`. A Linux / AMD EPYC 9V74 / Node v24.19.0
run with 40 paths, 40,000 anchors and 32 artboards measured:

| Operation                                |    Median |       p95 |
| ---------------------------------------- | --------: | --------: |
| Validate document                        |  1.864 ms |  5.658 ms |
| Build snap candidates                    | 10.310 ms | 16.562 ms |
| Cached object snap query                 |  0.001 ms |  0.008 ms |
| Anchor snap query over 40,000 candidates |  0.638 ms |  1.122 ms |
| Cold 128-anchor curved text metric       |  6.221 ms | 11.125 ms |
| Cached arc lookup + 420-glyph layout     |  0.076 ms |  0.160 ms |

A Chromium 156 real-UI run with 40,000 anchors/32 artboards on a 1024×1024
canvas measured 1090 ms native import plus preview and 386 ms PNG export plus
download. These are shared-machine observations, not mobile speed guarantees.
The browser benchmark intentionally excludes transferring a four-million-element
pixel array into Playwright; that test transport took roughly 16 seconds and
would misrepresent application latency. The exported image is decoded and an
actual pixel/dimensions are still verified. New browser runs log their own times.

Existing limits remain: 48 layers, 1000 anchors per native vector object,
128 contours, device-bounded raster area (maximum 16 MP / 16384px side), 32
artboards and 128 guides. Text measurement and Pathfinder have additional bounded
complexity/cancellation guards. Very large source art still belongs in Chapter
strip workflows; this is not an unlimited document engine.

## Validation and release record

The final PR records exact tested SHA, full test count, the existing 17 Chromium
suites plus `test:vector-final:browser`, types/lint/build/configuration results,
actual benchmark output, CI conclusions, merge SHA and verified production build.
The new suite has 28 grouped scenarios, including direct SVG/native glyph-center
comparisons within 0.6 local px / one degree and premultiplied pixel comparisons.
It exercises actual pixel/SVG reference rendering, aligned strokes,
compound winding, paint blending, masked/clipped compositing, appearance CRUD,
Unicode curved text, local/native history and reopen, source-byte preservation,
SVG rejection, PNG/JPEG/WebP and mobile touch cancellation/stop editing.

Production carries a non-secret `inkstrip-release` meta tag compiled from Vercel’s
Git commit SHA (GitHub/local Git fallback). Compare that value with merged main,
the Vercel commit status and domain before claiming the release is live. No
additional deployment workflow/project/token is introduced.

The next phase should address remaining Raster inventory: selection morphology
and edge refinement, brush spacing/dynamics, local vector/mask frame expansion,
channels/color management, and high-resolution scheduling. Future AI Studio is
separate and is not implemented by this release.

Exploratory development runs during source edits encountered HMR/terminated-worker
reload errors and a download timeout. Those runs are excluded from release
results; the complete frozen production build is retested. The release rehearsal
also corrected a test-only Artboard x/y label capitalization mismatch. Existing
shared Button fast-refresh lint warning and generic game-card smoke branding
warnings are unchanged; Inkstrip is an editor, so unrelated game branding was
not added.

The final SVG audit distinguishes mask fill winding from clip-path winding,
honors non-inherited SVG stop color/opacity defaults, handles user-space percentages in viewBox
coordinates, rejects inherited graded/hidden mask sources transactionally, and
reports default/generic font substitutions in the import status. Keyboard Delete
in Direct Select edits a text baseline anchor while preserving its text object;
vector-only frame fitting is disabled for text.

Gradient creation automatically uses user-space coordinates for zero-area path
bounds, so horizontal/vertical gradient strokes remain real editable paints.
