# R8 / Claude branch integration analysis

Read-only inspection; this R8 task has not merged or changed an upstream branch. The original tested base was R7
`02eb697450a7eeeadbd53d73cea5931905c5b2f2`. PR20 was merged externally at
11:13:57 UTC on 2026-10-26; current main is
`bfcbdf99248e75bfe10d8d1df6d71bb5acd6a596`. R8 did not merge it.
Current-main validation is being run separately; earlier results are not
represented as validation of this new base. R8 application/QA HEAD is
`130410b97f65827861a84c520a93a31d2212f202`.

## Actual Git results

| Branch | Inspected HEAD | Actual content conflicts |
| --- | --- | --- |
| PR20, externally merged Vector deactivation | `2d46f490eceec8371ca8cc48d80deaf1e9d5f5b4` | None |
| Draft PR21, Raster advanced tools | `516267f1b24b397b5094f9178a62fe5facd3aa82` | `src/components/studio/pro/pro-appearance.tsx`, `src/components/studio/pro/pro-canvas.tsx`, `src/lib/studio/pro/gradient.ts` |

PR21 contains the inspected PR20 commit. Do not separately apply both streams or
cherry-pick their overlapping work. `git merge-tree --write-tree` writes only a
simulation tree and does not change a branch/index/worktree. Combined behavioral
tests have not run. [Machine-readable evidence](r8-evidence/parallel-integration.json).

PR20 shares package.json, browser fixtures, Properties and Workspace. Its legacy
entry hook and R8's adjacent draft hook now merge cleanly; native9 fixture dispatch
and its hidden-Vector access must both survive integration. R8 has not modified
homepage/navigation, Chapter entry points or Vector activation.

PR21 additionally shares Appearance, Canvas, Tools and gradient.ts. Appearance's
imports and legacy reverse-stop controls overlap R8's version2 editor. Canvas
conflicts are pointer-down handling, draft gradient calculation and handle
rendering. gradient.ts conflicts are the stop type and radial field branch.

## Behavioral and native risks (distinct from Git conflicts)

1. PR21 adds `layer-gradient` and Raster Shift+G; R8 adds `gradient-fill` with five
   types and transactional creation/editing. A textual merge can expose duplicate
   tools or route pointer events through the wrong draft. Consolidate the routing
   while preserving selection masks, source-local coordinates, Escape/touch
   cancellation, one-entry Apply, R5 transforms and all five R8 kinds. Do not
   replace R8's geometry with PR21's linear/radial-only helper.
2. PR21's `radialShape: circle` is absent from R8's gradient model. R8 advanced
   definitions reject unknown fields; its legacy sampler does not interpret that
   flag. Accepting an unversioned PR21 circle as a legacy ellipse would change
   pixels. Before combining releases, define/validate/migrate its radial semantics
   explicitly and ensure older readers reject unsupported content. Keep midpoint,
   opacity, RGB/OKLab, smoothness, reverse and stop order intact. Reversing advanced
   stops also requires correct segment-midpoint handling; a simple position flip
   alone does not define that behavior.
3. PR21 exposes shared vector Appearance in Raster. R8 deliberately rejects Smart
   Filters on extended appearance/path-text/overflow planes. Preserve that guard
   and explain unsupported targets; do not silently crop, flatten or erase a stack
   when adding paints. R8's draft settings must not be committed through a second
   direct-properties path, and native schema3/envelope9/store5 must not downgrade.
4. PR21 adds Paths, path/selection conversion and vector masks. Define whether
   conversions use geometry or rendered coverage. Test transformed/feathered R7
   masks, Quick Mask exclusion, clipping/groups and styles derived from final
   masked alpha. Preserve R8 revision/lock/work limits on every new entry point.
5. Boolean/compound operations predated Smart Filters. Inspection reproduced loss
   of a filtered operand's stack in R8 even without PR21. R8 now rejects any
   retained stack, enabled or disabled, before those operations. Preserve these
   shared eligibility guards in PR21's Raster entry points. Users must explicitly
   remove the stack; an implicit destructive geometry conversion is unsafe.

## Safest future sequence

PR20 is already on main through an external merge. R8 is being tested against
that updated base without merging it into the development branch. Keep PR21
separate. Revalidate legacy navigation, native fixtures and R8 workflows before
reviewing a release against current main. Establish R8's
persistent rendering/format contract before porting PR21's overlapping gradient
and Appearance features. Rebase/integrate PR21 against that contract without
discarding either implementation; resolve the three concrete conflicts and the
auto-merged Workspace/Tools semantics together. Do not merge PR21 unchanged in
either order.

Then run both branches' complete regressions, including circular versus elliptical
radials in non-square layers, five R8 gradient kinds/128 stops, midpoint reverse,
non-destructive filter/appearance rejection, path/selection/mask conversion,
Boolean guards, native/recovery/export at tolerance0, R3/R5/R6/R7 and all five
screen widths. Recheck current PR heads and Git conflicts before that work. This
analysis is not authorization to merge, deploy or change Claude's branches.
