# Phase E preparation — Raster refinement before AI Studio

Baseline: verified Phase D Production release from PR #3, normal merge
`a35e73ef90e71f79f711ce7830e8e8625e372aaa`, tested Phase D development HEAD
`5526fdca4e4c6fb51afdce6c1af2b600a1f3c6e8`. Production:
https://inkstrip-manhwa-studio.vercel.app/ — live build marker matches merged
main. Verified 2026-10-22 UTC at desktop, 320px and 390px: Chapter/Raster/Vector,
Pathfinder/artboards/gradients/path text, native/SVG exports/reopen, actual WebGL
activity, original recovery and real Swin2SR inference (16×24 → 32×48). No
JavaScript errors or failed critical assets. Both main Actions workflows pass.

This branch contains preparation only. Phase E is not implemented or released;
no new Raster or AI tools are advertised by this document.

Phase D's Pen/anchor/compound/Pathfinder/artboard/precision/appearance/text/SVG
systems are retained. Reuse the shared compositor, history, immutable source pool
and native v4 reader/writer. Read the current feature inventory and source before
implementing anything; existing repair tools, color adjustments, gradient layers,
layer effects, selections and transforms must not be recreated.

## Proposed independently releasable Raster work

1. Selection refinement: genuine expand/contract/smooth morphology, deterministic
   edge/feather controls, mask-aware preview and bounded source-resolution kernels.
   Begin by auditing the existing selection coverage representation and worker
   budgets. Add geometry/pixel reference tests, cancellation and transparent-edge
   cases before exposing controls.
2. Brush dynamics: missing spacing/scatter/angle controls, deterministic dabs and
   hardware-supported tilt/pressure behavior. Retain current pressure/smoothing,
   repair/source sampling and selection clipping. Recorded strokes must reproduce
   after undo/native reopen/export.
3. Mask/source frame fidelity: audit transformed vector/text paint and mask bounds,
   off-frame effects/coverage, local/native export parity and large-source memory.
   Fix demonstrated defects with source-preserving migrations, never implicit
   rasterization or silent clipping/downsampling.
4. Curves/channels/color workflow: inventory the existing curves/color controls,
   implement only missing professional capabilities, and state browser/ICC limits.
5. High-resolution scheduling: benchmark representative long Chapter/strip and
   native documents; preserve explicit device budgets, worker cancellation and
   originals. Report measured performance rather than arbitrary speed promises.

Keep each milestone coherent, editable and tested. The exact scope should be
confirmed against the current inventory before calling the entire phase complete.

## Release gates

Retain the Phase D baseline of 642 automated tests and 18 Chromium suites, then
add meaningful algorithm/history/native/export coverage for each new feature.
Run types, lint, production build/config/auth validation, desktop and 320/390px
touch regressions, Chapter/Raster/Vector, real AI and homepage WebGL checks.

Push to the new phase branch and use a draft PR during implementation. Only a
fully completed phase with exact-HEAD green checks, resolved blocking reviews and
normal-merge eligibility may release. Preserve main history, the existing Vercel
project/domain and all data. Verify the production release meta SHA and actual
live workflows before beginning another phase.

Future AI Studio is separate: face/hands/anatomy repair, restoration/inpainting,
character identity and reference consistency are future work, not implemented
capabilities of this preparation.
