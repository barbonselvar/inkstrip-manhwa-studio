# R7 gap analysis — Advanced Selections, Precision Masks & Selection-Aware Editing

Date: 2026-10-25 · Base: `main` @ `740720c` (R5 merge; includes R1–R3) · Branch:
`claude/r7-advanced-selection-masks`.

Parallel work checked on GitHub: **R6 is Draft PR #16** (`codex/r6-color-adjustments-filters`,
so far only an audit document and a `vercel.json` change). R7 avoids `vercel.json` and the
colour/adjustment modules. PR #6 (AI Studio F1) is untouched. No R4 branch or PR exists.

## 1. Architecture R7 must reuse

- **One selection model, stored in the document** (`model.ts` `Selection`). It is an ordered list
  of regions (`rectangle`, `ellipse`, `lasso` polygon, or `pixels` run-length coverage 0–255
  in an affine frame), each combined by `add`/`subtract`/`intersect`, plus a global `inverted`
  flag and `feather`. `appendSelection` keeps boolean meaning after a global invert. The
  selection is persisted in native files (envelope v5 rules) and recorded in history. This is
  already the single source of truth: `selectionCanvas()` (`render.ts`) rasterizes it for the
  overlay, brush/fill clipping, masks, refine and R5 staging.
- **Pixel analysis runs in the worker at native document resolution** (`worker.ts` `select`,
  `sample`, `refine`, `stage-selection`), on the full composite. Passing a purpose-built document
  (for example one isolated layer) reuses the same path for other sources.
- **Refine engine** (`refine-selection.ts`): O(n) square morphology, box filters, colour-line
  matting with foreground/background samples, island cleanup, hole filling and tiled processing
  with cancellation checkpoints.
- **R5 selected-pixel staging** (`selection-transform*.ts`): splits one eligible layer into
  `remaining` and `lifted` PNG assets with premultiplied-colour factoring, keeping the original
  hidden. Eligibility: one visible, unlocked, affine raster/paint layer; canvas ≤ 4 MP.
- **R3 brush engine**: strokes carry a selection `clip`; pencil, eraser, clone, heal and fill
  already respect selection coverage, including soft edges.

## 2. Feature classification

Legend: **V** implemented and verified (code plus existing browser coverage) · **P** partial ·
**D** defective · **M** missing · **B** blocked by an architectural dependency.

| Area         | Feature                                                                                                                  | Class | Evidence / reference                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core         | Pixel coverage 0–255, bounds, empty/full, invert, canvas clipping                                                        | V     | `Selection`/`Region` model; `selectionCanvas`; `pro-browser-check` boolean/feather coverage                                                                                       |
| Core         | Document-isolated selection state                                                                                        | V     | Selection lives in each document; history per workspace                                                                                                                           |
| Core         | More than 100 boolean operations                                                                                         | **D** | `validateSelection` caps regions at 100; the 101st add/subtract (e.g. wand click) fails to commit                                                                                 |
| Marquee      | Rectangle, ellipse, add/subtract/intersect, feather, anti-alias, rotation mapping                                        | V     | `select-rect`/`select-ellipse`; R2 `canvasPoint`                                                                                                                                  |
| Marquee      | Replace ("new selection") mode                                                                                           | M     | Operations are add/subtract/intersect only                                                                                                                                        |
| Marquee      | Fixed aspect ratio, Shift square/circle, Alt from centre                                                                 | M     | Two-corner drag only                                                                                                                                                              |
| Lasso        | Freehand lasso                                                                                                           | **D** | Every pointer move appends a point; regions allow ≤ 5,000 points, so a long or slow lasso fails to commit and is lost                                                             |
| Lasso        | Polygonal lasso: Enter/double-click/Finish button close, Escape cancels                                                  | P     | Works; **D**: the touch "Finish polygon selection" button appends the region directly instead of through `appendSelection`, so it combines wrongly when the selection is inverted |
| Lasso        | Backspace removes last point                                                                                             | M     | Backspace currently deletes the selected layer even while a polygon is in progress                                                                                                |
| Wand         | Bounded 4-connected flood fill, tolerance, contiguous/global, anti-alias, alpha-aware                                    | V     | `selectColor` (each pixel visited once); browser-tested                                                                                                                           |
| Wand         | Sample active layer (vs visible composite)                                                                               | M     | Visible composite only                                                                                                                                                            |
| Wand         | Perceptual colour distance                                                                                               | M     | RGB (straight-alpha Chebyshev) only                                                                                                                                               |
| Colour Range | Whole-image tolerance selection                                                                                          | P     | Single sample, hard threshold, commits immediately                                                                                                                                |
| Colour Range | Add/remove samples, fuzziness, live preview, invert, apply, cancel                                                       | M     | —                                                                                                                                                                                 |
| Modify       | Feather, invert, select all, deselect                                                                                    | V     | Properties panel; toolbar                                                                                                                                                         |
| Modify       | Expand, contract, smooth                                                                                                 | P     | Only as Refine Edge sliders (shift/smooth); no direct commands                                                                                                                    |
| Modify       | Border                                                                                                                   | M     | —                                                                                                                                                                                 |
| Refine Edge  | Radius, smooth, feather, contrast, shift edge, edge-aware colour refinement, preview modes, apply/cancel, output to mask | V     | `ProRefine`, `refine-selection.ts`, `raster-refinement` suite. Traditional image processing; no semantic/hair segmentation                                                        |
| Quick Mask   | Enter/exit, overlay opacity, paint/erase coverage                                                                        | M     | —                                                                                                                                                                                 |
| Masks        | Mask from selection, invert, enable/disable, edit (R2), copy/paste mask, mask-only transforms (R5)                       | V     | `maskFromSelection`; R2/R5 suites                                                                                                                                                 |
| Masks        | Selection from mask                                                                                                      | M     | —                                                                                                                                                                                 |
| Painting     | Brush, pencil, eraser, fill, clone, heal clipped by soft selection                                                       | V     | Stroke `clip`; `pro-browser-check` clipping, R3 suite                                                                                                                             |
| Transforms   | Selected-pixel move/scale/rotate with apply/cancel/undo                                                                  | V     | R5 staging; `r5-browser-check`                                                                                                                                                    |
| Clipboard    | Copy, cut, paste, layer via copy/cut                                                                                     | M     | —                                                                                                                                                                                 |
| Persistence  | Selection and masks saved and reopened; export matches composite                                                         | V     | Native suites                                                                                                                                                                     |

## 3. Plan (format-neutral)

No native schema or envelope change. Every new result is expressed as existing data: pixel
regions, ordinary paint/raster layers, masks and assets.

1. **Defects.** Bound freehand lasso recording (screen-relative spacing, cap); route every
   polygon close through one combine function; let the polygon claim Backspace before
   layer deletion; compact selections that reach the region limit into one native-resolution
   pixel region (feather preserved separately).
2. **Selection modes.** `combineSelection` with `replace`; marquee constraints (fixed ratio,
   Shift square/circle, Alt from centre).
3. **Wand and Colour Range.** Sample source (visible composite or active layer) through an
   isolated-document render; optional perceptual (OKLab) distance; a Colour Range panel with
   include/exclude samples, tolerance and fuzziness falloff, live preview, invert, apply, cancel.
4. **Modify commands.** Expand, Contract, Border, Smooth through one worker path on the existing
   morphology/box filters.
5. **Selection from mask.** Render the layer's mask in document space through the same worker
   path; respect locks; never alter the mask.
6. **Clipboard.** Copy/Cut/Paste and Layer via Copy/Cut, reusing R5 staging and its eligibility.
7. **Quick Mask.** A temporary paint layer seeded with the exact selection coverage, painted with
   the real R3 brush in a fixed tint, and converted back to a pixel selection on exit, as one
   undo step.

Deferred: content-aware hair segmentation (no real segmentation model), and widening R5
eligibility (linked, clipped or effected layers; canvases above 4 MP).
