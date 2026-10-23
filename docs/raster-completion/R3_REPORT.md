# Raster Studio completion — R3 report: painting

Date: 2026-10-24 · Branch: `claude/raster-studio-completion` · Base: `main` @ `71a29e2` · Draft PR #9.

## A. Objective and result

R3 targets painting tools. This release delivers the **Paint Bucket** completely and records a
design decision that the remaining R3 tools need before they can be built without risking
documents.

**Delivered: Paint Bucket (`G` in Raster Studio).**

- Uses the Magic Wand's flood fill on the visible composite at full document resolution, with the
  same Tolerance (0–255), Contiguous and Anti-alias controls in the context bar.
- Fills with the brush colour and brush opacity into the active paint layer. If the active layer is
  not a paint layer, choosing the tool creates one, as the brush tools already do.
- An active selection limits the fill. Feathered selection edges fill partially, by multiplying
  coverage.
- The fill is stored as an **ordinary editable paint stroke**: square, fully hard dabs covering the
  layer, clipped by the colour region. It is one undo step, re-renders at any export resolution,
  and leaves the artwork below untouched.

**Not delivered, by design: smudge, blur/sharpen, dodge/burn/sponge brushes, pen tilt, image
brush tips.** See §G. Each needs a native-format addition, and the next free envelope number
depends on PR #6.

## C. Changes and algorithms

| File | Change |
| --- | --- |
| `src/lib/studio/pro/fill.ts` (new) | `coveragePoints` (serpentine square dabs covering any layer up to 16384 px within the 1000 px tip and 10000-point stroke limits), `bucketStroke`, `intersectRegion` (multiplies a fill region by selection coverage, re-encoding row-bounded runs), `hasActiveSelection`. |
| `src/components/studio/pro/pro-workspace.tsx` | Paint Bucket in the tool table and raster tool set; tolerance/contiguous/anti-alias controls shown for it; fill branch in the colour-sampling path; paint-layer creation when the tool is chosen. |
| `src/components/studio/pro/pro-canvas.tsx` | `fill` tool type; a click routes to the colour-sampling path. |

**Compatibility.** No schema or envelope change. A fill uses only square tips, pixel-run regions
and frame-mapped clips, which existing brush and Magic Wand workflows already write. Files
containing fills therefore open identically in earlier releases.

**Licensing.** Original implementation; no new dependencies.

## D. Commands and tests

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npx eslint .` | 0 errors, 1 pre-existing warning (fixed in #7) |
| `npm test` | **693 passed, 0 failed** (688 after R2 + 5 new) |
| `vite build` | pass |
| New `fill.test.ts` (5) | Full pixel coverage including every edge for layers from 1×1 to 16384×16384, within schema limits, with adjacent serpentine dabs; a fill built from a real `selectColor` flood validates through `validateDocument` and covers exactly the flooded area; selection intersection keeps full, removes zero and scales partial coverage; runs never merge across rows; selection detection |
| Browser / device testing | **NOT RUN** — Chromium download blocked; no hardware. Interaction wiring is type-checked only. |

## E. Round trips and regressions

Fills are normal strokes, so save/reopen, undo/redo, export and layer transforms follow the
already-tested stroke paths. No existing behaviour changed except that `G` now selects Paint Bucket
in Raster Studio. In Vector Studio, `G` still selects Vector Gradient, because shortcuts are
filtered per mode.

## F. Performance

Fill selection uses the existing worker flood fill (linear in pixels). Re-rendering a fill costs one
clipped stroke: at most 289 square dabs for a 16384 × 16384 layer, plus one selection
rasterisation. Large documents were not benchmarked in a browser.

## G. Findings and the decision needed for the rest of R3

| ID | Severity | Finding |
| --- | --- | --- |
| R3-01 | **Decision** | Smudge, blur/sharpen and dodge/burn/sponge change **existing pixels**. Inkstrip keeps original images as immutable assets and stores painting as editable strokes. These tools therefore need a stored result per stroke. The safe design follows the existing Healing/Patch pattern: the worker processes only the stroke's bounding box at native resolution, and stores a cropped immutable texture plus a brush mask. It needs (a) a new stroke field, (b) a native envelope version so older releases refuse such files instead of silently dropping the edits, and (c) an asset-budget policy, because each stroke adds an asset to a 64-asset / 48 MB pool. A "consolidate retouch strokes" action is proposed. |
| R3-02 | **Decision** | Pen tilt and image brush tips also add stroke fields, so the same envelope rule applies. Tilt cannot be validated without a tilt-capable pen. |
| R3-03 | Blocker | PR #6 already defines native envelope v6. Adding another schema change before #6 is merged would create two incompatible "v6" formats. **Recommendation: review and merge #6 first, then R3 continues on envelope v7.** |

## H. Proposed next step (not started)

1. Review and merge PR #6 (AI Studio F1), then re-base this branch on it.
2. **R3b:** retouch strokes (smudge, blur/sharpen, dodge/burn/sponge) on envelope v7, with
   cropped textures, a consolidation action and pixel-reference tests per kernel.
3. Or, if you prefer to keep moving without touching the format: skip to **R4 (selections)**.
   Border/smooth selection, magnetic lasso and faster refine-edge need no schema change.

Phase complete. Awaiting explicit user approval before proceeding to the next phase, merging into main, or deploying to production.
