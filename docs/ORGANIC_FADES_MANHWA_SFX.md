# Organic fades and Manhwa SFX — implementation report

Feature branch: `codex/organic-fades-manhwa-sfx`, based on the verified PR #33 merge
`67926a6597dc8ad812373b8ae7ae1235701b0a40`. This change is not merged or deployed to production.

## Architecture and compatibility

This extends the existing Composition & FX controller, chapter coordinates,
mask renderer, history, layers, IndexedDB and segmented exporter. No second editor,
paid API or new package dependency is introduced. Optional `Fade.boundary` and
`Sfx.ink` fields preserve loading of old projects and legacy straight-fade rendering.
Existing source images and native drafts are untouched. Old application versions
cannot reproduce the new shape/ink fields; use this version for editing/export.

Boundary fields contain bounded geometry, placement, amplitude, frequency, direction
and normalized control points. Coverage is computed from each boundary at logical
image coordinates, not from a rectangular blurred overlay. Bezier curves are sampled
into a cached height profile; freehand vertices form an editable height profile.
The same coverage function renders gallery thumbnails, editing, reading and exports.
The cyan line denotes 50% coverage. Both placement reflects the boundary at the two
edges. Feather, blur, opacity, target color and fade width reuse the existing engine.

Original vector lettering decomposes Hangul syllables into geometric jamo strokes,
then constructs angular, tapered, irregular polygons. English A–Z and basic
punctuation use original geometric strokes. Text, style, color, outlines, shadow,
texture, opacity and affine transforms remain editable. These are original
procedural designs, not traced glyphs or copied manhwa artwork. Unsupported vector
characters use the existing shaped font renderer with an explicit inspector notice.

Imported artwork uses existing independent overlay layers. SVG passes a strict
geometry/attribute allowlist, strips executable/external content, rejects entities,
and is decoded into a PNG of at most 2048px. No untrusted SVG is inserted into the
application DOM or saved as executable chapter content. PNG/WebP transparency is
preserved; optional corner-connected matte removal operates on a derived image.
Reusable asset presets store blob references and categories on the project. Blob
retention and project packages include presets even when no chapter layer uses them.

## Usage

Run the existing `npm ci` / `npm run dev` workflow. In a chapter choose
**Composition & FX**:

- **Fade Shapes** offers nine actual mask previews: Straight, Wave, Curved, Zigzag,
  Irregular / Organic, Diagonal, Elliptical, Custom Bezier Path and Freehand Boundary.
  Select a card to insert, then change placement and intensity in Properties.
- Bezier control points and boundary amplitude have canvas handles. Freehand uses
  **Draw boundary on canvas**; draw across the image and release to retain the mask.
  The gesture is one undo entry. Touch handles have a 44px target; a drawing overlay
  captures its gesture without scrolling the browser. The old straight fade drag
  bar is replaced for shaped masks so it cannot intercept drawing.
- **Advanced fade settings** retains exact legacy controls, gradient stops and
  saved fade presets. Straight boundaries omit irrelevant amplitude/direction controls.
- **Manhwa SFX** offers twelve action categories with Hangul/English pairs and eleven
  vector styles. Click a category/style thumbnail to insert immediately, or drag a
  card onto the chapter. Negative panel-local Y places lettering into top spacing.
  Clipping stays off unless enabled. Existing layer and transform tools still apply.
- **My SFX Assets → Import SFX artwork** accepts PNG, WebP and SVG. Preview the
  transparency, optionally remove a flat corner-connected matte, enter name/category,
  then **Save asset and insert**. Filter/search the library and reuse the art across
  chapters in the same project; project packages transfer it to another browser.
- Return from Focus mode to see edits in Chapter mode, or open the reader without
  guides. PNG/JPEG/WebP exports use the same render pipeline and segment grid.

## Verified capabilities

All nine boundary families, top/bottom/both placement, Bezier handles, freehand
capture and point editing, original Hangul/English vector lettering, eleven named
styles, cross-panel layers, desktop card drag/drop, PNG/WebP/SVG imports,
corner-connected background removal, categorized reusable assets, history,
autosave, package references and refresh recovery are implemented.

Unit checks verify all 11,172 composed Hangul syllables yield geometric jamo outlines;
this is not a claim of typographic/artistic review of every syllable. The default
samples cover Sword Swing, Sword Impact, Branch Breaking, Footsteps, Wind,
Explosion, Punch Impact, Energy Burst, Speed Movement, Rustling Leaves, Heavy
Collision and Dramatic Silence. Gallery thumbnails render the actual vector/mask
engine rather than stock placeholder images.

## Validation

- `npm test`: **1,175 tests passed** (204 scripts, 63 app, 151 Studio, 707 Pro,
  50 Composition). Nine meaningful new unit tests cover shapes, legacy parity,
  geometry bounds, Hangul/English vectors, source-safe matte removal and asset packages.
- Typecheck, lint, production build and build-contract checks: results captured in
  the evidence folder after the final run. All passed with no lint warnings.
- `npm run test:composition:advanced`: desktop 1440px and Chromium touch 360/390/430px;
  gallery insertion, Bezier pointer drag, freehand mouse/touch, undo/redo, saved fade
  preset, source-crossing Hangul, SVG sanitization, transparent PNG, matte WebP,
  categorized asset reload, reader and PNG/JPEG/WebP decoding all passed.
- Wave, Bezier and freehand exports with crossing vector SFX and imported artwork
  were compared against whole reference renders. Each covered exactly 1217 rows;
  maximum channel deviation was 1 and no values differed by more than 2.
- Existing Composition browser suite passed its Chapter/Focus/spacing/fade/SFX/
  save/refresh/export/40-panel and gesture workflows. Existing integrity suite passed
  all FX/legacy SFX output, Unicode, quota retry, revision conflict, accepted source
  byte preservation, native snapshot and fresh-profile package restore.
- Browser QA found and fixed duplicate gallery rendering and a legacy straight
  fade handle intercepting freehand touch. The new touch tests cover that regression.
  A selector initially assumed tools remained open after selecting a preset; it now
  waits for the intended automatic sheet close. A preview served stale chunks while
  a build was still running; restarting it after completion resolved the loading
  shell, and built desktop/mobile smoke and manual gallery insertion then passed.
  No failed check was ignored.

## Remaining limits

- Boundaries are single-valued height profiles across image width. Bezier paths
  have four draggable control points; self-intersecting curves are resolved into a
  height profile. Freehand is resampled to at most 128 vertices. This is not a
  general arbitrary filled-shape mask painter. Top/bottom/both are supported;
  the existing left/right and radial tools remain available separately.
- Lettering geometry is regenerated from editable text/style. It is not a general
  per-glyph anchor editor or true perspective transformation. Unsupported Unicode
  uses the existing font renderer. The geometric brush style is an ink treatment,
  not a library of hand-painted calligraphy. Imported SVG paths are rasterized,
  rather than becoming editable native vector paths.
- Imports are capped at 2048px for memory; existing raster decode limits apply.
  SVG text, images, filters, external resources and unsupported styling are removed.
  Text-only SVG is rejected with instructions to convert text to paths.
- Matte removal supports flat corner-connected backgrounds, not semantic selection,
  complex backgrounds or generative cleanup. Original images remain unchanged.
- Asset libraries are project-scoped. Import into another project or use the existing
  cross-chapter clipboard/package workflow. No cloud/global asset sync is added.
- Existing export limits (4096px width, bounded surfaces, ZIP/segment limits),
  session history limits and browser font/codec differences still apply.
- Chromium desktop/touch emulation was tested. Physical devices and Safari/WebKit
  remain unverified. No reference screenshot attachment was accessible this turn.

## Files

- `src/lib/studio/composition/boundaries.ts`, `masks.ts`, `model.ts`: shape profiles,
  coverage, optional validated schema and preset media references.
- `ink.ts`, `ink-catalog.ts`, `ink-presets.ts`, `render.ts`: original vector glyphs,
  action/style catalog, editable presets, texture/shadow and thumbnail rendering.
- `assets.ts`: SVG sanitation and corner-connected matte removal.
- `src/components/studio/composition/{shape-gallery,sfx-gallery,asset-import,
boundary-editor,thumbnail}.tsx`: galleries, import preview and canvas gestures.
- Existing workspace/library/properties/canvas/CSS/controller integrate the new
  tools with modes, properties, gestures and drag/drop.
- `src/lib/studio/{backup,backup-store,db}.ts`: reusable asset retention and packages.
- `advanced.test.ts`, `scripts/composition-advanced-browser-check.mjs`, package
  command, README/changelog/report and screenshots: validation and handoff.

Screenshots and machine-readable results are in [organic-composition](organic-composition/).

## Screenshots

- [Fade gallery in the built application](organic-composition/screenshots/fade-shapes-built.png)
- [Original Korean ink styles in the built application](organic-composition/screenshots/ink-styles-built.png)
- [Cross-boundary Hangul and action gallery](organic-composition/screenshots/manhwa-sfx.png)
- [Touch freehand editing at 390px](organic-composition/screenshots/mobile-390.png)
- [Browser results and pixel parity](organic-composition/evidence/browser-results.json)
