# R7 implementation report — Advanced Selections, Precision Masks & Selection-Aware Editing

Branch: `claude/r7-advanced-selection-masks` ·
[Draft PR #17](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/17) · Base: `main` @
`740720c1d5e141c7f52ecab83d2e505fea7183f0` (R5 merge, includes R1–R3).

Final runtime SHA and the delivery SHA are recorded in Draft PR #17 and in
[`R7_TEST_REPORT.md`](./R7_TEST_REPORT.md). The PR remains a Draft and nothing was merged or deployed.

## Scope and constraints honoured

- Raster Studio was extended, not rebuilt. No existing tool was recreated: the polygon/lasso
  gestures, Magic Wand, Color Range tool, Refine Edge, masks, R3 brush engine and R5 staging are
  reused. Every new result is real document data computed at native resolution.
- **No document format change.** New behaviour is expressed with existing data: `pixels`
  selection regions, ordinary paint/raster layers, masks and PNG assets. The native envelope,
  schema and validation limits are unchanged.
- R6 (Draft PR #16) was still in progress, so R7 does not touch `vercel.json` or the
  colour/adjustment modules. See _R6 integration notes_ below.
- PR #6 (AI Studio) was not touched. R8 work was not started. `main` was not modified.

## Commits

| Commit    | Content                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a459ea6` | `R7_GAP_ANALYSIS.md`: feature classification and four confirmed defects                                                                                                 |
| `1741ca1` | Selection core library: `selection-tools.ts`, `color-distance.ts`, perceptual wand metric, worker `range`/`alpha`/`modify-selection` jobs, client methods, 8 unit tests |
| `29089c8` | Canvas defects fixed (lasso budget, polygon boolean, Backspace) and marquee constraints                                                                                 |
| `c42160a` | Workspace features: Color Range dialog, sample source, modify commands, mask↔selection, clipboard, Quick Mask, region-limit compaction, shortcuts                       |
| `b361b30` | `test:r7:browser` suite; the lasso limit notice became a status so the commit on release does not clear it                                                              |

## Defects fixed

1. **More than 100 boolean operations failed.** `validateSelection` allows 100 regions, so the
   101st wand click or marquee was refused and lost. `compactSelection` now rasterizes an
   over-limit selection (unfeathered, inversion applied) into one native-resolution pixel
   region before commit. Feather stays a separate setting, so it is not applied twice.
2. **Long freehand lassos were lost.** Every pointer move appended a point, and regions allow at
   most 5,000. `appendLassoPoint` stores a point only after 2 CSS px of travel at the current zoom
   and stops at the limit. A status explains that releasing applies the outline drawn so far.
3. **Wrong boolean result from the polygon Finish button.** It appended the region directly. Enter,
   double-click and the Finish button now all call `closePolygon()`, which goes through
   `combineSelection` and so keeps boolean meaning when the selection is inverted.
4. **Backspace deleted the selected layer mid-polygon.** While a polygon is in progress, a
   capture-phase listener claims Backspace and removes the last point. A **Remove last point**
   button covers touch.

## Features

### Unified selection engine

`doc.selection` remains the only source of truth. `combineSelection(selection, region, mode)`
is the single combine path for marquee, lasso, polygon, wand, Color Range and mask loading.
The new **New selection** (replace) mode starts a fresh selection. Stored regions still use
`add`/`subtract`/`intersect`, which keeps files compatible.

### Marquee

**Marquee aspect ratio** offers free, 1:1, 4:3, 3:2, 16:9, 2:3 and 9:16. Shift draws a square or
circle and Alt draws from the centre (`marqueeCorners`). Feather and anti-aliasing are unchanged
and work as before.

### Magic Wand

- **Sample source**: the visible composite (default), or the active layer. Active-layer sampling
  renders the layer and its children in isolation at their real position, using
  `thumbnailDocument`, so layers above do not affect it.
- **Color distance**:
  - RGB (default, unchanged): straight-alpha Chebyshev distance plus the alpha difference.
  - Perceptual: OKLab ΔE scaled to 0–255 and weighted by alpha. sRGB to OKLab conversion uses
    a lookup table.
- Tolerance, contiguous/global, anti-alias and the bounded flood fill are reused unchanged.

### Color Range

- Each tap adds a reference colour, or removes one when **Remove sample** is on. At most 16 of
  each.
- **Coverage** is `falloff(nearest included) × (255 − falloff(nearest excluded)) / 255`.
  `falloff` is fully selected up to the tolerance, then falls linearly to 0 over the
  **Fuzziness** distance.
- The preview is computed in the worker at document resolution, debounced, and shown through the
  real selection overlay. **Invert** applies to the range region only.
- **Apply color range** commits once, as "Color Range selection". **Cancel color range** discards
  the preview without a history entry. Switching tool also cancels.
- The browser suite checks that after Cancel the stored selection is deep-equal to the original
  and the history count is unchanged.

### Modify commands

**Expand / Contract** (1–100 px), **Border** (1–200 px) and **Smooth** (1–100 px) run in the worker
on the existing O(n) morphology and box filters:

- Document edges are replicated, so a selection touching the canvas edge stays attached to it.
- Border is the dilation minus the erosion, each by half the width.
- Smooth box-filters the coverage and then re-sharpens it around 50 %.

Each command is one undo step. If the document changed while a job ran, the result is discarded
and an error says so; it is never applied to the newer document. Feather, Invert, Select All and
Deselect already existed. They now also have shortcuts: Ctrl/Cmd+A, Ctrl/Cmd+D and
Shift+Ctrl/Cmd+I.

### Refine Edge

Refine Edge already existed and is unchanged; its suite still passes. It uses traditional
image processing; no hair segmentation model is claimed.

### Quick Mask

Quick Mask uses a temporary paint layer named `Quick Mask (temporary)`.

- **Enter** (button or Q): the layer is seeded with the exact current coverage, including feather
  and partial alpha, using the existing `bucketStroke`. The live selection is then cleared, so it
  does not clip the Quick Mask brush.
- **While active**:
  - The canvas paints with the real R3 Brush, Pencil and Eraser in a fixed tint. Hardness,
    opacity, flow and pressure give partial coverage.
  - Painting changes only coverage, never the artwork. The browser suite checks that the
    composite is pixel-identical after exit.
  - The Quick Mask layer is kept as the target layer.
  - **Quick Mask overlay opacity** (10–90 %) changes only that layer's display opacity.
- **Exit** (button or Q): the layer is rendered alone at opacity 1, its alpha becomes a pixel
  selection, and the layer is removed, all as one undo step.
- Export (native, raster, SVG and artboards) and Apply to chapter are blocked while Quick Mask is
  active, so the temporary layer never leaks into output. Save Draft is allowed. Because the state
  is derived from the document, a saved Quick Mask is still active after reopening.

### Selection ↔ layer masks

- **Mask from selection** already existed. It now reports when it replaces an existing mask:
  "Undo restores the previous mask." A mask is never deleted silently.
- **Selection from mask** renders the layer's mask coverage in document space and combines it
  using the current selection mode. The mask itself is read-only in this operation; the suite
  checks the mask is unchanged. It is allowed on locked layers.
- **Add selection to mask** combines the current mask coverage and the selection into one
  document-frame pixel mask. The **enabled** state is kept and locks are respected.

  _Note:_ this bakes the previous mask, including painted mask strokes, into that pixel coverage.
  The visible result is identical and Undo restores the original mask object.

### Selection-aware painting and R5 transforms

Unchanged and still covered by the regression: brush, pencil, eraser, fill, clone and heal clip
to soft selections; R5 selected-pixel move/scale/rotate.

### Copy, cut, paste, duplicate, extract

All five commands reuse R5 native-resolution staging, so they have the same eligibility: one
visible, unlocked, affine raster or paint layer on a canvas up to 4 MP.

- **Copy pixels** (Ctrl/Cmd+C) keeps the lifted PNG and its frame in an in-memory clipboard.
- **Paste as layer** (Ctrl/Cmd+V) creates a new raster layer at the copied position, clamped to
  the canvas.
- **Cut pixels** (Ctrl/Cmd+X) keeps the original layer hidden and editable inside a group, shows
  the remaining pixels, and fills the clipboard.
- **Layer via copy** (Ctrl/Cmd+J) duplicates the selected pixels into a new layer.
- **Layer via cut** (Shift+Ctrl/Cmd+J) extracts them into their own layer.

Each is one history entry. New assets are validated against the session budget before commit.

### History, safety and performance

- Every worker job goes through one `selectionJob` wrapper with busy flags and a stale-document
  guard, so a late result cannot change a newer document. Cancelled jobs (`AbortError`) are
  silent.
- Inputs are validated and typed:
  - at most 16 Color Range samples per list;
  - tolerance and fuzziness 0–255;
  - modify amounts within `MODIFY_LIMITS`;
  - images at most 16,777,216 pixels;
  - the existing region limit (100) and point limit (5,000).
- Morphology is O(n) per pass and yields at cancellation checkpoints.
- Color Range preview runs are numbered, so stale replies are dropped.

### Mobile

All new controls use the existing `ProNumber`, `Button` and `ToolSection` components and the
context bar. The R7 browser suite runs the full flow at 1440, 768, 390, 360 and 320 px, with touch
emulation below 800 px, and checks there is no horizontal overflow. Screenshots were inspected.
This is emulation only; no physical device testing is claimed.

## R6 integration notes (R6 is Draft PR #16)

- R7 does not change `vercel.json` or any colour/adjustment module. R6 can merge before or after
  R7 without textual conflicts in those files.
- If R6 adds adjustment layers or filters that should respect selections, they should clip with
  `doc.selection` through `selectionCanvas` (as R3 strokes do), not keep their own copy.
- If R6 introduces non-raster layer kinds, Wand and Color Range active-layer sampling already
  works through `thumbnailDocument`. R5/R7 clipboard eligibility (`selectionTransformTarget`)
  would need explicit support for them.
- A future "Color Range from adjustment output" should pass the adjusted composite to the
  worker `select` job with `options.range`. No new selection path is needed.

## Deferred (not claimed)

- Content-aware hair or subject segmentation: no real segmentation model is available, so
  none is simulated.
- Widening R5/R7 pixel-lift eligibility: linked, clipped or effected layers, and canvases above
  4 MP.
- A system-clipboard (OS) image bridge. The pixel clipboard is in-memory, per workspace.
