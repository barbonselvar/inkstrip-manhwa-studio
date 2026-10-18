# Phase 2 — Individual image editor

Scope: individual chapter images only. No Phase 3 color/brush tools, object eraser,
face detection, or new AI providers are introduced.

## Implemented workflow

- Tap the visible pencil button; desktop users can double-click, right-click, or
  focus an image and press E. Shift+F10 opens image tools.
- Hold a thumbnail for 550 ms on touch devices to open image tools. Movement over
  10 pixels, scrolling, cancellation, or dragging cancels the timer. Reordering
  remains available through the existing chapter arrows and desktop drag behavior.
- Fullscreen mobile editor; desktop canvas with a properties panel. Zoom/fit and
  drag-to-pan change the view only. Hold Space to pan while cropping.
- Exact output dimensions, aspect lock, percentage scaling, chapter-width fit,
  90-degree/custom rotation, horizontal/vertical flips, and separate resets.
- Draw, move, or resize a crop in source coordinates; numeric controls and common
  aspect presets are available. Rotation is applied after cropping.
- Before/after toggle, session undo/redo (50 entries), reset, cancel with discard
  confirmation, and explicit Save. Ctrl/Cmd+Z, Shift+Z/Y, and S are supported.
- Restore original changes the draft until Save; an unchanged original is restored
  byte-for-byte rather than recompressed.

## Data and rendering

IndexedDB remains `inkstrip` version 1. Optional `Panel.edit` contains a versioned
recipe and retained source reference. `Panel.original` retains the imported image.
Existing records do not need a migration. Saved edits are lossless PNG images;
reopening the editor renders from the retained source rather than the last PNG.
Only currently unreferenced intermediate outputs are removed after a successful
transaction. Undo history is session-only, not a permanent version archive.

A dedicated worker owns the decoded bitmap and renders previews capped at 1400px.
Slider movement does not recompress the original. Saving renders the requested
output size and stores the result/thumbnail/metadata atomically. Cancel during
rendering terminates the worker; the short storage transaction cannot be canceled.
A revision check rejects stale saves from another editor/tab.

Accepted edits feed existing chapter stitching and AI enhancement. AI processes
the accepted image, including its crop; it preserves the imported original. AI
results clear the previous transform recipe because the accepted AI output becomes
the new editing source. Export requires rebuilding a stale Display preview. Strip
replacement is transactional, preserving the previous export on storage failure.
Downloads use the rendered strip's format, not an unrendered settings change.

## Compatibility and limits

Requires current browsers with Workers, OffscreenCanvas and createImageBitmap.
Unsupported rendering gives an explicit error without changing stored images.
No fallback renderer, pinch-to-zoom, image compositing/layers, or per-image chapter
position offsets are introduced in this phase. Pan moves the editing view only.

Sources are limited to 80 MB and 32 megapixels desktop / 16 megapixels coarse
pointer devices. Source sides may be up to 65535px; decoding still depends on the
browser's memory. Output limits are 16384px/32MP desktop and 8192px/16MP mobile.
Over-budget output is rejected rather than silently reduced. Very large original
images remain stored and usable in the existing chapter workflow even when this
editor cannot decode them. PNG edits preserve transparency; chapter exports retain
the existing background/format behavior. Arbitrary rotations add transparent edges.
No new dependencies, Vercel settings, environment variables, external services,
image uploads, model downloads, or API keys are required by this editor.
The existing Nitro `tslib` fix and local Swin2SR enhancer are preserved.

## Manual acceptance checks

Use a disposable project with two images:

1. Open the first image using the pencil, right-click/double-click, and E. On an
   Android phone hold the thumbnail; swipe instead and verify scrolling still works.
2. Zoom/pan; resize with aspect lock on/off; rotate and flip; reset each tool.
3. Draw a crop, move it, drag its corners, and choose an aspect preset. Undo/redo.
4. Toggle Before/After. Cancel and discard: chapter pixels must remain unchanged.
5. Save; refresh; reopen. Dimensions and recipe should persist. Adjust again and
   save. Restore original, cancel, then restore and Save; imported pixels return.
6. Stitch with Display, edit a panel, and observe the stale-preview notice. Rebuild
   Display and download. Confirm the saved crop, rotation, image order, and format.
7. Enhance an accepted crop with existing local AI. Compare, apply, then recover
   original. The crop is enhanced; the imported artwork remains recoverable.

## Automated checks

`npm run test:studio` includes geometry, crop, memory limits, history, gesture, and
source-reference regressions. `npm run test:editor:browser -- <local-url>` uses
isolated Chromium desktop/touch profiles and synthetic quadrant PNGs. It checks
accessibility entry points, transforms, crop output pixels, persistence, original
bytes, quota rollback, stale export protection, downloads, native touch gestures,
and layout/runtime errors. `npm run test:studio:browser -- <local-url>` additionally
runs genuine Swin2SR inference on a saved crop, cancellation, batch enhancement,
recovery, stitching, and reader scrolling. Browser tests require Playwright's
Chromium and a running local server; they do not open existing user profiles.

## Changed files

- `src/components/studio/editor/image-editor.tsx`: editor workspace, draft/history,
  preview/save controls, crop interactions and keyboard shortcuts.
- `src/components/studio/editor/number-field.tsx`: validated numeric draft inputs.
- `src/components/studio/editor/panel-image-actions.tsx`: chapter entry points and
  touch gesture handling, including suppression of the opening release click.
- `src/components/studio/chapter-studio.tsx`: editor mount and stale export guard.
- `src/components/studio/enhance-dialog.tsx`: enhance accepted edits with revision checks.
- `src/lib/studio/editor/{geometry,history,gestures,references}.ts`: pure editing contracts.
- `src/lib/studio/editor/{client,worker}.ts`: worker lifecycle and PNG renderer.
- `src/lib/studio/editor/editor.test.ts`: eight focused unit regressions.
- `src/lib/studio/{types,db,store}.ts`: optional recipes, retained sources and atomic saves.
- `src/styles.css`: responsive editor styles using the existing design tokens.
- `scripts/editor-browser-check.mjs`: isolated desktop/native-touch regressions.
- `scripts/studio-browser-check.mjs`: AI regression now verifies accepted-crop input.
- `package.json`: registers editor tests; dependency versions and lockfile unchanged.
- `docs/PHASE_2_EDITOR.md`, `docs/TERMUX_PHASE_2.md`: behavior and patch installation.

Vite, Nitro, Vercel, TypeScript configuration and GitHub workflows are unchanged.
The separate legacy Webpack workflow identified in Phase 1 remains an existing
configuration issue outside this editor phase. The valid Vite CI workflow already
runs `npm test`, including the eight new editor unit tests.

## Validation results — 2026-10-18

- `npm install --no-audit --no-fund`: passed; up to date, no lockfile changes.
- `npm run typecheck`: passed (application and configuration TypeScript projects).
- `npm run lint`: passed with the pre-existing Fast Refresh warning in `ui/button.tsx`.
- `npm test`: 271 tests passed (198 script, 59 template, 14 studio including eight new editor tests).
- `npm run build`: passed with existing dependency directive warnings; no SQL
  migrations configured, so the migration script reports its normal skip.
- `npm run check:build`: passed; Vercel output, browser/AI assets and `tslib` verified.
- `npm run test:editor:browser` against development and production: passed.
  Includes actual quadrant pixels for rotation/flips and saved crop, native touch
  long press/release/scroll cancellation/crop, history, recovery, quota rollback,
  stale preview rebuilding and PNG download checks.
- `npm run test:studio:browser` against development and production: passed using
  real Swin2SR inference; saved crop dimensions, recovery bytes, cancellation,
  batch enhancement and unrelated panels were verified.
- Desktop/mobile smoke comparison: production matched the development baseline;
  no runtime/console errors or overflow. The generic one-second snapshot initially
  captured the loading screen during concurrent AI work; the completed repeat
  matched. An earlier dev run overlapped a CSS hot reload and exposed Vite's
  worker HMR `document` error; the stable repeat and production checks were clean.
- Existing default social-card brand note remains; no branding changes in this phase.

AI inventory is unchanged: local single-thread WASM ONNX Runtime Web 1.22.0 (MIT)
with `Xenova/swin2SR-classical-sr-x2-64` pinned at revision
`93dfc9089abda257351d3a58d5771e2c1ff69442`. Upstream Swin2SR/source weights are
Apache-2.0; the conversion card has no separate license declaration. See the Phase
1 audit for source links. No GPU/API key is required. First-use assets total
about 65 MB; initialization and large-page inference can be slow on mobile.
No new AI feature or license is introduced by this editor phase.
