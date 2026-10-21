# Phase D — vector engine (unreleased)

Phase D starts from verified Phase C production merge
`e025d3995999c05921a057b601f88f44dea52460`, after live Chapter/Raster/Vector,
appearance/mobile, AI and 3D verification. Its branch is
`codex/phase-d-vector-engine`. It must remain a draft until the whole phase is
implemented and release gates pass. Phase C remains the production release.

## Implemented foundation

`bezier.ts` extends the existing native cubic-anchor representation:

- Exact De Casteljau subdivision, point evaluation and analytic derivatives.
- Adaptive arc length with a global absolute error bound from control-polygon
  and chord bounds. Work/depth limits fail explicitly instead of silently
  returning unjustified precision.
- Bounded arc-distance inversion, including collinear cubics with nonuniform
  parameter speed, backtracking cusps and zero-length segments.
- An immutable native segment-subdivision document transaction, including the
  closing segment of closed paths. Both adjacent handles are updated without
  flattening. Source bytes, layer transforms, styles, masks and relationships
  are retained. Layer/ancestor locks, imported raw SVG paths, endpoints and the
  1000-anchor limit are guarded.

The foundation is an internal API, **not a newly advertised editor tool**. Existing
Pen/direct-anchor controls remain intact. UI segment insertion/metrics integration
is still missing. This is the first step toward precise anchor insertion,
snapping and text-on-path; it is not a claim that those tools are complete.

Tests independently verify analytic endpoints/derivatives, dense whole-curve
subdivision equivalence, quarter-circle length reference and declared error,
cusp traveled length, inverse distance, native open/closed geometry,
locks/limits, undo/redo and native/source roundtrips.

## Remaining Phase D scope

- Wire precise subdivision/metrics into Pen/direct-anchor editing and browser
  regressions; add professional anchor types and editing operations.
- Robust Pathfinder Boolean operations and compound-path fill rules.
- Multiple artboards and artboard-aware native output.
- Precision object/anchor snapping and alignment.
- Expanded stroke/fill/appearance behavior, preserving editable objects.
- Text-on-path layout using arc metrics and typography persistence/export.
- SVG import/export for new vector geometry and appropriate Phase C gradients,
  adjustment/effect handling, with explicit unsupported-feature errors.
- Full native/history/export/mobile/AI/3D regression and release gates before
  merging; live production verification before the following phase.

Existing functionality must be extended in place. No new fake buttons or inactive
controls are introduced by the foundation commit.

Foundation validation: **497 automated tests passed**, including 198 Pro tests and
13 new Bézier tests. TypeScript, lint (one existing shared Button warning),
production build and build configuration checks passed. The 10 checked runtime
assets remain byte-identical to the verified Phase C build because this internal
module is not yet wired into editor controls. Phase D browser/complete release
gates remain pending with its broader implementation; this is not a Phase D release.
