# R13 performance, AI quality and stability report

R13 measured first, then changed only what the measurements justified. Five changes
shipped: four performance fixes and one data-safety fix. One candidate was measured,
showed no benefit and was reverted. The AI pipeline was audited and given a
real-inference quality benchmark, but its model was not changed.

**Environment.** Shared cloud sandbox (3–4 vCPUs), Node 22.22.0, headless Chromium from
the project's Playwright, production builds served by `vite preview`.

- **Baseline:** unchanged `main` (`5b6c4bd`), built in a separate worktree on :8083.
- **R13:** the R13 branch, served on :8081.
- **Method:** the two builds were measured back to back with the same script, so
  conditions match. R11 measured up to ±29% run-to-run noise in this sandbox, so this
  report only claims gains where the before and after ranges don't overlap.
- **No physical phone.** "390 px" means Chromium mobile emulation.

Scripts live in `scripts/r13/`; raw JSON is in [r13-evidence](r13-evidence/).

## Summary

| Phase       | Baseline finding                                                                                                                                                     | Confirmed problem                                                                                          | Change                                                                                          | Before → after                                                                                             | Status                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1 AI        | Pinned Swin2SR ×2 via the Cache API, overlapped 64 px tiles, alpha preserved, cache purged after a failed load. The only real-inference evidence was one 16×24 crop. | No pipeline defect. Quality on line art was unmeasured.                                                    | `bench:r13:ai`: real inference on 9 original artworks against bicubic, run in CI                | Results come from CI (huggingface.co is blocked here)                                                      | Model **not** changed: no evidence to justify one |
| 2 Raster    | Undo, redo and stroke cost grew with document size                                                                                                                   | ~50 full-document `JSON.stringify` calls per edit: history budget, `record()` and the autosave dirty check | Structural fingerprints of immutable snapshots; equality still confirmed by full comparison     | Heavy doc, per stroke: long tasks 357 → **143 ms**, wall 417 → **279 ms**; redo long tasks 150 → **67 ms** | Shipped                                           |
| 3 Memory    | 14 open/close/import/delete cycles: object URLs and workers flat, heap +0.07 MB/cycle                                                                                | None: the growth is V8 JIT code and performance-timeline buffers, not app objects                          | Lazy-decode page thumbnails                                                                     | 160-page chapter first screen 2460 → **2099 ms**                                                           | Shipped. Batched thumbnail reads: −3%, reverted   |
| 4 Startup   | Home: 216 KB JS, FCP ≈ 0.4 s. New chapter waited for its route chunk. Raster Studio waited for its 107 KB chunk.                                                     | Route and editor code fetched only after the click                                                         | Preload the chapter route in create flows plus `defaultPreload: "intent"`; Raster chunk at idle | Create → workspace 443 → **78 ms**; Raster open 1867 → **1050 ms** (1440 px), 1768 → **991 ms** (390 px)   | Shipped                                           |
| 5 Stability | Autosave runs 500 ms after an edit; `beforeunload` warning only                                                                                                      | **An edit made just before backgrounding was lost when the tab was discarded** (reproduced)                | Save on `visibilitychange`(hidden), `freeze` and `pagehide`                                     | Lost → saved (3/3); CI regression check added                                                              | Shipped                                           |

## Phase 1: AI quality and reliability

**Pipeline audit.** Read from `src/lib/studio/enhance`; no defect found.

- **Weights:** pinned to a Hugging Face commit, so the content is immutable.
- **Download:** 180 s timeout and progress reporting. A truncated download fails before
  it is cached. A cache entry that fails `InferenceSession.create` is deleted, and the
  model handle resets after any error.
- **Tiling:** 64 px tiles with 8 px overlap, cropped back so no artwork is lost.
  Reflect-padding to the window size matches the reference preprocessing.
- **Alpha:** copied from the source after restoration.
- **Limits:** 4 MP / 4096 px, with the original unchanged on error.

**Open question: suitability for line art.** Swin2SR "classical" was trained on DIV2K
photographs. Anime and line-art alternatives (Real-ESRGAN anime 6B, waifu2x, APISR)
could only be compared fairly with real inference on representative images.

**Measurement.** `npm run bench:r13:ai` drives the app's own `EnhancementEngine` and
worker with the pinned weights:

- **Images:** 256×256 centre crops of three original gallery artworks; their provenance
  is in `public/gallery`.
- **Method:** halve each crop, restore it 2×, and compare luma PSNR against the original
  and against bicubic.
- **Presets:** a fidelity preset (no extra filters) and the app's default preset.

huggingface.co is blocked in the development sandbox, so the benchmark runs as its own
informational job in the _External release verification_ workflow. It has a step
timeout and `continue-on-error`, prints each result as it completes, and publishes
`r13-ai-quality.json`.

**Finding: in-browser inference speed.** The first CI attempt restored nine
360×480 images (0.17 MP each). It had not finished after 24 minutes on a GitHub
runner, which is more than 2 minutes per 0.17 MP. The worker runs ONNX Runtime WASM
single-threaded (`numThreads = 1`). Multi-threading needs cross-origin isolation
(COOP/COEP), which would block the platform's third-party script and embeds, so R13
does not change it. Images near the 4 MP cap can therefore take a very long time on CPU.
This is documented as a limitation; WebGPU execution or a lighter model are the
candidates to evaluate next.

**Results** (CI run 41199543792 on `962a717`; raw:
[ai-quality-ci.json](r13-evidence/ai-quality-ci.json)):

| Artwork (128×128 → 256×256) | Bicubic  | Swin2SR, fidelity preset | App default preset | Time per run                       |
| --------------------------- | -------- | ------------------------ | ------------------ | ---------------------------------- |
| action                      | 25.69 dB | **26.56 dB**             | 25.53 dB           | 21.5 s (default preset)            |
| manga                       | 20.76 dB | **21.38 dB**             | —                  | 21.2 s                             |
| romance                     | 24.46 dB | **25.07 dB**             | —                  | 21.3 s                             |
| Mean                        | 23.64 dB | **24.34 dB (+0.70)**     | —                  | first run incl. model load: 30.5 s |

- **Quality:** the pinned model improves on bicubic on all three artworks (+0.6 to +0.9 dB
  luma PSNR).
- **Default preset:** on the one artwork measured with it, the app's default post-processing
  (denoise 15, sharpen 15, artifact cleanup) gave up about 1 dB against the raw model output
  and fell slightly below bicubic. PSNR penalises sharpening, and n = 1, so R13 does not
  change the default. A perceptual comparison over more artwork is the follow-up.
- **Speed:** about 21 s for a 0.016 MP input on a CPU runner. A 4 MP image (the app's
  limit) would take far longer. This is the most significant AI finding.

No model is replaced in R13: that needs this benchmark plus an alternative evaluated
under the same harness, and none has been.

## Phase 2: Raster responsiveness

`scripts/r13/raster-session-benchmark.mjs` uses the real UI, renderer and IndexedDB
autosave. It loads documents whose paint layers hold recorded brush strokes; the
native model keeps strokes as replayable commands, up to 100 k points. It then
measures undo, redo and a real brush stroke, including the autosave they trigger.
n = 9 per action.

| Heavy (900 strokes × 100 pts)        | main p50 / p95 | R13 p50 / p95              |
| ------------------------------------ | -------------- | -------------------------- |
| Brush stroke: main-thread long tasks | 357 / 433 ms   | **143 / 254 ms**           |
| Brush stroke: wall time              | 417 / 439 ms   | **279 / 311 ms**           |
| Redo: long tasks                     | 150 / 276 ms   | **67 / 94 ms**             |
| Redo: wall time                      | 108 / 128 ms   | **72 / 83 ms**             |
| Undo: wall time                      | 98 / 129 ms    | 86 / 100 ms                |
| Open document (n = 3)                | 4388 / 5064 ms | 4547 / 4798 ms (no change) |

Light documents (50 × 60 pts) show 0 ms of long tasks per action on both builds.

**Cause, found with a CPU profile of a stroke.** Each history change serialized the
whole document repeatedly:

- `budgetHistory` sized all of the up to 51 snapshots with `JSON.stringify`.
- `record()` → `same()` serialized the old and new documents.
- The autosave dirty check and save acknowledgement serialized them about four more
  times.

Measured: a 2.7 MB document takes 29 ms per `JSON.stringify`.

**Fix.** `fingerprint()` in `editor/history.ts`:

- It gives the exact JSON length plus a 32-bit structural hash, following
  `JSON.stringify` rules. A unit test checks the length matches exactly.
- Fingerprints are composed from cached child fingerprints. Unchanged layers and
  strokes are shared between snapshots, so a new snapshot costs 0.9 ms instead of
  about 30 ms per stringify.
- `same()` treats different fingerprints as proof of a difference. Equal fingerprints
  are always confirmed by the original full comparison, so a hash collision cannot
  drop an edit or mark unsaved work as saved. A stale fingerprint (an in-place
  mutation, which the app does not do) could only cause an extra entry or save.
- Only numbers are cached, never JSON text.

**What remains per stroke (~140 ms on the heavy document):**

- The save path's revision check reads back the whole previous session record from
  IndexedDB (~100 ms of structured-clone time).
- The recovery checkpoint copy.
- The render reply.

Removing the read-back needs a separate revision record, which is a schema change.
R13 left it alone.

## Phase 3: Memory and large chapters

**Leak test.** `memory-benchmark.mjs`, 14 cycles. Each cycle opens and closes Raster
Studio, opens and closes the image editor, then imports and deletes 3 pages. After a
forced GC:

- Live object URLs: constant at 1.
- Live workers: constant at 0.
- JS heap: 8.0 → 9.4 MB.

A heap-snapshot diff between cycles 3 and 9 attributes the growth to V8 compiled code
and feedback (≈ 0.6 MB) and to the browser's performance-timeline entries. No app
objects, DOM nodes or blobs accumulate.

**Large chapters.** `chapter-open-benchmark.mjs` reloads a chapter and times until
every on-screen thumbnail is decoded. n = 5.

| Pages | main p50 / p95 | R13 p50 / p95                 |
| ----- | -------------- | ----------------------------- |
| 20    | 1455 / 1485 ms | 1542 / 1558 ms (inside noise) |
| 80    | 1922 / 2104 ms | 1788 / 1885 ms                |
| 160   | 2460 / 2553 ms | **2099 / 2283 ms**            |

- **Kept:** thumbnail `<img>` now uses `loading="lazy" decoding="async"`; the row box
  already reserves its size.
- **Memory (estimate, not measured):** thumbnails below the fold are no longer decoded.
  Each is up to 240×360 (≈ 345 KB decoded), so a 160-page chapter could hold up to
  ≈ 55 MB if all were decoded.
- **Reverted:** reading all thumbnails in one IndexedDB transaction with parallel
  header checks measured −3%, inside the noise.
- **Profile:** a 160-page reload is dominated by idle time and native browser work.
  App JavaScript is under 200 ms.

## Phase 4: Startup and application speed

`startup-benchmark.mjs`, on main:

|                        | Home     | Chapter route | Raster Studio |
| ---------------------- | -------- | ------------- | ------------- |
| JS transferred         | 216 KB   | +43 KB        | +115 KB       |
| First contentful paint | ≈ 0.40 s | —             | —             |

Heavy WASM (ONNX Runtime 11 MB, Tesseract 3.9 MB, libheif 2 MB, JPEG XL) is not
requested at startup.

| Flow (in-page timing)                                                        | main                       | R13                      |
| ---------------------------------------------------------------------------- | -------------------------- | ------------------------ |
| Create project → chapter workspace (390 px, two alternating rounds of n = 7) | 443 / 454 ms p50 (p95 545) | **78 / 76 ms** (p95 102) |
| Open in Raster Studio → first composite (1440 px, n = 5)                     | 1867 ms (p95 2120)         | **1050 ms** (p95 1152)   |
| Same, 390 px                                                                 | 1768 ms (p95 1925)         | **991 ms** (p95 1089)    |

**Changes:**

- `usePreloadChapterRoute` starts loading the chapter route chunk while the New
  project dialog is open, and on the project page.
- `defaultPreload: "intent"` preloads a link's route code on hover or touch. The
  routes have no loaders, so only code is fetched.
- When a chapter has at least one image, Raster Studio's code is fetched in
  `requestIdleCallback`.

**Trade-off:** that chunk downloads even if Raster Studio is never opened. The home
page downloads nothing new.

Not changed: the home bundle is already small, and the 21 MB of assets is lazy WASM.

## Phase 5: Stability and project safety

`scripts/r13/lifecycle-browser-check.mjs`, run as `npm run test:r13:lifecycle:browser`
and in CI:

1. Paint a stroke at 390 px.
2. Hide the page 20 ms later, via `visibilitychange` or `pagehide`.
3. Close the page abruptly 60 ms after that, standing in for the OS discarding a
   background tab.
4. Reopen and count the saved strokes.

**On main the stroke was lost in both variants.** Mobile browsers do not fire
`beforeunload` when they discard a tab, and the 500 ms debounce never ran. R13 writes
the unsaved document immediately on `visibilitychange`(hidden), `freeze` and
`pagehide`, through the same queued `persist()` and its error reporting.

Note: headless `Page.setWebLifecycleState("frozen")` did not stop timers here, so it
could not model the discard.

Existing safety suites pass unchanged: recovery checkpoints, native v1–v5
compatibility, import safety, history pixels, and long pages.

## Validation (tested commit in the PR)

- **Static checks:** `npm run typecheck`; `npm run lint` (0 warnings).
- **Tests:** `npm test` — 1109 pass, 0 fail, including 7 new history and fingerprint
  tests.
- **Build:** `npm run build` plus `check:build`; `check:auth`.
- **Browser suites (dev server):**
  - Picker (14 checks, 320–1440 px) and the R13 lifecycle check.
  - Chapter import safety.
  - Raster: masks, patterns, inspector, mobile (320/390), R11 browser, native
    compatibility, geometry, recovery (R8 and R10), raster refinement, long pages,
    split, and R3 brush.
- **Real AI:** the _Built Studio with real AI Enhance_ CI job and the new
  informational AI benchmark run in CI. Both are blocked locally because huggingface.co
  is not reachable from the sandbox.

## Remaining limitations

- No physical Android or iOS device testing.
- The AI model choice is unevaluated against alternatives until the CI benchmark
  reports and an alternative is run under the same harness.
- In-browser AI enhancement is slow on CPU: about 21 s per 0.016 MP on a CI runner,
  single-threaded WASM. WebGPU, threads under cross-origin isolation, or a lighter model
  are the top AI follow-up.
- The default enhancement preset may cost fidelity against the raw model output (−1 dB on
  one artwork). It needs a perceptual comparison over more images before any change.
- Heavy-document strokes still spend about 100 ms in the full-record IndexedDB read
  during save. Removing it is a schema change, deferred.
- Opening a document near the 100 k-point cap takes about 4.5 s, dominated by
  rendering the strokes. Not changed.
- Timing numbers come from a shared sandbox. Use the before/after pairs, not the
  absolute values.
