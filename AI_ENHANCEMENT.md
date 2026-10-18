# On-device AI enhancement

Inkstrip runs a real neural super-resolution model in a dedicated Web Worker.
No AI service account, API key, server endpoint, or environment variable is
required. The working Vercel/Nitro configuration and `tslib` fix are unchanged.

## Engine and privacy

- Runtime: `onnxruntime-web` 1.22.0, WebAssembly SIMD, one thread. Its WASM and
  loader assets ship with the app. No native Node runtime or CUDA install.
- Model: [Xenova/swin2SR-classical-sr-x2-64](https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64),
  pinned to revision `93dfc9089abda257351d3a58d5771e2c1ff69442`, FP32 ONNX.
- On first use, the browser downloads the public model weights (about 54 MB, plus an 11 MB WASM runtime)
  from Hugging Face, including its download/CDN hosts. Only model downloads use
  the network; artwork is not sent to an AI provider. A successful download is
  cached with the Cache API when available. Browser eviction/private mode can
  require another download. Initial engine preparation can take a minute or more.
- The neural model reconstructs a 2× image. Overlapping tiles limit inference
  memory; only padding/overlap is discarded, retaining every source pixel's
  position in the final composition. Original-size mode downsamples that result.
- Noise reduction and artifact cleanup use conservative edge-aware pixel
  processing. Sharpening is bounded and color boost is optional. These are
  honestly described supporting filters, not separate generative AI models.
- There is no face replacement, dialogue generation, or prompt-based redraw.
  Super-resolution can still change fine lettering/details. Review the comparison
  before applying; no restoration model can guarantee identical fine details.
  For exact preservation, retain/recover the original.

## Usage

1. Open a chapter and import images as usual.
2. Use the sparkle button beside an image for individual enhancement, or check
   images and use **AI Enhance · N selected** for a batch.
3. Choose 2× or original size, noise reduction, sharpening, artifact cleanup,
   and optional gentle color boost. Press **Enhance**.
4. Follow actual model download and tile progress. **Cancel processing**
   terminates the worker immediately, including model loading/inference.
   Completed batch previews remain available; unapplied originals are untouched.
5. Use the before/after slider and previous/next controls to inspect every result.
   **Apply previews** explicitly saves the results. **Recover originals** restores
   the original bytes and dimensions, including after a reload.
6. Press **Display** again to stitch enhanced or recovered panels. The previous
   stitched chapter remains readable until rebuilt and is marked stale.

Recovery is available by reopening the image/batch's AI Enhance dialog after
applying. The original blob and thumbnail are retained in the existing IndexedDB
`inkstrip` database. There is no destructive schema migration: all new panel
metadata is optional. Writes of image, thumbnail, panel reference and timestamps
are transactional. A quota/write failure rolls back to the previous image.
A batch commits one image at a time and reports partial saves if storage fails.
Explicitly deleting a panel/chapter/project still removes its associated media,
including recovery copies, as the existing confirmation explains.

## Android and limits

Use a current Chrome/Chromium-based Android browser with WebAssembly SIMD,
Web Workers, OffscreenCanvas, createImageBitmap and IndexedDB. HTTPS is needed
for reliable model caching. UI work stays on the main thread; inference and
pixel processing run off-thread. Sequential batches avoid parallel inference
spikes. Cancel also releases the worker/model memory.

Limits are 4 megapixels and 4096px per source side; the intermediate 2× image
is bounded to 16 megapixels / 8192px per side. A batch allows up to 12 images
and 8 megapixels of source artwork total. Oversized input is rejected with an
explanation; it is never silently resized or cropped. Mobile browsers may have
lower practical memory limits. Start with one small panel; CPU processing can
take several minutes and uses battery. The worker is terminated on dialog close.

## Validation

- Clean locked install, production build, Vercel output/tslib check, app/config
  TypeScript, lint, and 263 unit tests pass. Lint retains one existing Fast Refresh
  warning; upstream build directive warnings remain unsuppressed.
- A production-browser integration check ran the actual downloaded model with
  real ONNX inference on small synthetic artwork fixtures. It covered individual
  and batch processing, comparison, cancellation, apply/reload/recovery, a
  simulated quota failure, byte-exact original recovery, scrolling metadata,
  and Android-sized layout overflow. It used an isolated browser profile,
  never an existing user's data. This is Chromium emulation, not a physical
  Android device or an artistic-quality guarantee for every manhwa.
- `npm run test:studio:browser -- http://127.0.0.1:8081` runs the integration check
  with an existing production preview. It needs Playwright Chromium installed,
  first-use model network access, and several minutes. It accepts local servers
  only; it does not deploy or invoke a paid API. The browser CLI mentioned in the
  repository instructions was unavailable, so this check uses Playwright.

## Changed surfaces

- `src/styles.css`, studio library/project/chapter views, shared button/modal and
  chrome: responsive dark design, restrained mint accents, glass-like chrome,
  project search, workflow guidance, touch targets, reduced-motion support.
- `reader-header.tsx`, `reader-scroll.ts`: normal-flow metadata, passive scroll
  observation, animation-frame batching, direction hysteresis, reduced-motion
  support. The chapter information is not fixed/sticky and cannot cover the
  image. Downward scroll fades it out; upward scroll restores its opacity as it
  returns into view. Images retain full aspect ratio and natural height.
- `enhance-dialog.tsx`, `src/lib/studio/enhance/*`: local AI engine and controls.
- `studio/types.ts`, `db.ts`, `store.ts`: optional recovery metadata, atomic media
  saves, restoration, and stale stitched-page detection after media changes.
- `scripts/preview.mjs`: do not mistake a zombie process for a live preview.
- `scripts/check-build.mjs`: verify that the AI worker, WASM, and loader ship.
- Unit/browser regression checks, npm test scripts, the single new runtime
  dependency, lockfile, and this guide.

Nothing has been pushed or deployed. Publishing main can trigger the existing
Vercel Git integration, so it remains pending owner confirmation.
