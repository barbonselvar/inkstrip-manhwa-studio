# R6 Artboards release blocker: confirmed cause and fix

PR16: https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/16. Keep Draft, no merge/deployment, and retain the release authorization hold. The release candidate under investigation is `2dac5cbadf67c8feb768010c5ebbae93fa9ba6eb`: main `e1c21546110c4a469250695539b64ad3b34e347a` (Chapter PR18) plus R6 head `82f237a10a87baf78a5470f4b293e61bbee5bbad`. No R7 changes were imported or modified.

## Confirmed reproduction and classification

The unchanged `scripts/artboards-browser-check.mjs` fails again on the preserved, unmodified release candidate at line349: after **Fit selected board**, native preview width is1400 instead of64. Its64×64 bounds and pixel assertions remain unchanged.

A MutationObserver probe records the first committed SVG viewport and actual canvas state, then observes the real worker complete. It uses no artificial delay, worker mock or tolerance:

| State                          | Original release candidate | Current main      | Fixed R6       |
| ------------------------------ | -------------------------- | ----------------- | -------------- |
| Selected board                 | east                       | east              | east           |
| New viewport                   | 10000,0,64,64              | 10000,0,64,64     | 10000,0,64,64  |
| Previous bitmap at that commit | 1400×18                    | 1400×18           | 1400×18        |
| Reported `aria-busy`           | false (incorrect)          | false (incorrect) | true (correct) |
| Eventual worker bitmap         | 64×64                      | 64×64             | 64×64          |
| Pixel16,16 after completion    | 255,0,0,255                | 255,0,0,255       | 255,0,0,255    |

JSON observations are in `r6/artboard-blocker/`. Main's full Artboards suite happened to pass its ordinary timing, but the focused transition test fails there. The R6 candidate's unchanged full suite failed on the first rerun, and the focused test fails on both old builds. This is a pre-existing readiness defect exposed by scheduling, not an invalid64px test assumption or R6 color calculation. Git blame traces the old document/before-only readiness guard to `7774fff99a3b737a8f8a73a0e86a187e838e5e1d`, before R6.

The fit/zoom path selects the correct board and commits the correct viewport. The worker receives those bounds and produces the correct pixels. The failure is the interval after React commits new viewport geometry but before the passive render effect updates `rendering`: readiness compares only the immutable document and before/after mode. Fitting changes the viewport without changing that document. The old1400px workspace image can therefore be read as ready in the new64px viewport. Generation checks also advance in the passive effect, leaving an adjacent window where an earlier reply/error can still act on the canvas.

## Implementation

- `src/lib/studio/pro/preview-target.ts` snapshots the actual render view alongside immutable document identity: mode, before/after, complete vector frame (including origin/background), worker asset/init epochs, resource budget and quick-editor mode. Raster requests omit unused vector-frame data.
- `src/components/studio/pro/pro-workspace.tsx` records which target was actually presented. Readiness derives from requested versus displayed targets during render, so the first new-viewport DOM commit is pending. A lightweight layout effect commits the latest target ref before asynchronous replies/passive effects can run. Both successful and failed older requests are rejected; stale bitmaps are closed.
- Existing generation checks, document identity guard for committed strokes, dirty-region presentation, existing70ms render debounce, worker pipeline, history, masks, native schema2/envelope8 and source assets remain in place. No delay constant, image algorithm, fit formula, dimension or pixel tolerance was changed.

## Focused tests

Eight unit tests cover workspace→64px focus, equal-sized boards at different origins, frame size/background, document/before revisions, worker/resource/quick mode, raster/vector transitions, frame snapshots and unloaded state.

`test:preview:browser` observes the first committed view rather than sleeping for a presumed result. It requires pending status immediately, then the real worker's exact64×64 bitmap and red/blue pixels. It switches between ±10000px boards of the same size four times at1440/390/320px and verifies document, asset and history equality. The same test fails on the old candidate and current main, then passes with the fix. The original Artboards suite is unchanged and passes the initial fixed run.

## Final validation record and decision

The fix is committed before complete validation so tests can run on an immutable, exact PR HEAD and its GitHub merge candidate with current main. Final commit SHA, repeated Artboards runs, full unit/browser/config results, exact-head CI and GO/NO-GO are recorded in the latest **release blocker validation** section of PR16 and in the execution's `R6_RELEASE_REPORT.md`; those records supersede earlier implementation/release snapshots. This report does not predeclare unrun checks as passing.

Technical GO requires all complete gates to pass without weaker assertions. PR16 must remain Draft, with no merge/deployment, awaiting renewed explicit release authorization even after technical validation succeeds. R7 PR17 is outside the fix.
