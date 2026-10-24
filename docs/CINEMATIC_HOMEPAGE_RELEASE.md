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
