# PR #21 (Raster advanced tools) × R8

R8 (PR #19) is merged into `main` (`5f9c537`) and is the authoritative implementation for
advanced gradients and Gradient Fill layers. PR #21 was split to match: its duplicate
Raster Gradient tool was removed (`3ff3e4e`), and it is now integrated with R8.

## 1. What PR #21 contains

**Kept:**

- **Paths tab (Raster):**
  - Pathfinder in Raster;
  - path → selection and selection → path;
  - layer mask from path and vector mask from path;
  - vector-mask enable, remove and edit-as-path.
- **Appearance tab in Raster:** multiple fills and strokes, alignment, opacity, blend.
- **The legacy Vector rule update.**
- **Unit and browser tests** for all of the above.

**Removed** (duplicated R8):

- the `layer-gradient` tool, its handles and presets;
- the `radialShape` field and the Shift+G shortcut.

`gradient.ts`, `pro-canvas.tsx`, `pro-tools.ts`, `pro-appearance.tsx` and
`pro-studio.css` carry no PR #21 changes. Gradients, Gradient Fill layers and their editor
are exactly R8's.

## 2. Integration with R8 (`main` @ `5f9c537`)

- **Merge of `main` into PR #21:** no conflicts.
- **Integration fix:** R8 rejects Smart Filters on layers with extended vector appearance.
  - The Appearance tab now explains this on Smart-Filtered layers instead of offering edits
    the document would refuse.
  - First validated on the temporary branch `tmp/pr21-r8-integration`, now part of PR #21.
- **Combined regression:** `test:pr21-r8:browser` (1440 and 390 px), one schema 3 document
  with an R8 colour-overlay style, a Smart Filter and an advanced Gradient Fill. It checks:
  - only R8's Gradient Fill tool exists, and G stays the Paint Bucket;
  - Pathfinder Unite next to R8 layers, with pixels, undo and redo;
  - path → selection coverage and selection → path;
  - a vector mask on an R8-styled shape clips the styled result, with pixels and undo/redo;
  - a layer mask from a path on a Smart-Filtered layer keeps the filter stack;
  - Appearance is blocked with an explanation on filtered layers and works elsewhere;
  - save, close and reopen: identical layers, and a pixel-identical export and preview.

## 3. Remaining limitations

- **R8's Smart Filter rule** also applies to paths created by PR #21 (selection → path,
  released vector masks, Pathfinder results), because they draw beyond their bounds. They
  can carry layer styles, not Smart Filters, unless rasterized. This is the same as
  Pathfinder results in Vector mode.
- **Gradient enhancements deferred to R8's model** (migration plan §5.1):
  - circular radial gradients;
  - Shift+G;
  - drag-to-create on the canvas;
  - a center handle;
  - tool presets.
