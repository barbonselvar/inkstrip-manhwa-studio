# PR #21 (Raster advanced tools) × R8 (PR #19)

R8 (`codex/r8-layer-effects-smart-filters-gradients`, PR #19) is the authoritative
implementation for advanced gradients and Gradient Fill layers. PR #21 was split
accordingly: its duplicate Raster Gradient tool was removed (`3ff3e4e`). Nothing on the
R8 branch was modified.

## 1. What changed in PR #21

**Removed** (duplicated R8):

- `raster-gradient.ts` and its tests: the `layer-gradient` tool, drag geometry, handles and
  tool presets.
- The `radialShape` gradient field: `gradient.ts` is identical to `main`.
- The Shift+G shortcut and the gradient tool options.
- PR #21's edits to `pro-canvas.tsx`, `pro-tools.ts`, `pro-appearance.tsx` and
  `pro-studio.css`: all four files are identical to `main`.

**Kept:**

- Paths tab: Pathfinder in Raster, path → selection, selection → path, layer mask from
  path, vector mask from path, vector-mask enable/remove/edit-as-path.
- Appearance tab in Raster: multiple fills and strokes, alignment, opacity, blend.
- The legacy Vector rule update.
- Unit and browser tests for all of the above.

Gradient layers, their Properties editor and renderer are unchanged from `main`. PR #21
no longer adds or changes any gradient document field.

## 2. Integration check: main + R8 + PR #21

Local temporary branch `tmp/pr21-r8-integration`, never pushed:

- base: `main` `bfcbdf9`;
- plus R8 `27d9366`, the PR #19 head;
- plus PR #21 `3ff3e4e`.

- **Merge:** no textual conflicts (previously three).
- **Integration-specific fix (on that branch only):** R8 rejects Smart Filters on layers
  with extended vector appearance. The Appearance tab now explains this on Smart-Filtered
  layers instead of offering edits the document would refuse. Apply this once both PRs
  are on `main` (see §4).
- **Unit tests:** 1,015 pass (R8's 1,007 plus PR #21's 8). Typecheck, lint, production
  build, `check:build` and `check:auth` pass.
- **Browser regression:** 46 of 47 runs pass, covering:
  - all 43 registered suites, including the 6 R8 suites (foundation, UI, styles,
    processing, gradient, recovery), Pathfinder, vector, appearance, Dialogue, R2–R7;
  - `pr21-r8-integration` and `raster-advanced`, each on the dev server and on the
    production build.
  - The one failure is `test:studio:browser`, which cannot reach `huggingface.co` from
    the sandbox (environment).
- **New `scripts/pr21-r8-integration-browser-check.mjs`** (on the integration branch),
  at 1440 and 390 px, using one schema 3 document with an R8 colour-overlay style, a
  Smart Filter and an advanced Gradient Fill. It verifies:
  - one gradient tool only (R8's Gradient Fill), and G stays the Paint Bucket;
  - Pathfinder Unite next to R8 layers, with pixels, undo and redo;
  - path → selection coverage and selection → path;
  - a vector mask on an R8-styled shape clips the styled result, with pixels and undo/redo;
  - a layer mask from a path on a Smart-Filtered layer keeps the filter stack, with pixels;
  - Appearance is blocked with an explanation on filtered layers and works elsewhere;
  - save, close and reopen: layers identical, PNG export and preview pixel-identical
    (tolerance 0).

## 3. Remaining integration risks

- **Integration fix not yet in either PR:** the Appearance message for Smart-Filtered
  layers (§2) depends on R8's `smartFilters` field, so it can only land after R8. Without
  it, editing Appearance on a filtered shape fails safely with R8's validation error.
- **R8's Smart Filter rule** also applies to paths created by PR #21 (selection → path,
  released vector masks, Pathfinder results), because they draw beyond their bounds.
  They can carry layer styles, not Smart Filters, until rasterized. This is the same as
  Pathfinder results today.
- **Shared files** both PRs edit: `pro-workspace.tsx`, `pro-properties.tsx`,
  `package.json`. They auto-merge today; later edits on either side may need rebasing.

## 4. Recommended merge order

1. **R8 (PR #19) first.** It owns the gradient model and the schema 3 native format.
2. **Then PR #21**, updated with `main` (which then includes R8), plus the §2 Appearance
   message and the integration browser check.
3. **Before each merge,** re-run the full regression, including the R8 suites and
   `pr21-r8-integration`.

## 5. Deferred to R8's gradient model

To be built later on R8's native v2 gradients, never as a separate engine:

- **Circular radial gradients:** an R8 v2 option, so R8 validates and renders it.
- **Shift+G** for Gradient Fill; the Paint Bucket keeps **G**.
- **Drag-to-create** a selection-masked Gradient Fill in one canvas gesture.
- **A center handle** to move a linear gradient without changing its length or angle.
- **Tool presets** with opacity stops, and one-click stop reversal, where R8 lacks them.
