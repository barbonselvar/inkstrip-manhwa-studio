# R14 model evaluation and limitations

Models run in existing dedicated browser workers with single-thread ONNX Runtime WASM.
There is no GPU server, new dependency, paid API call or change to Vercel runtime requirements.
No model weights are checked into the repository. Their URLs, lengths and SHA256 values
are pinned in `src/lib/studio/enhance/models.ts` and verified before use/caching.

| Model                         | Licensing/provenance inspected                                                                                                                       | Result / disposition                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Swin2SR classical ×2          | Upstream Apache-2.0; Xenova conversion at `93dfc9089abda257351d3a58d5771e2c1ff69442`, 54,428,699 bytes                                               | Retained as default. 1×/2× legacy raw pixels match main exactly. 4× uses two genuine ×2 passes.                                                        |
| RealESR-AnimeVideo-v3 ×4      | Upstream BSD-3-Clause; converted artifact declares BSD-3-Clause at `tidus2102/Real-ESRGAN@c9a1cd990b587ccf20be2373fad8eb021e24ab01`, 2,495,473 bytes | Opt-in Fast Anime. Conversion is third-party; official binary equivalence is not asserted. Attribution notices are retained in the evidence directory. |
| LaMa                          | Upstream and Carve model card Apache-2.0; `c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx`, 208,044,816 bytes                               | Real 512px inference succeeds, research-only. Production deferred for mobile memory safety and multi-image quality validation.                         |
| InstantID / IP-Adapter-FaceID | Upstream explicitly restricts required InsightFace weights / released checkpoints to research/non-commercial use                                     | Not adopted for commercial editing. No identity-preservation claim.                                                                                    |
| PhotoMaker                    | Repository describes an 11GB minimum GPU requirement, with possible optimizations; base/checkpoint licenses still need complete review               | No compatible browser/Vercel GPU path; deferred. No infrastructure installed.                                                                          |

## Nine-artwork reconstruction comparison

Actual original gallery artwork, 256×256 centre crops reduced to 128×128, then restored
by the editor's own worker. The baseline uses Canvas `imageSmoothingQuality="high"`
(the R13 “bicubic” label); the exact browser resampling kernel is implementation-defined.
All model comparisons use the same input pixels. Metrics are per-image means, not a
claim of perceptual superiority, identity matching or generalization to all manga.

| Metric                                | Browser high-quality baseline | Swin2SR fidelity | Fast Anime |
| ------------------------------------- | ----------------------------: | ---------------: | ---------: |
| Mean luma PSNR (BT.601), dB           |                        24.385 |           24.967 |     25.121 |
| Mean RGB absolute error (8-bit units) |                        10.085 |        **9.023** |      9.833 |
| Mean horizontal luminance-edge error  |                        12.837 |           12.498 |     12.068 |
| Observed median ms / crop             |               not benchmarked |           41,099 |      1,478 |

Times include model preparation when switching models. Measurements are local,
shared-host Chromium observations; some validation tasks ran concurrently. The
sampled Node/Chromium descendant peak was 1,163MiB, not an isolated WASM/GPU peak.
No physical Android or universal speedup guarantee is implied.

Fast Anime simplifies some rain, hatching and fine textures. Swin2SR has lower RGB
error, so it remains the fidelity default. Users must compare before applying.
On the three extended R13 crops, disabling legacy default cleanup raises mean PSNR
23.53→24.34dB. Cleanup remains available as explicit presets/controls.

Before/after panels: [action](r14-evidence/comparison-action.png),
[manga](r14-evidence/comparison-manga.png), [romance](r14-evidence/comparison-romance.png).
Raw: [nine-artwork-quality.json](r14-evidence/nine-artwork-quality.json).

## Tiling, alpha and large-panel evidence

Fast Anime uses 64px owned cores with 20px input halos; Swin2SR retains its existing
64px/8px path. Exact comparisons against whole-model Fast Anime processing pass for
native 4× and resampled 2×: 327,680 pixels / 1,310,720 RGBA channels, zero differences.
Both engines preserve source alpha. Fourfold Swin2SR is explicitly a two-pass mode;
it is not represented as a separately trained native 4× checkpoint.

An actual 720×960 original gallery panel produced 2880×3840 in 85.46s, with source
compressed bytes unchanged and a sampled 882MiB process-tree peak. It completed 180
tiles. Cancellation after a completed tile stopped processing, and a new job succeeded.
This tests 11.06MP output, not every image at the 16MP cap.

The original 4MP/4096px source and 16MP/8192px output ceilings remain. Consequently,
4× accepts at most 1MP/2048px per side. No source image is silently reduced. Batch
caps remain 8 source/32 output megapixels. Raster's separate device limits still
apply when opening enhanced results (4MP on constrained devices).

## Research results

LaMa: 512×512,23.28s inference / 46.70s total, sampled 1,475MiB. One occlusion experiment
is insufficient to adopt an inpainting model or promise recovery of hidden artwork.
The prototype has a 180-second time budget and external 3GiB process-tree research guard;
these are not production memory guarantees. See raw prototype/resource JSON.

French OCR: the existing runtime recognized “UNE HISTOIRE À PARIS” using real pinned
`tessdata_fast` weights (`fra`, 1,130,365 bytes; SHA256 in the prototype). A descriptor
was injected only into an isolated research page. Production/native language enums
remain unchanged; automatic translation is not implemented. Existing Arabic shaping
and manual OCR/cleanup/replacement tools are preserved.

Background consistency needs a tested reference/geometry-conditioned model and a
commercial-use license review. Color matching alone cannot prove scene consistency.
The assistant prototype is explicitly rule-based, proposes existing tools, never
executes edits and defers unsupported/identity requests. It is not a shipped LLM.

The LaMa experiment demonstrates desktop feasibility, not a GPU requirement or a
production-ready quality improvement. Its converted-weight/training-data provenance,
coexistence with large Raster documents, mobile limits and comparative inpainting
quality still need review before exposing it. Declared model licenses do not
constitute a legal audit of every training-data right.
