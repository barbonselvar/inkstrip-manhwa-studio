# PR #21 (Raster advanced tools) × R8 (layer effects, Smart Filters, gradients)

Read-only assessment of `codex/r8-layer-effects-smart-filters-gradients` at `244a1d6`
against PR #21 at `3d17b06`. Nothing on the R8 branch was modified; the merge trials
ran in a detached scratch worktree.

## Merge trials

| Combination                 | Result                                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| `main` (PR #20 merged) + R8 | Clean. R8's `3ce5ddc` already avoids the PR #20 hook conflict.                 |
| `main` + PR #21 + R8        | **3 conflicting files:** `gradient.ts`, `pro-canvas.tsx`, `pro-appearance.tsx` |

## Shared files

| File                                           | PR #21                                                                   | R8                                                                                                               | Merge                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/lib/studio/pro/gradient.ts`               | optional `radialShape` on `Gradient`; circular radial in `gradientField` | gradient v2: `version`, angular/reflected/diamond, interpolation, reverse, smoothness, midpoints, strict v2 keys | **Conflict** (type and `gradientField`)         |
| `src/components/studio/pro/pro-canvas.tsx`     | `layer-gradient` tool: new layer on drag, start/end/center handles       | `gradient-fill` tool: endpoint handles on an existing Gradient Fill layer                                        | **Conflict** (pointer-down and update branches) |
| `src/components/studio/pro/pro-appearance.tsx` | radial-shape select and "Reverse stops" in `GradientFields`              | v2 gradient editor (interpolation, smoothness, reverse, advanced stops), advanced effects                        | **Conflict**                                    |
| `src/components/studio/pro/pro-tools.ts`       | `layer-gradient` ("Gradient", Shift+G)                                   | `gradient-fill` ("Gradient Fill", no key)                                                                        | Auto-merges, but leaves **two gradient tools**  |
| `src/components/studio/pro/pro-workspace.tsx`  | Paths tab, path handlers, gradient tool options, Shift+G                 | R8 lab/drafts, "New Gradient Fill", `gradient-fill` gating                                                       | Auto-merges                                     |
| `src/components/studio/pro/pro-properties.tsx` | help-text line                                                           | `appearanceControls` slot                                                                                        | Auto-merges                                     |
| `package.json`                                 | `test:raster-advanced:browser`                                           | `test:r8:*` scripts                                                                                              | Auto-merges                                     |

## Overlapping features

- **Gradient creation and editing (duplicate).** Both add a Raster gradient tool that
  creates a selection-masked gradient layer and edits its endpoints. R8's version is
  more complete (v2 kinds, OKLab, midpoints, smoothness, R8 drafts and presets).
- **Gradient stop editing.** PR #21 adds "Reverse stops"; R8 adds a v2 `reverse` flag and
  an advanced stop editor.
- **No overlap:** PR #21's Paths tab (Pathfinder in Raster, path ↔ selection, layer and
  vector masks from paths, vector-mask editing), the Appearance tab in Raster and the
  legacy-Vector rule change. R8 does not touch `legacy-vector.ts`, `path-selection.ts`,
  `pro-paths.tsx` or the vector-clip model.

## Native document compatibility risk (verified)

A PR #21 document with a circular radial gradient (`radialShape: "circle"`, v1 gradient):

- **Opens in R8 without error** (R8 does not check unknown v1 gradient keys).
- **Renders differently in R8.** R8's `gradientField` ignores `radialShape`. At 20 px
  below the center of a 200 × 100 layer with scale 0.4, PR #21 renders 0.500 and R8
  renders 1.000, so the circle becomes an ellipse.
- **Cannot be upgraded to R8 v2 as is.** R8's strict v2 keys reject `radialShape`
  ("Invalid advanced gradient options.").

If PR #21 ships before R8 and users save circular radial gradients, merging R8 later
would silently change how those documents look.

## Recommendation

1. **Do not merge PR #21 in its current form ahead of R8.**
2. **Preferred:** split PR #21.
   - Merge the non-overlapping part first: Paths tab, path/selection/mask tools,
     Appearance tab and the legacy-rule update.
   - Drop PR #21's Gradient tool and `radialShape`, and let R8's Gradient Fill be
     the single Raster gradient tool.
   - After R8 lands, add only what R8 lacks (e.g. a circular radial option as an R8 v2
     field, a keyboard shortcut that keeps the Paint Bucket on G), on top of R8's model.
3. **Alternative:** merge R8 first, then rebase PR #21's gradient work onto R8's v2 model,
   replacing `layer-gradient` with R8's `gradient-fill` plus any missing handles.
4. Either way, coordinate with the R8 owner before touching the R8 branch; this
   assessment made no changes to it.
