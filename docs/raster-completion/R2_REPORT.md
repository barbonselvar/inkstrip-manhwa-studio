# Raster Studio completion — R2 report: compositor and blend modes

Date: 2026-10-23 · Branch: `claude/raster-studio-completion` · Base: `main` @ `71a29e2` · Draft PR #9.

## A. Objective and result

R2 targets the document and compositor foundation. This release delivers the three items the R1
audit ranked first for R2:

1. **R1-01 fixed — feather on Safari/iOS.** Feathered selections, selection-derived layer masks,
   stroke clips, patches and colour-range stencils no longer lose their feather where
   `OffscreenCanvasRenderingContext2D.filter` is unsupported.
2. **Ten new layer blend modes:** Color Burn, Color Dodge, Soft Light, Hard Light, Difference,
   Exclusion, Hue, Saturation, Color and Luminosity, in addition to the existing Normal, Multiply,
   Screen, Overlay, Darken and Lighten. They are grouped in the Layer blend menu (Normal / Darken /
   Lighten / Contrast / Inversion / Component).
3. **48-layer cap reviewed, kept.** See §G.

Remaining R2-scope gaps, proposed for later: compositing round-trip fixtures in a real browser
(needs the browser suites), and blend modes for vector Appearance items and SVG import/export
(still the original six; their validators reject other values explicitly).

## C. Changes and algorithms

| File | Change |
| --- | --- |
| `src/lib/studio/pro/blend.ts` (new) | Single source of truth: mode list, labels, menu groups, `isBlendMode`, and the W3C Compositing and Blending Level 1 formulas: separable `B(cb, cs)` for 12 modes, `SetLum`/`SetSat`/`ClipColor` for the 4 component modes. `blendPixel` is allocation-free for separable modes because clipping stacks run per pixel. |
| `src/lib/studio/pro/clipping.ts` | `blendClippedPixels` now uses `blendPixel`; maths for the original six is unchanged. |
| `src/lib/studio/pro/effects.ts` | `overPixels` uses `blendPixel`; effect validation uses `isBlendMode`. |
| `src/lib/studio/pro/model.ts` | `Layer.blend` is `BlendMode`; validation uses `isBlendMode`. |
| `src/lib/studio/pro/render.ts` | `selectionCanvas` keeps the GPU `blur()` path where `filter` works and otherwise feathers coverage with `featherAlpha`. |
| `src/lib/studio/pro/feather.ts` (new) | Deterministic feather: exact separable Gaussian for σ ≤ 4, three box passes with matched variance above; edge-extended so selections touching the canvas edge stay fully selected; feature detection by context property, not user agent. |
| `src/lib/studio/pro/vector-appearance.ts` | Keeps Appearance items at the original six modes (type-only adjustment). |
| `src/components/studio/pro/pro-properties.tsx` | Grouped, labelled blend menu. |
| `scripts/layers-browser-check.mjs` | The existing clipping-vs-native-Canvas parity check now iterates all 16 modes. |

Canvas layers are composited by the browser through `globalCompositeOperation`, which uses the
same W3C names and formulas, so no renderer change was needed for unclipped layers.

**Compatibility.** No native envelope or storage schema change. A document using a new mode
validates in this version. Versions before R2 reject it through `validateDocument` with an error
instead of loading it incorrectly. The Pro session stays in IndexedDB untouched, so nothing is lost.
Envelope v6 is left to PR #6. Documents using only the original six modes are byte-for-byte
unaffected. On Chrome, Edge and Firefox, feather output is unchanged because the original path still runs.

**Licensing.** Original implementation from the public W3C specification; no new dependencies.

## D. Commands and tests

Environment as in R1 (2 vCPU Xeon, Node 22.22.0).

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npx eslint .` | 0 errors, 1 pre-existing warning (`button.tsx`, fixed in #7) |
| `npm test` | **688 passed, 0 failed** (677 baseline + 11 new) |
| `vite build` | pass |
| New `blend.test.ts` (5) | Original six modes byte-identical to the pre-R2 formulas for clipping and effects over 500 random pixels each; W3C reference values; component-mode luminance/saturation invariants; range checks; document validation accepts all 16 and rejects unknown values |
| New `feather.test.ts` (6) | Feature detection; box variance within 12 % of σ²; σ = 0 identity; full-canvas selection stays 255; step-edge deviation from a true Gaussian ≤ 4 levels for σ ∈ {0.5, 1, 2, 4, 6, 15, 40}; coverage preserved within 1 % |
| `test:layers:browser` (now 16 modes) | **NOT RUN** — Chromium download blocked in this environment; script imports verified up to browser launch |
| Real Safari / iPad / iPhone | **NOT RUN** — no hardware. The fix path is selected by feature detection and is unit-tested, but has not been observed in Safari. |

## E. Round trips and regressions

- Original six modes: identical pixels, by test.
- Chrome/Firefox feather: code path unchanged.
- Native files and Pro sessions: no schema change; new modes round-trip because they are plain
  string values validated by `isBlendMode`.

## F. Performance

Fallback feather on this CPU (Node): step-edge maximum deviation from an exact Gaussian is
0.37 / 0.33 / 1.71 / 2.33 / 2.66 levels at σ = 1 / 2 / 6 / 15 / 40. A 4096 × 4096 mask at σ = 20
takes about 1.9 s. This cost applies **only** on browsers without Canvas `filter` (Safari), where
the previous result was an unfeathered mask. Caching feathered coverage between renders is an R8
candidate. Separable clipping blends stay allocation-free.

## G. Findings

| ID | Severity | Status |
| --- | --- | --- |
| R1-01 Safari feather | High | **Fixed** (pending real-Safari confirmation) |
| R1-04 48-layer cap | Medium | **Kept.** Memory is bounded by the 48 MB asset pool, the 2 × `maxArea` bitmap LRU and the 32 MB history budget, not by layer count. Per-render cost grows with layers, and raising the cap safely needs browser memory profiling that cannot run here. Proposed for R8 with measurements. |
| R2-01 | Low | `src/lib/studio/retouch/selection.ts` (older chapter image editor, HTML canvas) also feathers with `ctx.filter`. Outside Raster Studio; not changed. |
| R2-02 | Low | Vector Appearance and SVG import/export remain limited to six blend modes. |

## H. Proposed next phase (not started)

**R3 — Painting:** paint bucket (tolerance, contiguous, sample merged), smudge, blur/sharpen and
dodge/burn brushes, tilt where Pointer Events report it, image brush tips.

Phase complete. Awaiting explicit user approval before proceeding to the next phase, merging into main, or deploying to production.
