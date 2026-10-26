# Vector → Raster Studio migration plan

Status: **steps 1–2 and the Appearance part of step 3 migrated** (see §5); gradients are
deferred to R8. Vector Studio is hidden from the interface
(homepage, Chapter workspace, image menu and the Pro mode switch). Its code, its editing
mode and all saved documents are unchanged.

## 1. How Vector Studio is built today

Vector Studio is not a separate app or route. It is the `mode: "vector"` state of the
shared Pro workspace (`src/components/studio/pro/pro-workspace.tsx`).

- **Shared with Raster Studio:** one native document (`ProDocument`, schema 2 since R6), one
  canvas, one history, one worker renderer and one storage path. A document can be opened in
  either mode, and nothing is converted when switching.
- **What differs by mode:** only the toolbar (`RASTER_TOOL_IDS` / `VECTOR_TOOL_IDS` in
  `pro-tools.ts`) and a few vector-only inspector tabs: Pathfinder, Artboards, Precision,
  Appearance and Typography.
- **Dialogue Studio** opens the workspace in vector mode with `dialogue` enabled. Vector mode
  must therefore keep working internally for Dialogue, independently of the hidden entry
  points.

### Hidden entry points (this change)

| Entry point                                  | File                                     | Now                                                                   |
| -------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| "Open in Vector Studio" (Chapter workspace)  | `chapter-studio.tsx`                     | Hidden; Raster Studio button spans the row with a short description   |
| "Open in Vector Studio" (image options menu) | `editor/panel-image-actions.tsx`         | Hidden                                                                |
| "Vector" mode switch (Pro workspace header)  | `pro/pro-workspace.tsx`                  | Hidden, except for legacy content (below)                             |
| Help text pointing to Vector Studio panels   | `pro-dialogue.tsx`, `pro-properties.tsx` | Points to the legacy "Vector" button, which is shown for that content |

The homepage, library, project view and main navigation never linked to Vector Studio, so
nothing changed there.

### Legacy access (no broken links, no lost data)

All of this lives in `src/lib/studio/legacy-vector.ts`.

- **Automatic.** The "Vector" button appears inside Raster Studio for documents that contain
  vector-only content: artboards or text on a path. This rule is `hasLegacyVectorContent`.
  - Raster Studio edits paths, shapes, text, gradient layers (Layers → Gradient layer),
    Appearance stacks (Appearance tab) and vector masks (Paths tab), so those don't trigger it.
  - Grid, snapping and guide settings are shared, so they don't either.
  - Dialogue layers don't count.
- **On request.** Adding `?vector=legacy` to a chapter link shows the hidden entry points
  again, and the choice is remembered on that device (`inkstrip-legacy-vector-v1` in
  localStorage).
  - Vector Studio never had URLs of its own (the mode was in-memory state), so no existing
    link can break.
  - This parameter is the hidden "legacy route".
- **Data.** No migration or format change was performed. Documents keep every vector layer,
  artboard and setting, and open in either mode exactly as before.

## 2. Feature audit

Legend for **Status**: _Raster_ = already usable in Raster Studio today; _Vector-only_ =
reachable only through the hidden Vector mode; _Shared_ = engine used by both.

### 2.1 Pen tool

1. **Status:** _Raster_. `pen` is already in `RASTER_TOOL_IDS`; Raster Studio draws Bézier
   path layers.
2. **Files:** `pro-canvas.tsx` (pen gesture), `lib/studio/pro/bezier.ts`, `model.ts` (shape
   layers with `anchors`/`subpaths`).
3. **Dependencies:** `bezier.ts`, `vector-render.ts` (worker rendering).
4. **Reusability:** High. It is already shared.
5. **Raster work:** None functionally. Possibly a UX pass: group Pen and Direct Select under a
   "Paths" flyout in the Raster toolbar.
6. **Risks:** Low.
7. **Priority:** Done (verify only).

### 2.2 Bézier paths and vector path editing

1. **Status:** _Raster_. Direct Select (`direct`) is in the Raster toolbar. The anchor editor
   (`ProAnchors`) is shown in Properties for any path layer, in either mode.
2. **Files:** `lib/studio/pro/anchor-edit.ts`, `bezier.ts`, `components/studio/pro/pro-anchors.tsx`;
   tests `anchor-edit.test.ts`, `bezier.test.ts`, `svg-path.test.ts`.
3. **Dependencies:** `bezier.ts`, `compound.ts` (`nativePath`, `convertPath`).
4. **Reusability:** High.
5. **Raster work:** None. Optionally document it in Raster help.
6. **Risks:** Low.
7. **Priority:** Done (verify only).

### 2.3 Vector shapes and editable shape layers

1. **Status:** _Raster_. Rectangle, Ellipse, Line, Polygon and Text are in the Raster toolbar
   and create editable `shape`/`text` layers.
2. **Files:** `model.ts` (`Shape`, fill/stroke/dash/cap/join fields), `vector-render.ts`,
   `pro-properties.tsx`.
3. **Dependencies:** `svg-paint.ts` (paint parsing), worker renderer.
4. **Reusability:** High.
5. **Raster work:** None for basic shapes. Advanced stroke styling (dash, joins, miter) is
   exposed through Properties already.
6. **Risks:** Low.
7. **Priority:** Done (verify only).

### 2.4 Shape transforms

1. **Status:** _Shared_. R5 Free Transform (`transform.ts`, `transform-session.ts`,
   `transform-forest.ts`) applies to all layer kinds. Vector layers stay vectors under affine
   transforms (`vectorOverflow`).
2. **Files:** `transform*.ts`, `geometry-operations.ts`, `compound.ts` (`fitVectorFrame`).
3. **Dependencies:** none beyond the model.
4. **Reusability:** High.
5. **Raster work:** None.
6. **Risks:** Perspective/warp on vector layers rasterizes the result. This is documented R5
   behaviour, not a regression.
7. **Priority:** Done.

### 2.5 Compound paths

1. **Status:** _Raster_. "Create/Release compound path" lives in the Layers panel, which both
   modes share.
2. **Files:** `lib/studio/pro/compound.ts`, `pro-layers.tsx`; test `compound.test.ts`.
3. **Dependencies:** `bezier.ts`, `clipper-lib` (via the Pathfinder worker for boolean geometry).
4. **Reusability:** High.
5. **Raster work:** None.
6. **Risks:** Low.
7. **Priority:** Done.

### 2.6 Pathfinder (shape boolean operations)

1. **Status:** _Raster_ (§5). Raster's **Paths** tab embeds the same `ProPathfinder`; Vector
   mode keeps its Pathfinder tab. Previously _Vector-only_.
2. **Files:** `lib/studio/pro/pathfinder.ts`, `pathfinder-selection.ts`, `pathfinder-client.ts`
   (worker), `pro-pathfinder.tsx`; tests `pathfinder.test.ts`, `pathfinder-client.test.ts`.
3. **Dependencies:** `clipper-lib` 6.4.2 (already a production dependency), worker.
4. **Reusability:** High. It is pure geometry with an existing UI component.
5. **Raster work:** Expose `ProPathfinder` as a Raster inspector section, shown when two or
   more vector shapes are selected. A Raster-side variant could also create **selections**
   from boolean shape results (pairs well with R7).
6. **Risks:** Low. The operations produce ordinary path layers.
7. **Priority:** **High.** Small UI change, large capability gain.

### 2.7 Vector masks / vector clips

1. **Status:** _Raster_ (§5): path → selection, selection → path, layer mask from path, vector
   mask from path, and vector-mask enable/remove/"edit as path". Previously mixed:
   - _Shared:_ layer masks (`masks.ts`) are pixel/selection-based and fully usable in Raster
     (R2, R5, R7 mask ↔ selection).
   - _Vector-only:_ path-based `vectorClips` (from SVG `clipPath` import) are rendered
     everywhere, but edited only in the Appearance panel.
2. **Files:** `lib/studio/pro/vector-clip.ts`, `masks.ts`, `pro-vector-appearance.tsx`,
   `pro-canvas.tsx` (hit testing).
3. **Dependencies:** canvas `Path2D`, the model.
4. **Reusability:** Medium. The data model and rendering exist; there is no creation UI.
5. **Raster work:**
   - Add "Vector mask from path": convert a selected path layer into a `vectorClip` on the
     target layer, or into a pixel mask through R7 `maskFromSelection`.
   - Add enable/disable/remove controls in Raster Properties, reusing the Appearance list
     component.
6. **Risks:** Medium. There are two mask concepts (pixel mask vs vector clip); keep them
   distinct in the UI and the native format.
7. **Priority:** **High** for "selection/mask from path"; **Medium** for full vector-clip
   editing.

### 2.8 SVG import and export

1. **Status:** _Shared_.
   - **Import:** the Pro Assets panel accepts SVG in either mode (`svg-import.ts`, strict
     sanitizer, editable paths, compound contours, groups, basic paints, clips).
   - **Export:** "Export SVG · vectors only" lives in the shared Export tab (`vector-svg.ts`);
     artboard exports can also produce SVG.
2. **Files:** `svg-import.ts` (≈930 lines), `vector-svg.ts`, `svg-paint.ts`,
   `pro-inspector-tabs.tsx`.
3. **Dependencies:** none external; Chapter-level SVG goes through the existing image policy.
4. **Reusability:** High.
5. **Raster work:** None functionally.
   - Clarify the SVG export copy in Raster ("exports vector layers only; raster layers are
     omitted").
   - Consider an "embed raster layers as images" option later.
6. **Risks:** SVG export intentionally omits raster pixels. Users exporting a Raster document
   need that stated clearly.
7. **Priority:** **Medium** (copy/UX).

### 2.9 Gradients and Appearance stacks

1. **Status:** Appearance tab: _Raster_ (§5). Raster gradient creation/editing tools are
   **deferred to R8** (Gradient Fill, §5.1). Previously mixed:
   - _Raster:_ editable **gradient layers** (Layers → Gradient layer: linear/radial, angle,
     scale, center, color and opacity stops, presets) and the Gradient Overlay layer effect are
     already in Raster Properties (`pro-appearance.tsx`).
   - _Vector-only:_ gradient **paints** inside multi-fill/stroke Appearance stacks, and the
     on-canvas handles of the Vector Gradient tool that edit them. Both render in Raster.
2. **Files:** `gradient.ts`, `vector-appearance.ts`, `effects.ts`, `pro-appearance.tsx`,
   `pro-vector-appearance.tsx`, `pro-color.tsx`; tests `appearance.test.ts`, `color.test.ts`.
3. **Dependencies:** worker renderer, `svg-paint.ts`.
4. **Reusability:** Medium–High.
5. **Raster work:**
   - On-canvas gradient handles for gradient layers and Appearance paints in Raster.
   - Expose the Appearance stack (fills/strokes) in Raster Properties.
6. **Risks:** Medium.
   - R6 adjustment layers and blend modes must be retested against gradient paints.
   - Raster's Paint Bucket and the Vector Gradient tool share the "G" shortcut, so a Raster
     gradient tool needs a different key.
7. **Priority:** **Medium.**

### 2.10 Text on a path and Typography

1. **Status:** _Vector-only_ (Text on Path tool, Typography tab). Plain text is already in
   Raster.
2. **Files:** `text-path.ts`, `pro-text-path.tsx`, the typography panel in `pro-workspace.tsx`.
3. **Dependencies:** path measurement (`bezier.ts`), font metrics.
4. **Reusability:** Medium.
5. **Raster work:** Add Text on Path to the Raster text tool, as an option once a path is
   selected. Move the Typography controls into Raster Properties.
6. **Risks:** Medium. Dialogue Studio uses related text features; keep Dialogue lettering
   unaffected.
7. **Priority:** **Low–Medium.**

### 2.11 Artboards and Precision (guides, snapping presets, DPI)

1. **Status:** _Vector-only_ panels (Artboards, Precision). Grid and Snap toggles already work
   in Raster.
2. **Files:** `artboards.ts`, `precision.ts`, `pro-artboards.tsx`, `pro-precision.tsx`,
   `viewport.ts`, `preview-target.ts` (R6 readiness fix); tests `artboards.test.ts`,
   `viewport.test.ts`, `preview-target.test.ts`.
3. **Dependencies:** viewport/preview pipeline, export.
4. **Reusability:** Medium.
5. **Raster work:** Decide whether multi-board layouts belong in a manhwa raster workflow
   (Chapter pages already define page size). At minimum, expose guides and precision snapping
   in Raster.
6. **Risks:** Medium–High. The viewport/readiness logic was the source of the R6 Artboards
   race; any change needs the strict preview-viewport suite.
7. **Priority:** **Low** (guides/snapping: Medium).

## 3. Recommended order

1. **Pathfinder in Raster:** expose the existing component; add "selection from shape"
   (with R7).
2. **Mask/selection from path:** pixel masks via R7 first, then vector-clip controls.
3. **Gradient tool and simplified Appearance** in Raster Properties, with a shortcut
   reassignment.
4. **SVG export copy** and an optional raster embedding.
5. **Text on Path / Typography** in Raster's Text tool.
6. **Guides and Precision** in Raster; revisit multi-artboard layouts last.

When every vector-only capability above has a Raster home, the legacy Vector mode switch can
be retired. Keep the `mode: "vector"` code path for Dialogue Studio, or migrate Dialogue to a
dedicated mode at the same time.

## 4. Compatibility checklist for each migration step

- **No native format change** without an explicit migration plan.
  - R6 schema 2 documents must keep opening in both modes.
  - Keep `hasLegacyVectorContent` accurate.
- **Run before merging:**
  - vector, compound, pathfinder, artboards, preview-viewport, appearance, color, vector-final
    and production-vector suites (they now enter through `legacyVector` in
    `scripts/pro-browser-fixtures.mjs`);
  - R3/R5/R6/R7, Chapter and Dialogue suites;
  - `test:vector-hidden:browser`.
- **Raster history and R6 adjustment layers** must treat new vector-derived layers like
  existing shape layers.
- **Dialogue Studio** must continue to open and edit lettering unchanged.

## 5. Migrated to Raster Studio (Raster advanced tools)

Each item reuses the existing engine; every edit is one undo step, saves in the existing
native format and works on desktop and touch.

| Capability                                                                 | Where in Raster                     | Reused                                                  | New code                                                             |
| -------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| Pathfinder Unite / Subtract / Intersect / Exclude / Divide (+ Trim, Merge) | Paths tab                           | `pathfinder.ts`, worker, `ProPathfinder`                | Tab exposure; Raster guard removed                                   |
| Path → selection (new / add / subtract / intersect, feather)               | Paths tab                           | `combineSelection`, `coverageRegion`, selection feather | `path-selection.ts` scan converter (fill rules, Béziers, transforms) |
| Selection → path                                                           | Paths tab                           | Direct select / anchor editor                           | Marching squares + RDP tracer within native path limits              |
| Layer mask from path                                                       | Paths tab                           | `maskFromSelection`, mask feather                       | Path coverage as mask source; optional source hiding                 |
| Vector mask from path; enable, remove, edit as path                        | Paths tab                           | `VectorClip` model + renderer                           | `vectorClipFromPath`, `releaseVectorClip`                            |
| Multiple fills/strokes, stroke alignment, opacity, blend, gradients        | Appearance tab                      | `ProVectorAppearance`                                   | Tab shown in Raster                                                  |
| Non-destructive layer effects                                              | Properties → Editable layer effects | Existing (unchanged)                                    | None                                                                 |

**Format.** No document format change. No migration runs.

**Remaining vector-only:** Text on Path / Typography and Artboards / Precision (§2.10, §2.11).

### 5.1 Gradients: deferred to R8

R8 (PR #19, `codex/r8-layer-effects-smart-filters-gradients`) is the authoritative gradient
implementation: v2 gradient model, Gradient Fill layers and the `gradient-fill` tool. A
separate Raster Gradient tool was prototyped here and removed before merge to avoid a
duplicate tool, a duplicate document field and silent pixel changes. Gradient layers,
their editor (Properties) and renderer stay exactly as on `main`.

Deferred, to be built on R8's native gradient model after R8 lands:

- **Circular radial gradients** (today radial gradients fill the layer box as an ellipse).
  Add as an R8 v2 option so R8 validates and renders it.
- **Shift+G shortcut** for Gradient Fill; the Paint Bucket keeps **G**.
- **Drag-to-create** a new selection-masked gradient layer directly on the canvas, in one
  gesture (R8 creates via "New Gradient Fill", then edits endpoints).
- **A center handle** to move a linear gradient without changing its length or angle.
- **Tool presets** with opacity stops (Foreground to transparent, White glow, …) and a
  one-click stop reversal, if R8's presets do not already cover them.
