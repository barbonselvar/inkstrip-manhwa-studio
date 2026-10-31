# R14 AI engine implementation and review scope

Base: main `2ff54b2fd6297e63b225a11187c7cc5a1995669f` (R13).
Branch: `codex/r14-ai-engine-optimization`. Development only; no merge or production deployment.
The older R10 worktree and its unpublished reports/evidence are preserved separately.

## Architecture audit before implementation

| System                 | Existing implementation                                                                                                                                                          | R14 finding / next gate                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enhancement            | Pinned Swin2SR classical ×2, ORT WASM single-thread worker, 64px tiles with 8px overlap, Cache API, progress/cancellation, 1× or 2× output, original retention and preview/Apply | R13's raw model beats bicubic on three held-out gallery crops; default cleanup loses fidelity on one measured crop. Extend the comparison before changing defaults. 4× requires a real second inference pass or a validated native ×4 model. |
| Eraser                 | Deterministic exemplar texture synthesis in 256px context; native output; feathered selections; Cancel/Accept/history                                                            | Not neural AI. Composition currently resizes a low-resolution selection mask, which requires exact outside-mask regression coverage. Evaluate LaMa separately; preserve working local repair.                                                |
| Face Fix               | Local anime-cascade region suggestions; selected reference/notes sent to owner-protected gpt-image-1 endpoint; strict PNG validation                                             | Paid service is existing optional functionality, not invoked for R14. No tested free identity-conditioning pipeline exists; do not claim identity preservation or paste a reference face.                                                    |
| Character Library      | 32 profiles/project, 1–6 independent PNG references/profile, names/notes/angle labels, primary reference, upload/crop, IndexedDB/backup validation                               | Already implemented. Preserve data/versions; improve only confirmed missing workflows.                                                                                                                                                       |
| Line cleanup           | Edge-aware denoise, bounded unsharp and slight saturation controls in enhancement; R6/R8 filters                                                                                 | Keep distinct from neural inference. Evaluate fidelity presets and edge/alpha/color behavior on actual artwork.                                                                                                                              |
| Background consistency | Local texture repair or optional cloud edits                                                                                                                                     | No reference-guided geometry/identity model exists. Requires tested conditioning and multi-panel evaluation; no automatic consistency claim.                                                                                                 |
| Translation            | Local Tesseract including Arabic/English/Korean/Japanese (French model missing), manual replacement, real cleanup and shaped whole-line RTL lettering                            | Existing complete manual workflow must be reused. Automatic translation needs licensed weights/runtime and quality evaluation; never simulate it.                                                                                            |
| Editing assistant      | Existing commands/tools and explicit Apply/Cancel                                                                                                                                | A deterministic intent router could propose real tools, but must not pretend to execute generative edits. Stage C is research/prototype after Stage A/B gates.                                                                               |

Native document schema/envelope and database formats remain unchanged. Chapter image replacement retains original files; Raster editing retains native sources/layers/history. No GPU server or paid dependency is introduced. Vercel remains orchestration/static hosting, not an inference GPU.

## Model evaluation policy

Keep the pinned Apache-2.0 Swin2SR baseline until a candidate has measured quality,
latency, memory and licensing/provenance evidence. Real-ESRGAN code is BSD-3-Clause;
individual converted weights still need their own pinned source and attribution.
LaMa code and the evaluated Carve model card declare Apache-2.0; its 512px FFT-based
ONNX export and 208MB download require separate browser/memory testing.
No mock output is inference evidence. Synthetic image fixtures test invariants only.

## Execution order

1. Baseline real inference on all three R13 artworks with both raw and current default settings; evaluate one Real-ESRGAN candidate.
2. Implement bounded 4× only with real inference, fidelity controls and resource preflight; test worker lifecycle, native integration and mobile.
3. Improve eraser precision and evaluate neural inpainting feasibility; preserve existing repair.
4. Validate reference/library behavior and explain free identity-conditioning constraints.
5. Complete line restoration and Stage C research/prototypes only where reliable.
6. Run static/unit/browser/native/export gates, publish raw benchmarks, verify exact-HEAD CI and Vercel Preview; keep one Draft PR.

## Stage A1 — implemented upscaler changes

- Swin2SR remains the default. Fidelity defaults turn off optional cleanup because
  all three extended baseline crops improved: mean luma PSNR 23.53→24.34 dB versus
  23.64 dB bicubic. Legacy cleanup is still an explicit preset; no controls were removed.
- Optional pinned BSD-3-Clause RealESR-AnimeVideo-v3 native ×4 model. It is a
  third-party ONNX conversion, not an assertion of official binary equivalence.
  The model card license and original upstream license are recorded. Initial
  whole-plane runs on identical inputs took 744–797ms and mean PSNR was about
  24.35dB, with a 0.23dB loss against Swin2SR on the monochrome crop. The production tiled
  path completed the nine-artwork comparison below; no universal speedup or
  identity preservation is claimed.
- 1×/2×/4× outputs, real two-pass Swin2SR for 4×, one native Real-ESRGAN pass.
  Native ×4 patches can be resampled directly to owned 1×/2× output cores with halos;
  there is no giant full-resolution ×4 intermediate for smaller requested output.
- Unchanged 4MP/4096px input and 16MP/8192px output ceilings. 4× therefore accepts
  at most 1MP and 2048px/side. Batch retains at most 8 source/32 output megapixels.
  Actual header/scale checks run before decode, weights loading and image allocation.
- Both model files have exact byte counts and SHA256 verification before session
  creation or caching. Streams are bounded, corrupt cache entries are discarded,
  and model/runtime resources are closed on cancellation/error/switch.
- Stale worker progress/results cannot affect a newer run. Disabled finishing
  operations avoid copying/looping over full planes. Existing Swin2SR 1×/2× raw
  output remains pixel-identical to unchanged main, including soft alpha.
- Existing preview/Apply/recover transactions retained. Added a scroll-contained
  100% pixel comparison, explicit model/preset/scale controls and mobile labels.

Initial Stage A validation: 1113 unit tests, typecheck, lint and production build passed;
real 1×/2×/4×, exact alpha/source bytes, corrupt-cache recovery, cancellation and
oversized-output checks passed. Five-width real Fast Anime UI checks passed at
1440/768/390/360/320, including exact 100% display geometry, Apply, original-byte
recovery and subsequent Raster opening. Final consolidated checks and CI are documented in the test report and PR.

Two new harness setup errors are preserved separately: the comparison server was
initially started with an overriding default port, and a synthetic safety fixture
needed a real canvas context before PNG encoding. Assertions were unchanged. The
first broader quality attempt failed to fetch weights; the rerun uses the existing
project browser proxy configuration and records network failures. None is counted
as a passing run.

## Stage A2/A3 — confirmed mask ownership fix and identity boundary

A strict 513×437 local-repair test reproduced 1,485 changed native unselected pixels,
including a subtract hole. The cause was upsampling the 256px synthesis mask during
composition. Final ownership now repaints the original validated selection in native
coordinates. The same unchanged assertion passes with **0** changed outside pixels
and 75,984 actually repaired selected pixels. This also protects the shared final
composition path used by Face Fix; it does not establish cloud/model quality.
The original retouch UI/save/Undo/Redo/reload regression passes. Native/DB formats,
texture synthesis, reference conditioning and paid-provider configuration are unchanged.

Reference-conditioned identity editing is **deferred**, not disguised as local texture
repair or reference pasting. InstantID's own README says its checkpoints and required
InsightFace face models are research/non-commercial only. IP-Adapter-FaceID repeats
that restriction. PhotoMaker documents a minimum 11GB GPU requirement (with possible
optimizations), beyond Vercel and the current browser architecture. No paid provider
was invoked and no multi-panel identity preservation is claimed.

Sources inspected 2026-10-31:

- https://github.com/InstantID/InstantID#usage-guidelines
- https://huggingface.co/h94/IP-Adapter-FaceID
- https://github.com/TencentARC/PhotoMaker
- https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE
- https://huggingface.co/tidus2102/Real-ESRGAN/tree/c9a1cd990b587ccf20be2373fad8eb021e24ab01
- https://huggingface.co/Carve/LaMa-ONNX/tree/c3c0c9e468934d62e79c329e35d82dd09ff8c444

## Stage B — reference usability and line restoration

- Existing multiple references, names, notes, angle/primary selection and independent
  blobs are reused. View/expression labels can now be renamed. Five-width tests
  verify two references, stable IDs and Blob hashes, primary choice, reload and
  unchanged panel artwork. No record fields or database versions were added.
- Confirmed non-square selection bounds used normalized height for a width-based
  brush radius. The new test fails before the fix. Retouch/reference cropping now
  accounts for the native aspect ratio; legacy one-argument calls retain their defaults.
- Optional, explicitly deterministic 1px monochrome ink-gap repair. It only joins
  opaque, nearly black runs across one nearly white pixel with three known ink pixels
  on each side. Saturated colors, soft alpha and wider gaps remain unchanged. It is
  off by default and does not pretend to reconstruct larger missing drawing details.
- Added Manga Ink preset and retained existing controls. Settings changed after
  inference require regeneration before Apply, so controls cannot misrepresent the
  pixels being committed. Strict five-width UI tests cover this guard.

## Stage C — feasibility/prototypes, not shipped capability claims

- **LaMa:** real pinned Apache-2.0 512px ONNX inference succeeded: 23.28s inference,
  46.70s including load, sampled process-tree peak 1475MiB. No GPU service was used.
  This is a research-only worker; its 208MB download, mobile memory implications and
  unverified multi-image perceptual quality prevent production adoption in R14.
  Existing local repair remains supported. No broad background reconstruction or
  identity claim follows from this single occlusion experiment.
- **Background consistency:** deferred. Reusing a palette is not scene conditioning;
  a reliable solution needs reference/geometry conditioning, commercial-use model
  verification and multi-panel perspective/object-consistency evaluation. No fake UI.
- **Translation:** existing manual OCR→cleanup→lettering is preserved. A real French
  Tesseract prototype recognizes the accented fixture exactly using pinned verified
  weights and the existing runtime. Its descriptor exists only in an isolated page:
  production language enums/native records currently omit French. No prototype
  regions were persisted. Automatic Arabic/English/French translation still needs
  a licensed model/tokenizer, quality evaluation and explicit native compatibility work.
- **Assistant:** a tested research-only rule router proposes existing masked repair
  or line controls for constrained English/French/Arabic requests. It executes no
  edits, uses no LLM and calls no provider. Face identity and ambiguous requests are
  deferred/refused explicitly; it is not exposed as a general AI assistant.

## Measured quality/performance

Nine 256px centre crops from the original gallery, downsampled to 128px then restored
by the actual editor worker. Mean luma PSNR: bicubic 24.385dB, Swin2SR 24.967dB,
Fast Anime 25.121dB. Mean RGB absolute error favors Swin2SR (9.023 vs 9.833); Fast
Anime removes some fine hatching/rain, visible in the saved comparisons. Therefore
Swin2SR remains the default; faster output is opt-in, with mandatory review.
Median observed per-crop times were 41.10s/1.48s, including model preparation on
switches. Shared-host results are not a universal speedup or perceptual guarantee.
Sampled Node/Chromium process-tree peak was 1163MiB, not an isolated WASM/GPU peak.

The actual original 720×960 gallery panel produced 2880×3840 (11.06MP) in 85.46s,
with a sampled 882MiB peak. Original compressed bytes stayed exact. Cancelling after
one completed native tile terminated processing; a new real run then succeeded.
No near-limit 16MP input or physical Android performance claim is made.

See raw evidence and before/after panels in `docs/r14-evidence/`. Final regression,
exact-HEAD CI and Vercel Preview verification are recorded in the test report.

## Final review scope

Final application source: `30ac825a891754fb1ec5e094131f0f8e91b69d4c`.
The final guard compares effective parameter values, so restoring the default model
or optional flags does not unnecessarily invalidate an equivalent preview. Original
device-specific import policies are retained beneath the AI area/scale preflight.
1121 unique unit tests and the final frozen candidate's 13 targeted commands pass;
the broad 21-command browser/worker/smoke coverage and its initial corrected harness
failure are detailed in the test report. Native/database versions remain unchanged.

| Requested area         | Delivered / remaining boundary                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upscaler               | Real Swin2SR/optional Fast Anime, 1×/2×/4×, fidelity/cleanup/ink controls, exact alpha, native comparison, original retention and bounded processing verified.                 |
| Eraser                 | Native ownership/aspect defects fixed. Existing local texture repair preserved; neural LaMa is a real research prototype, not a shipping option.                               |
| Face consistency       | Precise shared composition retained, references preserved. Free identity-conditioned model deferred for licensing/infrastructure; paid model not invoked or quality-validated. |
| Character Library      | Existing multi-reference system reused; editable view/expression labels, IDs/Blob bytes/primary/reload verified.                                                               |
| Line restoration       | Optional conservative tiny-gap repair and measured fidelity defaults/presets. Larger missing drawing/color restoration is not guaranteed.                                      |
| Background consistency | No validated reference/geometry-conditioned engine adopted.                                                                                                                    |
| Translation            | Existing manual workflow and Arabic shaping preserved; real French OCR prototype only. Automatic translation and persistent French metadata deferred.                          |
| Assistant              | Tested rule-based proposal prototype only; no LLM, automatic edits or provider calls.                                                                                          |

R14 is ready to review within this implemented scope; it is **not** claimed complete
for all advanced AI goals. Vercel Preview is Ready but login-protected from this
environment. No merge/production deployment is performed; keep Draft PR #28.
