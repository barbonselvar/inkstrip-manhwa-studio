# R3 gap analysis — Professional Brush & Painting Engine

Date: 2026-10-24 · Base: `main` @ `7538ee3` (PR #13 merge) · Branch:
`codex/r3-professional-brush-engine`.

Method: source reading plus measurements. Pixel figures below come from the real `stroke()`
renderer drawing into a Chromium `OffscreenCanvas` (dev server, Chromium headless shell 1243).
Smoothing figures come from the real `brushPoint()` filter in Node. Nothing here is inferred
from control labels alone.

## 1. Architecture that R3 must respect

- **Strokes are editable records, not baked pixels.** A paint layer stores `Stroke` objects
  (`src/lib/studio/pro/model.ts:71`) that are re-rasterized for preview, thumbnails and export
  (`render.ts:182 stroke`, `render.ts:461 clippedStroke`). Brush settings are stored per stroke.
- **Two dab paths.** Strokes with `dynamics` use the deterministic arc-length dab generator
  (`brush-dynamics.ts:95 brushDabs`). Strokes without it, including the default brush, use the
  legacy fixed-spacing path (`render.ts:241`). Existing documents must keep rendering identically,
  so neither path may change its output for existing stroke data.
- **Native format.** Readers accept unknown fields silently (`files.ts:46`). New per-stroke fields
  would therefore be dropped by older releases without warning unless the envelope is bumped.
  Envelope 6 is reserved by the unmerged AI PR #6 and 7 is Dialogue, so a new field would need
  envelope 8. **R3 strategy: no new stored fields.** New behaviour is expressed through existing
  fields, for example a pressure curve applied when input is recorded, so the stored per-point
  `pressure` already carries it.
- **Input pipeline.** `pointerdown` → `brushPoint()` (pressure gating, smoothing EMA, lazy-string
  stabilization) → per coalesced sample in `move` (`pro-canvas.tsx:1517`) → `end` commits via
  `commitCanvas` with the R2 origin guard (`pro-canvas.tsx:1538`). View rotation is handled once
  in `canvasPoint` (R2); all brush coordinates are layer-local or mask-local.

## 2. Measured rendering behaviour (Chromium)

| Check                                                                | Result                                            | Verdict                                           |
| -------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Hardness 1 / 0.5 / 0, alpha at 0/4/7/9 px from a 10 px radius centre | 255,255,255,250 / 255,255,239,37 / 255,250,177,19 | Real per-dab radial falloff                       |
| Opacity 0.5, line and back-and-forth overlap within one stroke       | 128 and 128                                       | Opacity is a per-stroke cap (separate ink buffer) |
| Flow 0.5, single dab vs dense stroke                                 | 128 vs 255                                        | Flow is per-dab deposition, distinct from opacity |
| Flow 0.5 with dynamics spacing 1.0                                   | 128                                               | Spacing changes deposition predictably            |
| Eraser 50% on 60% red                                                | alpha 153 → 76, RGB unchanged                     | Removes real alpha (`destination-out`)            |
| Square tip at opacity 0.5, corner pixels                             | 128 / 128                                         | Not clipped by the opacity buffer                 |

## 3. Feature classification

Legend: **V** already implemented and verified · **D** implemented but defective · **P** partial ·
**M** missing · **U** unsupported by the current architecture without a format change.

| Requested feature                                                                  | Class             | Evidence / reference                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size, colour                                                                       | V                 | `Stroke.size` 1–1000, colour validated (`model.ts:401`)                                                                                                                                                                                                                                                        |
| Hardness                                                                           | V                 | §2; radial gradient per dab (`render.ts:221`)                                                                                                                                                                                                                                                                  |
| Opacity vs flow                                                                    | V                 | §2; documented model in `render.ts:183`                                                                                                                                                                                                                                                                        |
| Spacing                                                                            | V (dynamics path) | `brushDabs` arc-length spacing 0.01–2 × diameter; legacy path fixed at 0.1 × diameter                                                                                                                                                                                                                          |
| Tip shape (round/square), angle, roundness                                         | V                 | `tip`, `dynamics.angle/roundness` (`render.ts:232`)                                                                                                                                                                                                                                                            |
| Smoothing / stabilization                                                          | **D**             | Endpoints lag: fast 300 px stroke at 60 Hz ends 11 px short at smoothing 0.3, 25 px at 0.5, 57 px at 0.95, plus the full string length (e.g. 20 px) with stabilization. `end()` re-filters the release point (`pro-canvas.tsx:1549`). Shipped presets "Ink Pen" (0.3) and "Line Art Brush" (0.5) are affected. |
| Long strokes                                                                       | **D**             | Stroke validation caps points at 10,000 (`model.ts:393`); the canvas appends every coalesced sample without a bound (`pro-canvas.tsx:1468`). A 1 kHz mouse or 240 Hz pen exceeds it in roughly 10–40 s of continuous drawing; the commit then fails and the whole stroke is discarded.                         |
| Fast-stroke continuity                                                             | V                 | Coalesced pointer events (`pro-canvas.tsx:1519`); arc-length dabs carry across samples                                                                                                                                                                                                                         |
| Dots / short strokes                                                               | V                 | First point is unfiltered; a single point yields one dab                                                                                                                                                                                                                                                       |
| Cancellation / Undo mid-stroke                                                     | V                 | R2 origin guard and `r2-gesture` suite                                                                                                                                                                                                                                                                         |
| Pressure → size                                                                    | V                 | `sizePressure`; only `pointerType === "pen"` records pressure (`brush-dynamics.ts:4`)                                                                                                                                                                                                                          |
| Pressure → flow                                                                    | P                 | Implemented as `dynamics.opacityPressure`, which scales per-dab alpha (flow), but the UI labels it "Pen pressure opacity" (`pro-properties.tsx:205`). Label is misleading.                                                                                                                                     |
| Pressure → opacity (per-stroke ceiling)                                            | U                 | The stroke model has one opacity cap per stroke. A per-dab ceiling needs a renderer change that alters stored-stroke meaning, i.e. a format change. Deferred.                                                                                                                                                  |
| Pressure response curve                                                            | M                 | No curve exists. Can be applied when input is recorded (stored pressures already exist), so no format change is needed.                                                                                                                                                                                        |
| Tilt / orientation                                                                 | U                 | No tilt handling. Per-dab tilt needs per-point storage, i.e. a new field and envelope 8. Deferred; also cannot be verified without a tilt-capable pen.                                                                                                                                                         |
| Size jitter, angle via direction, scatter, opacity(flow) jitter, velocity thinning | V                 | `brushDabs` with seeded xorshift (`brush-dynamics.ts:95`)                                                                                                                                                                                                                                                      |
| Angle jitter, spacing jitter, flow jitter as separate controls                     | U                 | Would add `DabDynamics` fields (format). Existing size/opacity jitter and scatter cover the common cases. Deferred.                                                                                                                                                                                            |
| Presets: Hard Round, Soft Round, Pencil, Ink Pen, Airbrush, Basic Eraser           | V                 | `PROFESSIONAL_BRUSH_PRESETS` (as "Hard Round Brush", "Soft Brush", "Pencil", "Ink Pen", "Airbrush", "Eraser")                                                                                                                                                                                                  |
| Presets: G-Pen, Mapping Pen, Soft Eraser                                           | M                 | Not present                                                                                                                                                                                                                                                                                                    |
| Preset save / rename / duplicate / delete                                          | P                 | Work, but through `window.prompt` asking for exact names (`pro-properties.tsx:268–320`); poor on mobile; the select never shows the active preset                                                                                                                                                              |
| Reset presets to defaults                                                          | M                 | Not present                                                                                                                                                                                                                                                                                                    |
| Preset persistence                                                                 | V                 | Versioned, validated localStorage key `inkstrip-pro-brush-presets-v1`                                                                                                                                                                                                                                          |
| Pencil                                                                             | V                 | Square, always-hard tip; pixel corners intact (§2)                                                                                                                                                                                                                                                             |
| Eraser alpha removal, layer/mask targeting, locks                                  | V                 | §2; `isLocked` incl. inherited at pointerdown; mask erase honours inversion (`pro-canvas.tsx:932`)                                                                                                                                                                                                             |
| Painting after canvas rotation                                                     | V                 | R2 `canvasPoint`; `r2-document` suite draws at 90°                                                                                                                                                                                                                                                             |
| Brush cursor                                                                       | **D**             | Always a circle of radius `size/2` in document units (`pro-canvas.tsx:2046`), but strokes are layer-local or mask-local. On a scaled/rotated layer or mask the outline is the wrong size and shape; square tip, roundness and angle are not shown.                                                             |
| Native save / reopen / export of strokes                                           | V                 | Strokes are document data; existing native/export suites                                                                                                                                                                                                                                                       |
| Large documents / budgets                                                          | V                 | 200k-dab and 10k-point validation budgets; dirty-rect preview presentation (`preview-dirty.ts`)                                                                                                                                                                                                                |

## 4. Implementation plan (format-neutral)

1. **Endpoint catch-up.** On release, append the raw (unsmoothed) final point so smoothed and
   stabilized strokes finish where the pen lifted. Cancel keeps the existing discard path.
2. **Bounded point recording.** Keep filtering every sample, but store a point only when it moved
   a size-relative minimum distance or pressure changed noticeably. At the 10,000-point limit,
   finish the stroke instead of losing it, and say so in the status line.
3. **Transform-aware brush cursor.** Draw the outline in the target's local frame (layer or mask
   matrix) with the real tip shape, roundness and angle, plus a hardness ring.
4. **Pressure curve.** Per-device preference (not document data), applied to pen pressure as it is
   recorded. Mouse and touch remain unaffected.
5. **Honest labels.** "Pen pressure controls flow" for `opacityPressure`.
6. **Presets.** Add G-Pen, Mapping Pen and Soft Eraser using existing fields; replace prompts
   with an inline preset manager (select shows the active preset; save, rename, duplicate,
   delete, reset to defaults).

Deferred with reasons: tilt, pressure → opacity ceiling, separate angle/spacing/flow jitter (all
need new stored fields and an envelope decision that depends on PR #6), image/texture tips, and
Catmull-Rom render interpolation (would change how existing strokes render).
