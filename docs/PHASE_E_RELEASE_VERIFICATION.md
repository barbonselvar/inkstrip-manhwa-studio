# Phase E production release verification

Verified 2026-10-23 UTC. PR [#4](https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/4)
was marked ready and merged normally after all gates passed.

- Tested development branch: `codex/phase-e-raster-refinement`.
- Tested development SHA: `17ba1134ec011cc50b4455b60ae410b41e2742aa`.
- Main/production merge SHA: `ced5907f5e0bfc49e72588fe76d3cbf652d39b7f`.
- Merge parents: `a35e73ef90e71f79f711ce7830e8e8625e372aaa` and tested development
  SHA. The merged tree matches the tested tree; no force-push or history rewrite.
- 677 automated tests pass. TypeScript, production build, build configuration and
  auth invariant pass. Lint: zero errors and one existing `button.tsx`
  fast-refresh warning. All 19 Chromium suites pass at the exact tested revision,
  including real Swin2SR, Chapter/source recovery and desktop/320/390px touch.
- Both development and main GitHub Actions workflows completed successfully.
- Existing Vercel integration reported "Deployment has completed" / success for
  [the release deployment](https://vercel.com/ss-ac00/inkstrip-manhwa-studio/4LEfthtW1HNoqUGL5w6bzyhBdhtG).
  No project, secret or environment-variable changes; no preview promotion.
- [Production](https://inkstrip-manhwa-studio.vercel.app/) returned HTTP 200 and
  `meta[name=inkstrip-release]` matched the merged main SHA.

The real live release verifier ran with `--raster --ai` against that production
URL and exact SHA in Chromium 156.0.8078.4. It passed desktop 1440px and mobile
320px/390px: actual WebGL activity, homepage/Chapter/Raster/Vector, Pathfinder,
artboards, gradients, editable text-on-path, SVG, native v4/v5 reopen, brush edits,
selection refinement/named selections, mask properties/cancellation, undo/redo,
PNG/JPEG/WebP and original Chapter image preservation. No JavaScript errors and
no failed critical assets.

A native 4096×4096 source/masked PNG export decoded at 4096×4096. The opaque sample
was `[36,71,59,255]`; the masked sample's alpha was 51 as expected for 80% mask
density outside selection. Standard 8-bit Canvas unpremultiplication can round
straight RGB channels; no ICC/16-bit lossless-editing claim is made.

Actual production Swin2SR inference converted 16×24 to 32×48 and reached the
before/after comparison. No paid cloud provider was invoked. Physical Android
hardware was not tested; mobile results are Chromium touch emulation.

[Feature/algorithm/compatibility audit](PHASE_E_RASTER_REFINEMENT.md) and
[measured performance results](benchmarks/phase-e-raster.json) document limits.
Phase F architecture preparation starts from this verified main release and
introduces no new inference implementation or paid service.
