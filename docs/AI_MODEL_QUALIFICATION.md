# F1 model research and qualification registry

Checked official sources on 2026-10-23. Artifact/retrieved-document hashes and runtime
SPDX manifests are recorded in `benchmarks/phase-f1-model-evidence.json`. Executable
capabilities are code-owned in `src/lib/studio/ai/registry.ts`; remote advertisements
and imported receipts never enable a model. Free weights do not mean free compute.

| Model | Official evidence | Licensing/runtime finding | F1 decision |
|---|---|---|---|
| Existing Swin2SR classical 2× | [code](https://github.com/mv-lab/swin2sr), [code license](https://github.com/mv-lab/swin2sr/blob/main/LICENSE), [base weight card pinned](https://huggingface.co/caidas/swin2SR-classical-sr-x2-64/blob/cee1c923c6a37361c6e5650b65dcf4be821e5d52/README.md), [ONNX conversion pinned](https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64/tree/93dfc9089abda257351d3a58d5771e2c1ff69442) | Apache-2.0 code and base-weight card; ONNX repository explicitly derives from that base but has no separate license file. Runtime ORT Web 1.22.0 MIT, transitive notices enumerated. Graph is 54,428,699 bytes with pinned LFS SHA-256, verified on cached/downloaded bytes before inference. RGB in/out, alpha carried separately; browser WASM, no GPU needed. | Reuse existing actual inference; F1 restoration returns 1× at native coordinates. Technical integrity qualification only, not illustrated identity/anatomy approval. |
| LaMa | [official code and checkpoints](https://github.com/advimman/lama), [license](https://github.com/advimman/lama/blob/main/LICENSE) | Apache-2.0 code; exact checkpoint/data/dependency terms not independently qualified. Masked image → filled image, PyTorch; actual CPU/GPU memory/latency not measured here. | Candidate only; no inference or claimed manga quality. |
| Stable Diffusion 1.5 inpainting | [official current model card](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting) | CreativeML Open RAIL-M weight license has use restrictions; framework license is separate (Diffusers Apache-2.0). Mask/image/prompt → image. Needs checkpoint-specific server/runtime/memory qualification. | No selected/downloaded checkpoint or GPU inference; not a dedicated hands model. |
| GFPGAN | [official project](https://github.com/TencentARC/GFPGAN), [license](https://github.com/TencentARC/GFPGAN/blob/master/LICENSE) | Apache-2.0 with third-party exceptions. Code, exact weight and face detection/alignment dependencies need separate review. Photographic face prior can change illustrated identity. | Not integrated/qualified; no face/hands claims. |
| CodeFormer | [official project/license](https://github.com/sczhou/CodeFormer/blob/master/LICENSE) | S-Lab License 1.0 explicitly permits non-commercial use; commercial users are directed to obtain permission. | Excluded from default/commercial execution. |
| Real-ESRGAN | [official project](https://github.com/xinntao/Real-ESRGAN), [license](https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE) | BSD-3-Clause code. Exact illustration checkpoint/weight/data/dependency qualification and CPU/GPU benchmark still required. Image → super-resolved image. | Candidate only; existing Swin2SR unchanged. |
| SAM 2 | [official project and requirements](https://github.com/facebookresearch/sam2), [license](https://github.com/facebookresearch/sam2/blob/main/LICENSE) | Upstream says Apache-2.0 for code and model checkpoints; optional fonts/assets may use separate licenses. Official PyTorch/CUDA setup is not a browser drop-in. Prompted segmentation, not generative repair. | Exact artifact/runtime/memory/manga mask inference not tested. Existing traditional selections remain the functional fallback. |

No new model weights are committed/distributed in native projects. No candidate
third-party assets, datasets, or model code are bundled. Swin2SR base-card Apache
terms are evidence for using the existing derived weights, not permission to
redistribute/retrain on every upstream dataset. Dataset rights are not independently
re-audited, and extra model/adapter/dependency licenses require separate review.

## Qualification gates for future releases

Pin official repository and weight revision/checksum; record code/weights/dependency
licenses separately, input/output normalization, alpha behavior, limits and hardware.
Execute real inference before enabling a task. Compare rights-cleared held-out manga,
manhwa, character and background images against the unedited source. Protect mask
exteriors exactly where required; record errors, context/tiling seams and output
coordinates. Have a human review identity, line quality, style, anatomy, lighting
and perspective. Do not infer these from PSNR/MAE or from photographic examples.

F1 has a CPU/WASM environment, no provided usable GPU or GPU server. It makes no
GPU VRAM/throughput prediction and no claim about real Android latency. Optional
self-hosting is user-controlled and may incur compute costs; no service is enabled,
provisioned or billed by this work. F2–F5 require explicit user approval.
