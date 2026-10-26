# R9 implementation report — precision vector editing in Raster Studio

R9 brings precision vector editing into Raster Studio: path operations, text on a path,
rulers and guides, alignment to the canvas and parametric shapes. It reuses the existing
Pro engines and is integrated with R8 (layer styles, Smart Filters, advanced gradients) and
PR #21 (Pathfinder, path ↔ selection, masks from paths, Appearance).

Architecture: [R9_ARCHITECTURE.md](R9_ARCHITECTURE.md). Evidence: [R9_TEST_REPORT.md](R9_TEST_REPORT.md).

## Revisions

- Development history: `47b6d4f` (R9.1–R9.4) and `7759fd8` (R9.5) on
  `ccr-r9-vector-precision`, branched from main `bfcbdf9` (before R8 and PR #21).
- Integration branch: `ccr-fa0c8f59-fprl9n` = R9 history + merge of main `db78593`
  (R8 #19 and PR #21) + the integration fixes below. `ccr-r9-vector-precision` itself was
  left unchanged.

## Features

| Area              | Delivered                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path operations   | Properties → anchor editor: **Split** at an anchor (opens a closed contour; cuts an open path into two layers), **Join** two open paths at their nearest endpoints (across transforms), **Smooth** one or all anchors, **Simplify** with a px tolerance. All undoable.                      |
| Text on a path    | The existing Text on Path tool (**Shift+T**) and Typography tab work in Raster Studio. Dialogue Studio's path-text note now points to Raster's Typography tab.                                                                                                                              |
| Rulers & guides   | Horizontal/vertical rulers (**Ctrl/⌘+R**, px or %), zoom/pan/quarter-turn aware, touch-capable. Drag from a ruler to add a guide, drag with Move to reposition, drop on its ruler to delete; per-guide lock/delete, lock/unlock all, clear unlocked. Guides persist and are never exported. |
| Alignment         | Precision tab in Raster (snapping, guides, align & distribute) plus a new **Canvas** reference.                                                                                                                                                                                             |
| Parametric shapes | **Star** tool; rounded-rectangle corner radius; polygon sides; star points and inner radius. Older documents keep their exact geometry.                                                                                                                                                     |
| SVG               | Stars, rounded rectangles, polygons, compound even-odd paths, transformed shapes and text on a path export and re-import pixel-identically through the existing safe SVG pipeline.                                                                                                          |

## Reused, not recreated

Bézier/contour model and anchor editor, `precision.ts` guides/snapping/align/distribute,
`text-path.ts` text-on-path engine and Typography panel, `shapePath` geometry, SVG
export/import and its sanitiser, R8 gradient/style/Smart Filter engine, PR #21
Pathfinder/Paths/Appearance. No new tool duplicates an existing one; the only new tool is
Star (the Text on Path tool already existed and is now enabled in Raster).

## Integration with current main (R8 + PR #21)

Merge conflicts (5 files) were resolved as the union of both sides:

- `legacy-vector.ts` (+ test): R9 moved text on a path into Raster, PR #21 moved
  Appearance stacks and vector masks into Raster, so only **artboards** still reveal the
  legacy Vector Studio.
- Inspector tab filter (`pro-workspace.tsx`): Paths stays Raster-only; Pathfinder and
  Artboards stay Vector-only; Appearance, Precision and Typography are shared.
- `RASTER_TOOL_IDS`: keeps R8's `gradient-fill` and R9's `text-path`.
- `package.json`: both sides' browser-suite scripts (no dependency changes).

Semantic review of the auto-merged files (`pro-canvas.tsx`, `pro-properties.tsx`,
`model.ts`, mode-switch tab handling) and the regression matrix found two real defects,
both fixed:

- **Join discarded R8 Smart Filters (`d923245`).** Joining removes the second path; a Smart Filter
  stack on it was silently lost. R8 already forbids this for Pathfinder/Compound
  (`130410b`); Join now applies the same rule (either operand filtered → refused with an
  explanation, document unchanged). The new unit test fails without the guard and passes
  with it; the new browser suite checks the refusal in the UI.
- **Inspector tab bar grew a row (`7c47847`).** With PR #21's Paths and R9's Precision and
  Typography tabs, Raster's 3-column tab grid wrapped to five rows, taking 48 px from every
  panel and breaking `test:layers:browser`'s drag reorder (main and R9 alone pass; the merge
  failed — bisected with production builds). Bars with 13+ tabs now auto-fill 4rem columns:
  four at the default 300 px panel (the earlier height), three when narrower, five when
  wider; no label clips between 260 and 420 px. Vector mode and 11-tab bars are unchanged.

A new browser suite, `test:r9:integration:browser`, edits one R8 schema-3 document (colour
overlay, Smart Filters, Gradient Fill) with every R9 tool at 1440 and 390 px.

## Native compatibility

No schema or envelope change and no migration on open. `shapeOptions` is optional and
strictly validated in schema 2/3; R8 schema-3 documents with styles, Smart Filters and a
Gradient Fill accept R9 edits and reopen with identical layer data and pixels.
Forward compatibility (older app, newer file) is described in the architecture document.

## Performance

Simplify, 900 anchors at 2 px on the validation machine: 44.1 s before the R9.5 rewrite
(`47b6d4f`, which also overshot the tolerance at 2.238 px) → 84 ms now, within tolerance.
Snapping per pointer move 0.009 ms and path operations ≈ 1–2 ms on an 800 × 16000 page.
Full numbers: [test report](R9_TEST_REPORT.md#performance-4-core-sandbox-node-22-not-a-device-guarantee).

## Migration

None required. No document is rewritten on open; there is no schema or envelope change.

## Known limitations

- **Arabic/RTL text on a path is refused** (pre-existing since Phase D, `6ace302`): glyphs
  are placed one grapheme at a time, which cannot shape contextual scripts. The refusal is
  transactional (document unchanged). Arabic/RTL remains supported in ordinary text and
  Dialogue Studio.
- Join works on two open single-contour paths in the same group; compound paths must be
  released first; perspective/warp must be applied first.
- Rulers hide under free (non-quarter-turn) view rotation and explain why.
- A pre-R9 build opening a schema-1 file with corner radius / polygon sides draws the
  pre-R9 geometry (see architecture).
- Browser validation is Chromium emulation (desktop, tablet and touch phone viewports),
  not physical devices.
- The AI Enhance browser check could not run (model host unreachable from the validation
  sandbox; identical on main). Live production checks could not run from the sandbox either
  (see the PR for the deployment record).

## Deferred / next priorities

- Shaped (HarfBuzz-style) text on a path so Arabic/RTL can follow curves.
- Join for compound paths, and Join that keeps Smart Filters by re-basing the source plane.
- Smart guides (on-canvas alignment hints) and ruler origin dragging.
- An optional forward-compatibility fence for schema-1 documents that use new shape options.
