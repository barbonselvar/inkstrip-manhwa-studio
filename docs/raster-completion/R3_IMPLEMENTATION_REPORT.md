# R3 implementation report — Professional Brush & Painting Engine

Branch `codex/r3-professional-brush-engine` · Base `main` @ `7538ee3` · Draft PR #14.
Audit: [`R3_GAP_ANALYSIS.md`](R3_GAP_ANALYSIS.md) · Tests: [`R3_TEST_REPORT.md`](R3_TEST_REPORT.md).

## A. Summary

The audit found that Inkstrip already had most of a professional brush engine. Opacity and flow
use the correct model (flow per dab, opacity as a per-stroke cap). Hardness is a real radial
falloff, spacing is arc-length based, and dynamics are deterministic. The eraser removes real
alpha, and painting after R2 view rotation was already exact. These were measured in Chromium and
left unchanged. R3 fixes the real defects, adds the missing capabilities that fit the existing
document model, and reorganises the brush UI.

**No native format change.** No new stored stroke field and no envelope bump. Documents painted
with R3 open identically in earlier releases.

## B. Defects found and fixed

| #   | Sev. | Defect (audited behaviour)                                                                                                                                                                                                                                                                                   | Fix                                                                                                                                                                                                    |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | P1   | Smoothed/stabilized strokes ended short of where the pen lifted: 11 px at smoothing 0.3, 25 px at 0.5, 57 px at 0.95 on a fast 300 px stroke, plus the stabilizer string length. Shipped "Ink Pen" and "Line Art Brush" presets were affected. Real UI on `main`: lifted at x=110, stroke ended at x=104.05. | On release, the unfiltered final position is appended (catch-up). Cancel still discards. Same for spot-healing strokes.                                                                                |
| 2   | P1   | Every coalesced sample was stored. Stroke validation caps points at 10,000, so a long stroke from a 1 kHz mouse or 240 Hz pen failed to commit and was lost.                                                                                                                                                 | Every sample is still filtered, but a point is stored only after a size-relative step (max(0.25 px, 2% of size)) or a pressure change ≥ 0.02. At the cap the stroke ends there, with a status message. |
| 3   | P2   | The brush cursor was a document-space circle of `size/2`, while strokes are layer- or mask-local. Wrong size and shape on scaled/rotated layers and masks; square tips, roundness and angle not shown.                                                                                                       | `brushCursor()` draws the footprint in the target frame (layer matrix, or mask matrix while editing a mask) with the real tip shape, roundness, angle and a hardness ring.                             |
| 4   | P3   | "Pen pressure opacity" and "Opacity jitter" actually modulate per-dab flow.                                                                                                                                                                                                                                  | Relabelled "Pen pressure controls flow" and "Flow jitter". Stored fields unchanged.                                                                                                                    |
| 5   | P3   | Preset rename/duplicate/delete used `window.prompt` and required typing exact names; no reset; the select never showed the active preset.                                                                                                                                                                    | Inline preset manager (below).                                                                                                                                                                         |

## C. New capabilities

- **Pen pressure curve** (`pressureResponse`, p^γ, γ 0.25–4). It is applied once, as pen samples
  are recorded, so the stored per-point `pressure` keeps its meaning and renders the same
  everywhere. It is a per-device preference (`localStorage` key `inkstrip-pro-pen-pressure-v1`),
  not document data. Mouse and touch never record pressure.
- **Presets.** Added G-Pen (strong pressure taper, smoothing 0.35, stabilization 4), Mapping Pen
  (fine, even width, pressure off) and Soft Eraser (hardness 0.15, flow 0.35). Together with the
  existing presets this covers the requested set: Hard Round = "Hard Round Brush", Soft Round =
  "Soft Brush", Basic Eraser = "Eraser", plus Pencil, Ink Pen and Airbrush. Existing names were
  kept so saved overrides still match. A unit test asserts that no two factory presets have
  identical settings.
- **Preset manager.** The select shows the active preset, grouped into Inkstrip and Your presets.
  Save current, update, duplicate (unique "copy" names), rename, delete with confirmation
  (deleting an override restores the factory recipe) and reset to defaults with confirmation.
  Storage is the existing validated, versioned key.
- **Brush panel.** Preset first, then size, hardness, opacity, flow and spacing, each with a touch
  slider plus the exact number field (existing labels kept). Then colour, smoothing and
  stabilization; a "Pen pressure" section (size, flow, curve); and a collapsed "Brush dynamics"
  section. Help text states the opacity/flow model and that pressure comes only from a pen.

## D. Algorithms

- **Dab model (unchanged).** Arc-length spacing carried across samples; per-dab radial gradient
  from `hardness·r` to `r`; `globalAlpha = flow` per dab; when opacity < 1 the stroke is drawn into
  an ink buffer and composited once at `opacity` (cap). The eraser uses `destination-out`.
- **Recording.** Per sample: EMA smoothing (time-constant 80·smoothing ms), then lazy-string
  stabilization, then pressure curve, then conditional store. The stored polyline stays within one
  recording step of every filtered sample (unit-tested on a 60,000-sample stroke).
- **Catch-up.** The release point is appended with the last real pen pressure (pointer-up reports
  0), and its time is clamped to be monotonic.

## E. Files

| File                                                                                      | Change                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/studio/pro/brush-dynamics.ts`                                                    | `pressureResponse`, `appendBrushSample`, `finishBrushStroke`, `MAX_STROKE_POINTS`; `brushPoint` accepts a pressure curve |
| `src/lib/studio/pro/brush-cursor.ts` (new)                                                | Target-frame cursor geometry                                                                                             |
| `src/lib/studio/pro/brush-presets.ts`                                                     | Inking presets, duplicate/delete/reset helpers, pressure-curve preference                                                |
| `src/components/studio/pro/pro-canvas.tsx`                                                | Bounded recording, release catch-up, pressure curve, new cursor                                                          |
| `src/components/studio/pro/pro-brush-settings.tsx` (new)                                  | Brush panel and preset manager                                                                                           |
| `src/components/studio/pro/pro-properties.tsx`, `pro-workspace.tsx`, `src/pro-studio.css` | Panel integration, preference state, styles                                                                              |
| `scripts/raster-refinement-browser-check.mjs`                                             | Saves its preset through the inline field (assertions unchanged)                                                         |

## F. Status by acceptance criterion

**Implemented and verified (automated, Chromium):** 1 existing painting preserved · 2 settings
affect pixels · 3 opacity ≠ flow · 4 hardness edges · 5 fast strokes continuous · 6 stabilization
without history corruption · 8 mouse/touch usable · 9 pencil and eraser · 10 correct layer/mask
target · 11 rotation accuracy · 12 transaction-safe undo/redo (R2 guards retained) · 13 native
reopen · 14 export matches committed artwork · 15 mobile controls · 16 bounded points/budgets ·
18 limitations documented. Criterion 17 (CI) is recorded on the PR for the final commit.

**Implemented but not physically device-tested:** 7 pressure, verified only with synthetic
Chromium CDP pen events. No physical stylus, iPad/Apple Pencil or Android device was used.

**Unsupported or deferred (each needs a new stored field and therefore an envelope decision that
depends on PR #6):**

- tilt/orientation dynamics;
- pressure → per-stroke opacity ceiling;
- separate angle/spacing/flow jitter channels;
- image/texture tips;
- render-time curve interpolation (which would also change how existing strokes render).

Proposed path: once PR #6 settles envelope v6, define v8 stroke fields (`tilt` per point,
`opacityPressure` ceiling mode) with older readers refusing the file rather than dropping data.
