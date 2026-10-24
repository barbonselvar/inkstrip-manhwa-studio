# R3 test report — Professional Brush & Painting Engine

Branch `codex/r3-professional-brush-engine` · Draft PR #14 · validated code commit `49dce40`
(the final commit adds only this report; `src/`, `scripts/` and `package.json` are identical).

Environment: Linux sandbox, Intel Xeon 2.80 GHz (4 cores), Node 22.22, dependencies installed with
npm 11 from the lockfile as in CI (Node 24), Chromium 153 headless shell via Playwright. Touch is
emulated (CDP) below 800 px. Pen pressure uses synthetic CDP pen events.

## A. Static checks and unit tests

| Command                                | Result                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `npm run typecheck`                    | pass                                                                     |
| `npm run lint`                         | pass (0 problems)                                                        |
| `npm test`                             | **821 / 821** (200 + 59 + 90 + 472), 0 failed or skipped; 8 new R3 tests |
| `npm run build`, `npm run check:build` | pass                                                                     |
| `npm run check:auth`                   | pass (dev and build agree: sign-in off)                                  |

New unit tests (`src/lib/studio/pro/brush-engine.test.ts`):

- release catch-up across smoothing 0.3–0.95 and stabilization 0/20, including taps;
- a 60,000-sample slow stroke stays within one recording step of every sample, under the point
  cap, and validates;
- a stroke reaching the 10,000-point cap ends there and still validates;
- pressure curve maths and clamping; mouse/touch never record pressure; recorded pressure drives
  dab radius; release keeps the last real pressure; pressure-only changes are recorded;
- cursor footprint in rotated/non-uniformly scaled layer frames and in mask frames, square pencil,
  deform fallback;
- inking presets valid, distinct, existing fields only;
- duplicate/delete/override/reset behaviour;
- pressure preference persistence and corrupt-storage fallback.

## B. Pixel-level results (real `stroke()` in Chromium, asserted in `test:r3:browser`)

| Property                                                              | Measured                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| 100% hardness, flow 1, alpha 0/4/7/9/11 px from a 10 px radius centre | 255, 255, 255, 250, 0                                      |
| Hardness 1 / 0.5 / 0 at flow 0.25, offsets 0–9 px                     | 239…108 / 224…9 / 189…5 (strictly ordered at every offset) |
| Opacity 0.5 with overlapping passes in one stroke                     | 128                                                        |
| Flow 0.5: one dab vs a stroke                                         | 128 vs 255                                                 |
| Flow 0.2 under opacity 0.6                                            | 135 (builds toward, never past, 153)                       |
| Spacing 0.05 vs 1.0 diameters (flow 0.2)                              | 250 vs 51; gap pixel at 2.0 diameters is 0                 |
| Pencil square tip                                                     | only 0 and 255 values; edges exact                         |
| Eraser 50% on 60% red                                                 | alpha 153 → 77, red channel unchanged                      |
| Soft eraser profile                                                   | 35 → 110 → 230 from centre outward                         |

## C. Browser suites (Chromium, dev server, no edits during the run)

| Suite                                                               | Result                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **`test:r3:browser` (new)**                                         | **pass** at 1440, 768, 390, 360, 320                                                                                                        |
| chapter-import, r2, r2-gesture, homepage                            | pass                                                                                                                                        |
| dialogue, dialogue render / security / ocr                          | pass                                                                                                                                        |
| editor, adjustments, retouch, workflow, ui                          | pass                                                                                                                                        |
| pro, layers, repair, geometry, transform, color, appearance         | pass                                                                                                                                        |
| vector, compound, pathfinder, artboards, vector-final               | pass                                                                                                                                        |
| raster-refinement (preset save via inline field)                    | pass                                                                                                                                        |
| `production-vector-check --raster` on the built output at `49dce40` | pass, no console errors or failed assets                                                                                                    |
| dialogue workflow                                                   | timed out once at 180 s on the cold OCR model download; **passed on rerun**                                                                 |
| studio (real Swin2SR inference)                                     | not runnable here: `huggingface.co` is unreachable from the sandbox browser; it fails identically on `main` after the image decode succeeds |

`test:r3:browser` covers at every width:

- a smoothed (60%) and stabilized (12 px) stroke ends at the release point;
- brush and pencil strokes at 0°, 90°, 180° and 270° view rotation land on exact document
  coordinates;
- export is pixel-identical rotated vs upright;
- an eraser stroke at 90° removes real alpha locally;
- undo/redo restore and re-erase pixel-exactly;
- the cursor on a 2× scaled layer measures the true footprint; the pencil cursor is square;
- preset apply, save, duplicate, rename, delete; no horizontal overflow;
- native save/reopen keeps strokes and pixels.

At 1440 px it also covers:

- synthetic pen force 0.5 with curve 2 records pressure 0.25, while the mouse records none;
- a 13,200-sample stroke commits;
- painting in mask-edit mode goes to the mask, not the artwork.

**Before/after evidence (real UI, smoothing 60%, pen lifted at x=110):** `main` ends the stroke at
x=104.05; R3 ends it at x=110.00.

## D. Performance (`npm run bench:r3:brush`, 2048² OffscreenCanvas, median of 5)

10,000 raw samples (a 1 kHz mouse drawing for 10 s):

| Brush                              | Stored points, before → R3 | Render ms, before → R3                       |
| ---------------------------------- | -------------------------- | -------------------------------------------- |
| Default 24 px (legacy path)        | 10,000 → 7,451             | ≈147 → ≈110                                  |
| Hard 8 px (dab path)               | 10,000 → 9,120             | equal within run-to-run noise (35↔32, 68↔70) |
| Soft 200 px, flow 0.2, opacity 0.6 | 10,000 → 1,116             | ≈82 → ≈82                                    |

Recording costs 0.45–1.1 µs per sample. These are synthetic fixtures on one shared machine; they
are not interaction-latency or FPS claims. Preview composition is unchanged (R2 worker and dirty
rectangles).

## E. Not verified

- No physical stylus, Apple Pencil or Android device; pressure is verified only with synthetic
  Chromium events.
- Tilt is not implemented (format-deferred); see the implementation report.
- Other browser engines (Safari/WebKit, Firefox) were not run.

### Manual device checklist

1. Choose G-Pen, enable pen pressure, and draw light to firm: the line tapers.
2. Set the pressure curve to 2: light strokes get thinner.
3. With smoothing 60%, flick a fast line: it ends under the pen tip.
4. Rotate the view 90° and draw: the stroke lands under the pen.
5. Erase on a transparent layer: transparency appears, not a colour.
6. Edit a mask from its Layers thumbnail and paint: only the mask changes.
7. Save, reopen and export: strokes and pixels match.
