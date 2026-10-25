# R7 validation report — Advanced Selections, Precision Masks & Selection-Aware Editing

**Runtime under test:** `8f2134d87e1c10da53fbe7740a986adcd4dcd1c6` on
`claude/r7-advanced-selection-masks`. The commit adding this report changes only documentation;
its SHA and GitHub Actions status are recorded in
[Draft PR #17](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/17).

**Base:** `main` @ `740720c1d5e141c7f52ecab83d2e505fea7183f0` (R5 merge, includes R1–R3). It is
still the tip of `main`.

**Environment:** Node 22.22.0 and Playwright 1.64.0 with the preinstalled headless Chromium, on a
Linux cloud executor.

**Not claimed:**

- No physical device, stylus, Safari or Firefox result. Touch results come from Chromium touch
  emulation.
- No Vercel production contact or deployment.

Per-command results are in [`r7/validation.json`](./r7/validation.json).

## Unit, static and build gates

| Gate                  | Result                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm test`            | **856 passed, 0 failed** (200 script + 59 app/auth + 91 Studio + 506 Pro). 848 before R7, plus 8 new R7 tests          |
| `npm run typecheck`   | Passed, including the config project                                                                                   |
| `npm run lint`        | Passed                                                                                                                 |
| Prettier (R7 files)   | Passed for every file R7 changes or adds. The repository has 87 older files that are not Prettier-formatted, unchanged |
| `npm run build`       | Passed                                                                                                                 |
| `npm run check:build` | Passed: Vercel server, browser/AI runtime assets, PWA icon, tslib bundling                                             |
| `npm run check:auth`  | Passed: dev and build agree, sign-in off                                                                               |
| `git diff --check`    | Passed                                                                                                                 |
| GitHub Actions        | `validate`, `build` and Vercel Preview Comments succeeded on `8f2134d`. PR mergeable state: clean                      |

The new unit tests (`selection-tools.test.ts`) cover:

- replace mode with inverted selections;
- marquee ratio, square and centre constraints;
- lasso spacing and the 5,000-point cap;
- OKLab conversion and perceptual versus RGB wand counts;
- Color Range include/exclude, fuzziness, transparent pixels and input validation;
- alpha regions;
- Expand, Contract, Border and Smooth, including canvas edges, empty and narrow selections, and
  invalid amounts.

## Browser regression on the development server

All browser commands in `package.json` ran sequentially with their original assertions:
**29 of 31 passed**.

| Command                                                                                                       | Result                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| editor, adjustments, retouch, workflow, ui                                                                    | pass                                       |
| pro (Magic Wand/Color Range step now clicks **Apply color range**; assertions unchanged)                      | pass                                       |
| layers, repair, geometry, transform, color, appearance, vector, compound, pathfinder, artboards, vector-final | pass                                       |
| raster-refinement, homepage, chapter-import                                                                   | pass                                       |
| dialogue ocr / browser / workflow / render / security                                                         | pass                                       |
| r2 document                                                                                                   | pass                                       |
| **r3 brush** (433 s)                                                                                          | pass                                       |
| **r5 transform/geometry**                                                                                     | pass                                       |
| **r7 selection** (new)                                                                                        | pass                                       |
| r2 gesture                                                                                                    | see note 1; passed on the production build |
| studio (Swin2SR neural enhance)                                                                               | see note 2: environment limitation         |

1. `r2-gesture-browser-check` defaults to the built preview on port 8081, which was not running
   during the dev pass, so it failed to connect within 1 s. It passed against the production
   build (next section).
2. `studio-browser-check` failed at "Running real Swin2SR inference" with
   `Request failed: huggingface.co net::ERR_TUNNEL_CONNECTION_FAILED` and then
   `Failed to fetch`. This is confirmed to be unrelated to R7:
   - The model URL is hard-coded in `src/lib/studio/enhance/worker.ts`.
   - A direct `curl https://huggingface.co/` through the environment proxy returns
     `CONNECT tunnel failed, response 403`.
   - R7 changes none of the files that use the model (`enhance/worker.ts`,
     `enhance-dialog.tsx`, `pro-inspector-tabs.tsx`). Every R7 runtime change is confined to
     `src/lib/studio/pro/` and `src/components/studio/pro/`.

   The network policy was not bypassed. The same suite has failed the same way in this
   environment since earlier rounds.

## Production build (local, `npm run preview:restart` on 127.0.0.1:8081)

| Check                                                                | Result                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `r7-selection-browser-check` at 1440/768/390/360/320                 | pass, 0 browser errors                                                                           |
| `r2-gesture-browser-check`                                           | pass                                                                                             |
| `r5-browser-check` at 1440/768/390/360/320                           | pass                                                                                             |
| `production-vector-check <url> 8f2134d… --raster`                    | pass: raster, SVG, gradient, Pathfinder, chapter; no errors or failed critical assets            |
| `browser-smoke` desktop and mobile, with the dev verdict as baseline | pass: no console errors, no divergence from dev. Screenshots inspected                           |
| `r3-brush-browser-check`                                             | not applicable to built output: it imports `/src/...` modules from the dev server. Passed on dev |

## What `test:r7:browser` proves

The suite uses only the real UI, worker and storage; there are no app hooks or mocked results. It
runs at 1440, 768, 390, 360 and 320 px, with touch emulation below 800 px:

- **Lasso past the limit** (1440 px): 6,300 pointer moves commit one lasso region of exactly
  5,000 points. The point-limit notice remains visible after release.
- **Polygonal lasso**: Backspace removes the last point and the layer is not deleted. Enter
  commits the remaining three points.
- **New selection with a 1:1 marquee**: produces one region with equal width and height.
- **Region limit**: a 100-region selection plus one more marquee compacts to one pixel region.
  Coverage is correct inside the old and new rectangles and empty between them.
- **Color Range**:
  - the live preview covers the sampled colour;
  - **Cancel** restores the stored selection exactly (deep-equal) and adds no history entry;
  - **Apply** adds exactly one history entry and keeps the earlier selection.
- **Modify**: Expand 4, Contract 4, Border 4 and Smooth 4 each produce the expected coverage at
  specific pixels. Undo returns to the exact original selection.
- **Masks**:
  - Selection from mask matches the mask's area, and the mask is unchanged.
  - Add selection to mask keeps the old revealed area, reveals the new area, keeps everything
    else hidden, and preserves the enabled state.
- **Clipboard**:
  - Copy/Paste creates a 16×12 layer at (40, 20) with its own asset, and the composite is
    unchanged.
  - Cut removes only the selected pixels; every pixel outside the selection is identical.
  - Paste after Cut restores the composite, and Undo restores it too.
  - Ctrl+J creates a layer while the composite stays the same.
- **Quick Mask**:
  - Export is blocked while it is active.
  - The real Brush adds coverage and the Eraser removes it.
  - Exiting with Q gives the expected pixel selection and removes the temporary layer.
  - The artwork composite is pixel-identical afterwards.
  - Undo returns to Quick Mask.
- **Persistence**: Save, close and reopen keep the selection, and the exported PNG matches the
  original artwork.
- **Layout**: no horizontal overflow. The canvas and Selection tools panel screenshots at each
  width were inspected.

## Compatibility with `main`, R3 and R5

- `main` has not moved since R7 branched (`740720c`). The PR is mergeable without conflicts and
  CI passes on its head.
- **R3**: the `r3-brush` suite (dev) passes. Quick Mask paints with the unmodified R3 engine, and
  the selection-clipped painting assertions in `pro-browser-check` still pass.
- **R5**: the `r5` suite passes on dev and on the production build. R7 Copy, Cut and Layer via
  Copy/Cut call the same `stageSelection` path and eligibility rule as R5. The R5 unit tests are
  among the 856 that pass.

## R6 (Draft PR #16, head `21fafe0`) integration check

R6 has progressed since R7's gap analysis: it now edits `pro-workspace.tsx`, `worker.ts`,
`client.ts` and `package.json`. A trial merge of R6 into R7 was made in a throwaway worktree. It
was not pushed and has been deleted.

- **Conflicts**: `package.json` (both add scripts), `worker.ts` (both add a message handler at
  the same place) and `pro-workspace.tsx` (3 hunks: R6's Color & Filters button, R7's
  mask-replace notice and R7's Selection tools panel). All are additive; keeping both sides
  resolves them, with no logic choice needed.
- **Results on the merged tree**: typecheck and lint pass, and **896 unit tests pass** (R7's 856
  plus R6's 40). On its production build, `r6-color-browser-check`, `r7-selection-browser-check`
  and `r5-browser-check` all pass.
- **Design fit**: R6 already limits colour operations to the document selection, rendered with
  `selectionCanvas` ("Limit operation to captured selection"). That is the single selection
  source R7 assumes, so R7 pixel regions and compacted selections work there unchanged.
- **Follow-up work for whichever PR merges second**, small and not blocking:
  1. Resolve the three additive conflicts above.
  2. Ignore R7's selection shortcuts (Q, Ctrl/Cmd+C/X/V/J) while R6's Color & Filters draft is
     open, as they are already ignored during transform and crop drafts.
  3. Disable Color & Filters while Quick Mask is active, so the temporary Quick Mask layer
     cannot be chosen as a colour target.
  4. Optional cleanup: R7's `color-distance.ts` (OKLab) and R6's `color-engine.ts` could share
     one colour conversion.

## Failures found and fixed during R7 validation

- The lasso point-limit message was reported as an error, and the commit on pointer release
  cleared it. It is now a status, so it stays visible (`b361b30`).
- The suite's first draft opened tabs and exported while the mobile panel was collapsed, and
  used a default brush size larger than the test rectangle. Only test helpers changed (panels
  are opened first and the brush size is set explicitly); no runtime rule was relaxed.
- No existing assertion was weakened. The only change to an existing suite is the extra
  **Apply color range** click, because Color Range now previews before it commits.

## Known limitations

- Hugging Face model downloads are blocked in this environment, so the Swin2SR Studio suite
  cannot run here (see note 2).
- No physical device testing. Touch coverage is Chromium emulation.
- The pixel clipboard is in memory, per workspace; there is no operating-system clipboard bridge.
- Add selection to mask merges the existing mask into one pixel mask. The result looks the
  same and Undo restores the original.
- Hair and subject segmentation is not implemented and not simulated.
- Pixel copy and cut have the same eligibility as R5: affine raster or paint layers on
  canvases up to 4 MP.
