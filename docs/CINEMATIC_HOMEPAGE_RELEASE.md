# Cinematic homepage — Release 1

## Verified integration baseline

Main `578e6839390c9350be260b72a1d7de15856850b3` includes the completed storage
backup, Raster completion and workspace extraction merges (#7/#9/#10).
Homepage branch: `codex/cinematic-homepage`. F1 branch/PR#6 remains untouched and
Draft, with its separate native-v6/AI work excluded from this release. No editor,
Chapter, asset storage, native schema, project backup or inference code is changed.

## Implementation

- Removed the exclusive robot module and its lazy-loader, renderer, RAF loop,
  visibility/intersection/pointer listeners, disposal code and sculpture CSS.
  Shared DepthSurface, Three.js dependency and editor utilities remain intact.
- Nine original comic illustrations across all requested genres, with verified
  responsive local WebP variants, recorded source hashes and font licensing.
  Four controlled speech-bubble scenes (English/Korean/Japanese), three silent
  cinematic scenes, two sound-effect action scenes. See public/gallery/README.md.
- CSS-perspective gallery: three settled visible cards, smooth foreground/rear
  transitions, a new scene joining each step, full nine-scene wrap every27s.
  Automatic cadence3s. Next/Previous, keyboard arrows, hover/focus pause, explicit
  Pause/Resume and native touch swipe. Vertical scrolling and browser pinch zoom
  remain available. Cancelled gestures do not change artwork.
- Decoded-image checks gate automatic advancement to avoid an unloaded scene.
  Responsive image sizes limit decoded image memory on phones; no per-frame
  React updates, WebGL texture allocation or animation frame loop.
- Aurora uses two bounded CSS gradient ribbons with transform/opacity movement,
  one on phones; lower-memory/core-count/save-data devices receive a static wash.
  Shared preferences, OS reduced motion, hidden tab, offscreen and dialog pauses
  preserve readability and avoid unnecessary background animation.
- Existing headline, calls to action, stats, project library, backups, navigation,
  branding and chapter/editor entry points remain unchanged.

## Validation and release gate

Validation results, exact commit/PR and production verification are recorded below
once the gates complete. A build alone is not deployment evidence. Release2
(Dialogue Studio) must not begin until this release is completed and the production
source SHA and live behavior are confirmed.

## Limitations

CSS perspective supplies real browser-composited depth; this is not a WebGL scene.
Only three cards are visible at rest; transition cross-fades briefly overlap an
outgoing/incoming rear card. The phone carousel follows the headline vertically;
users scroll to view its complete artwork and controls. All project images and
editable documents remain at their original resolution. Gallery artwork is
purpose-made marketing content and is not inserted into projects. Browser touch
emulation is not physical Android validation. No universal mobile FPS claim.

## Completed local validation

- `npm test`: **700 pass,0 fail** (200 script,59 shared,47 studio,394 Pro).
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:build`,
  `npm run check:auth`: pass. No lint warnings on this integration baseline.
- All19 existing `npm run test:<suite>:browser -- http://127.0.0.1:8081`
  commands pass: studio,editor,adjustments,retouch,workflow,ui,pro,layers,repair,
  geometry,transform,color,appearance,raster-refinement,vector,compound,pathfinder,
  artboards,vector-final. Genuine local Swin2SR inference is included, not mocked.
- `npm run test:homepage:browser -- <dev-or-built-URL>` passes a complete real
  3s/nine-scene cycle, artwork SHA-256 checks, mouse/keyboard/Pause/Resume,
  hidden-tab and offscreen timer cleanup, reduced/quiet motion, dialog pause,
  project creation, route unmount and320/360/390/768/1440px portrait/landscape.
  Native Chromium touch swipes/vertical scrolling,44px controls and cancellation
  are exercised on phone viewports. No uncaught errors or failed gallery assets.
- `node scripts/browser-smoke.mjs <URL> <screenshot> --ready-selector
'.cinematic-gallery img'`: dev and built pass, both visually inspected;
  no horizontal overflow, branding/auth warnings or baseline divergence.
- Final UI checks cover explicit Resume while keeping keyboard focus. Existing
  pixel/document/editor suites cover unchanged editor code; only gallery motion
  state changed in the final fix. GitHub Actions re-run full automated validation
  for each pushed HEAD. No tests or pixel assertions were weakened.

The11 existing fixture helpers now wait for Chapter Workspace after creating a
project, preventing uploads from targeting the homepage's newly merged backup
input during route transitions. Initial failures and the corrected conditions
are recorded in `homepage/validation.json`. Production release checks now verify
the CSS-perspective gallery and robot absence instead of expecting a robot RAF.
They preserve all editor, native, export, Chapter and real-inference checks.

[Desktop evidence](homepage/desktop.png) · [Mobile evidence](homepage/mobile.png).
Chromium156.0.8078.4, shared Linux CPU/headless browser; no physical Android or
universal device-performance guarantee. The existing frame diagnostic sampled
16.7ms median /66.7ms p95 under concurrent QA workload; these are diagnostic
wall times, not production FPS promises. No per-model/device peak memory claim.

PR: https://github.com/barbonselvar/inkstrip-manhwa-studio/pull/11.
Main remains unchanged pending final exact-HEAD CI and release checks. Production
was verified as baseline578e683 before release. No F1 merge or deployment action,
production environment change, paid API or Dialogue Studio work was performed.
