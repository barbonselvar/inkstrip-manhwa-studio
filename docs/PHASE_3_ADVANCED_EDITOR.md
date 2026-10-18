# Phase 3 — Advanced image editing tools

Scope: extend the existing Phase 2 editor; no Phase 4 object eraser, new AI model,
server integration, or deployment. Phase 2 approval was received before starting.

## Functional changes

**Adjust** provides working brightness, contrast, exposure, saturation,
temperature, sharpening, noise reduction and blur controls. Every control has a
slider, exact number input and individual reset; the panel has a combined reset.
Four conservative presets (Natural ink, Soft color, Monochrome and Gentle lift)
replace only the whole-image adjustments. Neutral settings preserve pixels.
These are classical local pixel filters, clearly distinguished from AI.

**Selective** provides paint and erase-mask brushes, source-pixel brush size,
hardness and opacity, a colored mask overlay, mask visibility, clear mask and pan
mode. Erasing removes mask coverage, never image pixels. The same adjustments can
be applied inside the mask, after the global adjustments. An unpainted mask has
no effect. Source-coordinate strokes follow crops, flips, rotation, resizing and
artwork placement. Selection view temporarily shows the entire source so users
can select accurately; switch to Transform or Adjust to see the actual output.
Hold Space to pan while painting, or use Pan view and the existing zoom controls.
Each completed stroke is one undo step. Pointer cancellation discards that stroke.

**Artwork positioning** is in Transform. Set Artwork scale below 100% to create
transparent space within the existing output dimensions. Position using numeric
pixel offsets or left/center/right/top/middle/bottom alignment. Frame/center guides
appear while positioning. Positions are bounded so the whole rotated crop stays
inside the frame. This changes saved pixels without hiding artwork outside the
frame. Chapter ordering, chapter spacing and chapter layout controls are unchanged.

The existing Before/After, crop, transforms, session undo/redo, reset, explicit
Save, cancel/discard, original recovery, AI enhancement and chapter export remain
available. Tool navigation stays accessible while scrolling long property panels.

## Processing and persistence

The existing dedicated worker now draws the transformed source into 384px output
pixel tiles, with surrounding contextual pixels for spatial filters. It processes
whole-image adjustments, then masked adjustments, then copies each tile interior
once. This avoids an additional full-resolution filtered-source copy. Blur is an
alpha-weighted separable box blur, noise reduction uses a conservative edge-aware
3x3 neighborhood, and sharpening uses a bounded unsharp mask. Alpha is preserved;
fully transparent pixels do not contaminate neighboring colors. Temperature is a
warm/cool RGB shift, not a calibrated white-balance temperature in Kelvin.

Previews remain capped at 1400px, debounced, and rendered off the UI thread.
Obsolete preview requests are canceled between tiles. Full-resolution Save reports
tile progress; Cancel terminates the worker before any accepted media is replaced.
A failed storage transaction preserves the previous image and resumes previewing.
The short database commit itself cannot be canceled.

Recipes add optional `adjustments`, `selective` and `layout` fields to the existing
version-1 recipe. Old Phase 2 recipes keep working. IndexedDB remains version 1;
no migration, project reset or source reimport is required. Validated limits reject
invalid numeric settings and overly complex masks (128 strokes, 512 points per
stroke, 8192 points total). Very long gestures are sampled down while preserving
the latest path. Originals and retained editing sources use the existing atomic
save/recovery path. Reopening a saved image renders from its retained source;
sliders do not repeatedly recompress the accepted PNG.

Accepted edits feed existing stitching and real Swin2SR enhancement. Chapter
exports use the saved filtered/positioned image; a stale Display must be rebuilt.
AI accepts the adjusted image, then keeps the imported original recoverable.

## Limits and deliberately deferred work

- Worker/OffscreenCanvas/createImageBitmap support and Phase 2 image memory limits
  still apply. Unsupported processing displays an error and leaves media intact.
- CPU pixel filters run locally in a worker; no WebGPU shader or GPU AI backend is
  claimed. Large exports can take time on phones. Preview noise/sharpen kernels
  and small blur radii are approximate at reduced resolution; inspect saved output
  at native size for fine lettering. Blur radius refers to output pixels.
- Mask overlay rasterization is capped at 700px and animation-frame scheduled.
  Very complex masks can still be slower on low-memory devices.
- Before shows the retained editing source; it can differ in dimensions from the
  transformed output. Undo/redo is session-only, not a permanent revision archive.
- Mask settings are not drawing/annotation layers. Optional annotation tools,
  project-wide preset libraries, batch manual adjustments and advanced chapter
  placement are deferred. No fake AI object eraser or face correction is added.
- Chromium desktop and native touch events in mobile emulation are tested;
  physical Android device coverage is not available in this environment.

No packages or dependency versions are added/upgraded; the lockfile is unchanged.
No Vite/Nitro/Vercel configuration, secrets or environment variables are changed.
The existing `tslib` bundling fix remains. The unrelated legacy Webpack workflow
identified in Phase 1 is outside this phase; the valid Vite CI already runs the
new unit tests through `npm test`.

## AI inventory and service configuration

No new AI provider is needed. Existing local enhancement uses ONNX Runtime Web
1.22.0 (MIT), single-thread WASM, with `Xenova/swin2SR-classical-sr-x2-64` pinned at
`93dfc9089abda257351d3a58d5771e2c1ff69442`. Upstream Swin2SR/source weights are
Apache-2.0; the conversion card has no separate license declaration. The existing
weights are downloaded on user-initiated enhancement, not bundled in this patch.
First use needs about 65 MB of public assets. CPU processing and model initialization
can be slow on mobile. No API key or GPU is required and artwork is not uploaded.

Phase 4 must first select a genuine inpainting solution and explain its cost,
privacy, licensing and hosting requirements before integrating any cloud service.

## Changed files

- `src/lib/studio/editor/adjustments.ts`: filter definitions, presets, pixel pipeline
  and halo calculations.
- `src/lib/studio/editor/mask.ts`: validated strokes, soft capsule coverage, affine
  mapping, ordered mask erasing and RGB blending.
- `src/lib/studio/editor/geometry.ts`: optional recipe extensions and frame transform.
- `src/lib/studio/editor/worker.ts`, `client.ts`: tiled renderer, preview cancellation
  and save progress protocol.
- `src/components/studio/editor/adjustment-controls.tsx`, `layout-controls.tsx`,
  `mask-canvas.tsx`: focused property panels and touch/mouse selection interactions.
- `src/components/studio/editor/image-editor.tsx`: integration with existing draft,
  history, source recovery and Save; preview recovery following a failed save.
- `src/styles.css`: controls, mask cursor/overlay, frame guides and sticky navigation.
- `src/lib/studio/editor/adjustments.test.ts`: eleven focused unit regressions.
- `scripts/adjustments-browser-check.mjs`: isolated pixel/UI/export/touch regressions.
- `scripts/browser-smoke.mjs`, `browser-smoke-verdict.mjs`, `browser-smoke-verdict.test.mjs`:
  optional readiness selector prevents false startup-screen comparisons, with two regressions.
- `scripts/studio-browser-check.mjs`: genuine AI regression now uses an adjusted crop.
- `package.json`: test commands only; no dependency changes.
- `docs/PHASE_3_ADVANCED_EDITOR.md`, `docs/TERMUX_PHASE_3.md`: report and delivery guide.

## Manual acceptance steps

Use a disposable chapter and keep production artwork in its normal browser profile.

1. Open an image, choose Adjust, and change each control. Compare Before/After,
   individual resets, presets and undo/redo. Cancel: accepted artwork must not change.
2. Choose Selective, set brightness, then paint a small area. Hide the overlay to
   inspect the result. Erase a hole, change hardness/opacity and zoom in. Undo/redo.
3. Change the crop and rotate/flip. Switch back to Adjust or Transform: selective
   changes should follow the same source region rather than another character.
4. Reduce Artwork scale, align or enter offsets. All content should stay in the
   transparent frame. Save, refresh and reopen: settings and mask must persist.
5. Restore original and Save. The original import returns without recompression.
6. Apply detail filters to an image wider than 384px, Save, rebuild Display and
   export PNG. Check line art and transitions around tile boundaries at native size.
7. Start a large save and Cancel. The accepted image must remain unchanged. Try a
   small save, then existing local AI enhancement; compare/apply/recover normally.

## Validation commands and results

- `npm install --no-audit --no-fund`: up to date; lockfile unchanged.
- `npm run typecheck`: application and configuration TypeScript projects passed.
- `npm run lint`: zero errors; one pre-existing Fast Refresh warning in
  `src/components/ui/button.tsx`.
- `npm test`: 284 tests passed (200 scripts, 59 template, 25 studio).
- `npm run build`: production Vite/Nitro build passed; existing dependency directive
  warnings remain. The migration script reports its normal skip with no SQL setup.
- `npm run check:build`: Vercel runtime/browser assets and `tslib` bundling passed.
- `npm run test:adjustments:browser`: passed in development and production. Checks
  direct RGB controls, reset/preset/keyboard history, paint/erase and outside-mask
  pixels, persistence, crop/rotation/position mapping, fractional offsets, alpha,
  whole-frame reference versus tiled save, PNG chapter export, original bytes,
  quota rollback/preview recovery, unsupported rendering, touch cancellation,
  worker cancellation and an active UI timer during a large render.
- `npm run test:editor:browser`: Phase 2 desktop/touch regressions passed, including
  import, transforms, crop, recovery, quota rollback, stale exports and long press.

The requested `agent-browser` executable was unavailable on both attempts;
Playwright drove the actual browser regression flows instead. Early test assertions
were corrected to read adjustments from `panel.edit.recipe`; a load-event timeout
was corrected by waiting for DOM content and actual controls instead of external
page assets. Reported successes are from completed reruns, not those failed runs.

All checks use disposable browser contexts and synthetic artwork. No existing
projects, secrets or production storage are used. These are 8-bit sRGB tools, not
HDR/color-managed photographic calibration. Native-size output review remains
appropriate when editing fine dialogue or heavily compressed source artwork.

- `npm run test:studio:browser -- http://127.0.0.1:8081`: genuine production Swin2SR
  inference on an adjusted 16x24 crop passed, including comparison, apply/reload,
  byte-exact original recovery, cancellation and batch enhancement/recovery.

- Development/production smoke uses `--ready-selector 'button:has-text("New project")'`
  before taking snapshots; the old fixed-delay check sometimes captured startup
  during concurrent work. This is a QA readiness fix, not a change to application
  loading. The existing default social-card brand note remains outside this phase.

The final readiness-based desktop/mobile smoke comparison matched production to
development with no console/runtime errors or horizontal overflow. Screenshots
of the editor and mobile selective result were inspected. No push or deployment
is performed as part of this phase.
