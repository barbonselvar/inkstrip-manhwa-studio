# Text & Bubbles chapter editor, Composition consolidation and SFX extractor

Branch `ccr-c99428ac-muftv7`, based on `main` at `be88186` (PR #38).

## 1. Repository audit (what existed)

- **Composition & FX** (`src/components/studio/composition/*`,
  `src/lib/studio/composition/*`) already owned one chapter controller per chapter
  (`controller.ts`): immutable history, 650 ms debounced autosave with revision and
  panel-order compare-and-swap, a versioned `Chapter.composition` envelope, project
  presets/favorites, a unified layer stack and one region renderer (`render.ts`) used by
  the editing canvas, reading simulator and segmented export.
- Coordinates: logical pixels at the chapter width. Panel-local objects are relative to
  their owner's image top; chapter-global objects are absolute (`layout()`,
  `objectMatrix()`). Chapter and Focus modes are two views of the same scene.
- **Text & Bubbles** was a list of "Edit dialogue · panel" buttons that opened the
  per-panel native Pro document editor (OCR, cleanup, translation review). There was no
  chapter-level lettering and no way to letter across panels or into spacing.
- Reusable pieces: the Dialogue lettering engine (`dialogue/lettering.ts`: locale word
  breaking, grapheme-safe wrapping, fit-to-box, vertical Japanese), the offline anime
  face cascade (`faces/`), asset presets with blob retention in backups, the ZIP and
  segment writer.
- Tests: 1,175 unit tests (`npm test`) and Playwright suites per feature
  (`scripts/*-browser-check.mjs`); CI runs typecheck, lint, tests, build and
  `check:build`.

**Decision.** Lettering became a new creative object kind (`bubble`) inside the existing
composition document instead of a parallel editor. Text & Bubbles is a second mode of
the same workspace and controller, so Chapter mode, Focus mode, Composition & FX, undo
history, autosave, the reader and export all operate on one scene. No IndexedDB
upgrade or migration is needed: the kind is additive; chapters without bubbles are
byte-for-byte unchanged and open exactly as before.

## 2. What is implemented

### Unified chapter scene

| Area        | Delivered                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coordinates | Bubbles are ordinary composition objects: panel-local or chapter-global, unclipped by default, placeable in panels, extensions, gaps, opening and ending. Dropping a bubble whose centre lies in another panel re-anchors it to that panel while keeping its world position (unit + browser verified). |
| Modes       | Text & Bubbles and Composition & FX share one controller per chapter: same history, autosave, focus and zoom. Switching modes never resets positions (browser-verified offset equality between Chapter and Focus: identical to 1e-9).                                                                  |
| Rendering   | `paintBubble` renders through the shared region renderer, with the segment-stable rasterizer (previously ink-only) generalized to bubbles, so preview tiles, reader and segmented export match.                                                                                                        |

### Text & Bubbles (new chapter-level editor)

- **Bubble library** — 15 original, visually previewed presets: Standard dialogue,
  Thought, Shouting, Whispering, Narration, Internal monologue, Telephone / electronic,
  Dramatic, Scream, Hand-drawn, Dark caption, Text on art, Korean dialogue, Japanese
  vertical, Arabic dialogue. Category filter, favorites, click-to-insert or drag onto
  any point of the chapter.
- **Editable geometry** — ten outline shapes (Oval, Rounded, Rectangle, Cloud, Burst,
  Jagged, Scream, Wobbly, Electronic, None) with corner radius, spike/bump count and an
  "irregular outline" amount (seeded, deterministic). Up to eight tails per bubble in
  four styles (Curved, Straight, Dots, Zigzag) merged into one outline so a single
  stroke surrounds bubble and tail; base width, curvature, anchor position and tip.
  Fill colour/opacity or transparent, border colour/thickness, dashed border, drop
  shadow (colour, blur, offset) and text padding.
- **Direct manipulation** — drag to move; corner handle resizes width/height (text
  re-wraps); rotation handle rotates about the centre (Shift = 15° steps, 45° detents);
  cyan tail-tip handles and ring anchor handles slide along the outline; double-click
  a bubble to type on the canvas; 44 px handles on touch.
- **Typography** — font gallery with live previews of the bubble's own text (bundled
  OFL Noto Sans/KR/JP/Arabic, Bangers, Outfit, Fraunces, system serif/monospace), size,
  weight, italic, colour, alignment, letter and line spacing, shrink-to-fit, text
  outline and shadow, language, direction and writing mode. Vertical columns for
  Japanese/Chinese/Korean. "Match font & direction to script" detects Hangul, kana,
  Han, Arabic/Hebrew (first-strong bidi rule). Full lines are shaped by the browser,
  preserving Arabic joining and bidirectional runs.
- **Chapter dialogue list** — every bubble in reading order across the chapter, editable
  in place, filterable, with "show on canvas".
- **Reusable styles** — save a bubble style or text style to the project, apply it to
  the selection or insert from it; copy/paste style; apply one bubble's typography to
  every bubble in the chapter in one undo step.
- **Smart placement (optional, advisory)** — renders the selected panel _without_ its
  bubbles at low resolution, builds a detail map (luminance spread + gradient), runs the
  existing on-device face detector, and scores candidate rectangles by detail, face
  overlap, collisions with existing lettering (including tails) and reading order.
  Up to three disjoint suggestions appear as outlines with "Place here". Nothing moves
  unless the user places one; existing objects are never repositioned (browser
  asserted).
- **Multi-select** — Shift-click adds layers; dragging moves them together; align
  left/centre/right/top/middle/bottom and distribute horizontally/vertically.
- **Panel documents** — the original per-panel native dialogue editor (OCR, cleanup,
  translation review, chapter dialogue export) is unchanged under Advanced.

### Composition & FX — consolidated navigation

Eleven peer tabs became four primary categories plus an Advanced group. Every tool is
still present:

| Category            | Contents                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panels              | Thumbnails, multi-select, drag-and-drop reorder (arrows on touch), per-panel show/hide and lock toggles, Focus.                                                                                                                                                              |
| Spacing             | Region selection, default gap, eight quick gap presets with swatches (white/black/transparent/gradient/blurred) applied to all selected panels in one undo step, saved spacing presets. Exact pixels and drag handles unchanged.                                             |
| Fades & Transitions | Sub-tabs: **Shapes** (nine boundary masks), **Fade types** (all 13 classic fades as thumbnails rendered with the renderer's coverage function), **Transitions** (all 10 types as thumbnails using the same per-row/per-pixel formula). Saved fade/transition presets inline. |
| Manhwa SFX          | Sub-tabs: **Built-in** (original vector Hangul/English ink gallery + classic lettering styles), **My Assets** (imported/extracted art + saved SFX lettering), **Import**, **Extract**, **Favorites** (starred words, styles, effects and assets).                            |
| Advanced            | Layers, Effects Library (+ saved FX presets), Overlays & Sources (overlay import, source show/hide/lock/properties), All presets.                                                                                                                                            |

Earlier tool names map onto the new sections (`nav.ts`), so stored sessions and
internal links keep working. A **Snap** toggle controls guides; snapping now also
includes other objects' edges and centres.

### SFX & artwork extractor (Manhwa SFX → Extract)

- Source: any chapter panel (accepted image, read-only) or an imported PNG/JPEG/WebP.
- Selection: Rectangle, Polygon, Lasso.
- Preliminary mask: offline colour-key matting — up to three background colours are
  estimated from the selection border (k-means, tiny clusters ignored); alpha ramps
  with colour distance, preserving antialiased edges, gradients and fine strokes;
  optional edge decontamination removes the background colour from semi-transparent
  pixels. Tolerance/softness regenerate the mask.
- Refinement: Keep brush, Remove-background brush (colour-key under the brush only),
  Eraser, Restore brush; size and hardness; bounded undo/redo; zoom and pan.
- Preview over a checkerboard, "show original" toggle.
- Output: recolor (strength, keep shading), outline (alpha dilation), drop shadow,
  opacity; cropped to the artwork; PNG or WebP (falls back to PNG when the browser
  cannot encode WebP). "Save to My Assets" or "Save and place in chapter". Saved
  assets use the existing asset presets, so they are reusable across chapters and
  included in editable project packages.
- The original image is never modified (browser test compares SHA-256 of the panel
  blob before/after).

## 3. Usage

1. Open a chapter → **Text & Bubbles**. Choose a bubble card (or drag it to any spot,
   including a gap). Type in **Dialogue text**, or double-click the bubble on the canvas.
2. Drag the bubble; use the corner handle to resize, the round top handle to rotate,
   cyan dots to aim tails. Properties → Bubble shape / Tails for exact values.
3. **Focus** isolates the selected panel with the same objects; **Return to Chapter**.
4. **Dialogue** lists all lettering in reading order. **Smart placement** → _Suggest
   positions_ → _Place here_.
5. Save a look with Properties → Reusable styles. It appears under Bubbles.
6. **Composition & FX → Manhwa SFX → Extract** → choose a panel → draw a rectangle,
   polygon or lasso → refine → _Save to My Assets_.
7. **Preview** for the reader, **Export** for PNG/JPEG/WebP segments (bubbles included),
   **Export editable project** for a full package.

Keyboard: Ctrl/⌘+Z / Shift+Z / Y undo/redo, Ctrl+D duplicate, Delete, Escape (exit
inline editing, focus, preview), Ctrl+S save. Shift-click multi-select.

## 4. Compatibility and data safety

- `CompositionObject` gains `Bubble` (`kind: "bubble"`), validated by
  `validateBubbleObject` (closed shape/tail/language lists, colour/number ranges, font
  name allowlist). `CompositionPreset.category` gains `"bubble"`. Nothing else changes.
- Existing projects, chapters, panels, spacing, fades, SFX, layers, Raster/Pro and
  dialogue documents, backups v1–v3 and exports are untouched; all previous unit and
  browser regressions pass. Opening an old chapter does not rewrite it.
- **Forward compatibility caveat:** a chapter containing bubbles is rejected by the
  composition validator of _older_ app versions (shown as unavailable composition with
  recovery export, not data loss). Use this version or later to edit such chapters.
- Bubbles contain no media; packages round-trip them and bubble presets exactly
  (unit-tested).
- Offline: every new feature runs locally. No new dependency, service or network call.

## 5. Validation (run on this branch, 2026-11-07, Node 22.23, Chromium)

| Check                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | **1,201 passed, 0 failed** (204 script, 63 app, 151 Studio, 707 Pro, 76 Composition); audit probes passed. New: 15 bubble/placement/geometry tests, 11 extractor tests, 1 package round-trip.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run typecheck`, `npm run lint`                           | Passed, no warnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run build`, `npm run check:build`                        | Passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `scripts/lettering-browser-check.mjs` (dev)                   | **20 steps passed**: navigation/categories, panel toggles + drag reorder + undo, spacing presets, fade/transition galleries, SFX tabs/favorites, extractor (transparent PNG 292×292; 31,366 transparent and 4,414 opaque pixels; source SHA-256 unchanged), bubble insertion/editing, resize/tail/rotation handles, undo/redo, cross-panel re-anchoring, Chapter/Focus agreement, inline editing, alignment, smart placement (3 suggestions, no existing object moved), reload persistence, export parity, UI PNG download, shared layers, legacy panel documents, 320/390 px touch with no horizontal overflow. |
| Same suite on the built output (`--built`, `preview:restart`) | 13 UI steps passed (module-introspection steps are dev-only, as in the existing suites).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Export parity with bubbles                                    | Full 640 px render vs 8 export segments (389 px): 2,880/2,880 rows, **0 values differing by more than 2**, max channel difference 1 ([evidence](text-bubbles/evidence/export-parity.json)).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Existing suites                                               | `composition-browser-check`, `composition-advanced-browser-check`, `composition-deep-check`, `dialogue-browser-check` (1440/768/320/390), `dialogue-workflow-browser-check` (real OCR), `dialogue-render-browser-check`, `chapter-display-import-browser-check`: all passed.                                                                                                                                                                                                                                                                                                                                     |
| `scripts/browser-smoke.mjs`                                   | Dev and built desktop/mobile: no console/page errors, no overflow, no brand warnings, built does not diverge from dev.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

QA environment notes (not product changes): the sandbox egress policy blocks
`grok.com`, so the platform branding script fails to load here; existing suites were run
with a QA-only preload that answers that single host with an empty script, and the new
suite records third-party failures separately while still failing on any local error.
OCR language data was fetched through the session proxy with TLS verification intact.
The repository pins Playwright 1.64; the preinstalled Chromium build was aliased for it.

## 6. Capability inventory and known limits

**Partial / deferred — stated plainly:**

- _Automatic extraction_ is deterministic colour-key matting, not semantic/AI
  segmentation. It works best on flat or simple backgrounds; complex backgrounds need
  the brushes. No local segmentation model is bundled.
- _Perspective SFX transforms_ remain unavailable (affine move/rotate/scale/skew only),
  as in the earlier Composition report.
- _Smart placement_ is heuristic. The anime face cascade can miss or misfire; the UI
  says so and never moves existing objects.
- _Vertical writing_ is offered for Japanese, Chinese and Korean; mixed-script vertical
  typesetting rules (tate-chū-yoko, ruby) are not implemented.
- Script shaping relies on the browser's text engine with bundled Noto fonts; scripts
  without a bundled font use system fonts when available.
- Panel drag-and-drop uses HTML drag events (desktop); touch uses the arrow buttons.
- "Effect combination" presets are not a single preset type; groups, duplicated groups
  and the cross-chapter clipboard serve that purpose.
- Multi-object transforms are move and align/distribute; there is no group
  scale/rotate gizmo for a multi-selection (use a layer group).
- Chromium desktop/touch emulation only; Safari/WebKit and physical devices were not
  verified in this environment.

## 7. Files

| Files                                                                                               | Responsibility                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/studio/composition/bubble.ts`                                                              | Bubble schema, outline/tail geometry, path tracing, lettering layout bridge, painting, validation, script detection.                            |
| `src/lib/studio/composition/bubble-presets.ts`                                                      | 15 presets, factory, style keys, placement helper.                                                                                              |
| `src/lib/studio/composition/placement.ts`                                                           | Detail map and deterministic placement scoring.                                                                                                 |
| `src/lib/studio/composition/extract.ts`                                                             | Selection rasterization, matting, brushes, decontamination, recolor/outline/shadow, cropping.                                                   |
| `src/lib/studio/composition/{model,render,geometry,controller}.ts`                                  | Additive kind/preset category, rendering integration, rotate-about-centre, re-anchoring, alignment, multi-select/snap/suggestion session state. |
| `src/components/studio/composition/{lettering,bubble-properties,extractor,fx-galleries,nav}.tsx/ts` | Text & Bubbles tools, contextual bubble inspector, extractor UI, fade/transition galleries, navigation map.                                     |
| `src/components/studio/composition/{workspace,library,canvas,properties,sfx-gallery}.tsx`, CSS      | Mode switch, consolidated navigation, handles/overlays, favorites.                                                                              |
| `src/components/studio/chapter-studio.tsx`                                                          | Text & Bubbles tab mounts the chapter editor; legacy panel documents passed through.                                                            |
| `scripts/lettering-browser-check.mjs` and updated suites                                            | End-to-end evidence. Screenshots: [docs/text-bubbles/screenshots](text-bubbles/screenshots).                                                    |

## Screenshots

- [Text & Bubbles chapter editor](text-bubbles/screenshots/chapter-lettering.png)
- [Bubble library and inspector](text-bubbles/screenshots/bubble-library.png)
- [Smart placement suggestions](text-bubbles/screenshots/smart-placement.png)
- [Focus mode](text-bubbles/screenshots/focus-mode.png)
- [Consolidated Composition navigation](text-bubbles/screenshots/composition-navigation.png)
- [Reading preview](text-bubbles/screenshots/reading-preview.png)
- [390 px touch](text-bubbles/screenshots/mobile-390.png) · [320 px touch](text-bubbles/screenshots/mobile-320.png)
