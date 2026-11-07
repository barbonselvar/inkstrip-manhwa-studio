# Freeform fade editor

Upgrade of the existing Composition & FX fade tools. Based on `main` at `649ab0c`.

## Root cause of the restrictions

1. **Rendering clipped every fade to its own image.** `paintPanel` clipped fade masks to
   the panel image rectangle, so nothing could reach chapter spacing or gutters.
2. **Canvas handles were clamped.** Boundary points were limited to `0..amplitude`
   (amplitude 10 in the reported project, so points could barely move) and x to `0..1`.
   Shaped fades had no whole-fade move or depth handle (the straight-fade bar was removed
   for shaped masks), so position was number-only.
3. **Position could not go negative.** `start` was validated and edited as `≥ 0`.
4. **Settings overlapped.** "Mask blur radius" actually blurred the _artwork_ under the
   fade, and "feather" lengthened the ramp, so softness, depth and blur were entangled.

## What changed

- **Model (additive, optional):** `x`/`width` (horizontal extent), `softness` (true
  mask-edge blur), `extend` (paint the band beyond the image into spacing). `start` may be
  negative. Saved fades without these fields render exactly as before (unit and browser
  tested); a fade only extends after an edit moves it past the image edge, or when the
  checkbox is turned on.
- **Renderer:** per-column boundary offsets (one profile evaluation per column instead of
  per pixel); softness blurs a padded mask on the global pixel grid so segmented export
  matches the preview; extending fades paint their band over spacing/gutters at the
  source's layer position. Artwork blur is unchanged and now labelled as such.
- **Canvas editor** (selected fade, any zoom, mouse/pen/touch with pointer capture):
  hatched band shows the transition region; drag the band or centre grip to move freely
  (narrowed fades also move horizontally); square handle sets depth; side bars resize the
  width; every Bezier/freehand point drags freely (amplitude and start adapt instead of
  clamping); double-click the line to add a point, double-click a point to remove it;
  draw a new freehand boundary (also into spacing) and edit it afterwards point by point.
  Other fades on the panel show dashed outlines with name chips; clicking a fade's band
  on an already-selected panel selects it, repeated clicks cycle overlapping fades.
- **Inspector:** name, Hide/Lock, sliders with exact number entry for Density (0–100 %),
  Fade depth, Softness, Fade position and Falloff curve; Shape (shape, placement, shape
  height, frequency, reverse direction, flip curve, draw, convert to editable points,
  smooth path, remove point); Horizontal extent (position, width, extend into spacing);
  color/transparency; Reset position / shape / settings; Duplicate and Delete. Numeric
  legacy settings, feather, artwork blur and blend stay under **Advanced**. Classic
  top/bottom fades convert to an editable boundary with identical pixels.
- **Effects list:** every panel's fades listed topmost-first with recognisable names
  (`Wave fade`, `Wave fade 2`, …), a description (shape · placement · depth · density),
  selection highlight, show/hide, lock, reorder, duplicate and delete. It appears in the
  Fades tab, on the selected panel and above the fade inspector.

## Validation

| Check                                         | Result                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`                                    | 1,211 passed, 0 failed (Composition 86; 10 new fade geometry tests).                                                                                                                                                                                                           |
| typecheck, lint, build, `check:build`         | Passed, 0 lint warnings.                                                                                                                                                                                                                                                       |
| `scripts/fade-editor-browser-check.mjs` (dev) | All 14 required scenarios passed — [results](fade-editor/browser-results.json).                                                                                                                                                                                                |
| Export parity                                 | Full render vs 6 export segments with softness, extension and freehand: 1,947/1,947 rows, 0 values differing by more than 2 ([evidence](fade-editor/export-parity.json)).                                                                                                      |
| Built output (UI only)                        | Create, drag above the image into spacing, depth handle, density/softness independence, undo/redo, rename + reload persistence, 412 px touch drag.                                                                                                                             |
| Existing suites                               | `composition-browser-check`, `composition-advanced-browser-check`, `composition-deep-check`, `lettering-browser-check`, dev/built smoke: passed. Two old assertions were updated for intended changes (the depth label and freehand drawing now placing the fade where drawn). |

Browser-harness note: after a raw CDP touch stream, Playwright's next synthetic `tap` is
dropped in headless Chromium even on plain artwork without any fade (verified with a
control run); a real CDP touch tap works. The Android step retries that one tap.

## Limits

- Fades extend vertically into spacing; horizontally they stay within the chapter width.
- Freehand profiles keep the existing 1/1024 sampling for saved-fade compatibility, so a
  very sharp new peak can render a pixel or two inside its control point.
- Boundaries remain single-valued height profiles (no overhangs or closed shapes).
- Touch double-tap to add/remove points depends on the browser emitting `dblclick`; the
  inspector offers Convert to editable points / Remove point as alternatives.
- Chromium desktop and touch emulation only; Safari and physical devices not verified.

Screenshots: [extended into spacing](fade-editor/screenshots/extended-into-spacing.png),
[freehand editing](fade-editor/screenshots/freehand-editing.png),
[overlapping fades](fade-editor/screenshots/overlapping-fades.png),
[Android 412 px](fade-editor/screenshots/android-412.png).
