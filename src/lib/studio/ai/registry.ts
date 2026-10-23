/** Manifests are code-owned. Imported project metadata never authorizes execution. */
export const SWIN = {
  id: "swin2sr-classical-x2",
  name: "Swin2SR · gentle restoration",
  revision: "93dfc9089abda257351d3a58d5771e2c1ff69442",
  sha256: "6dde3fe2440543ccae7c40d175609f83c18aeaa3d8456745c4329ef97ae744bd",
  bytes: 54_428_699,
  artifact:
    "https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64/resolve/93dfc9089abda257351d3a58d5771e2c1ff69442/onnx/model.onnx",
  repository: "https://github.com/mv-lab/swin2sr",
  codeLicense: "Apache-2.0",
  weightsLicense: "Apache-2.0 (upstream base model card; ONNX derivative)",
  licenseEvidence:
    "https://huggingface.co/caidas/swin2SR-classical-sr-x2-64/blob/cee1c923c6a37361c6e5650b65dcf4be821e5d52/README.md",
  runtime: "ONNX Runtime Web / WASM (MIT)",
  task: "restoration",
  maxPixels: 4_000_000,
  maxSide: 4096,
  parameters: ["denoise", "sharpen", "artifacts", "color"] as const,
  limitation:
    "Neural detail restoration, not generative repair or guaranteed identity preservation. F1 retains document resolution; the existing Chapter Enhance tool offers 2× upscaling.",
} as const;
export const CANDIDATES = [
  {
    id: "lama",
    name: "LaMa inpainting",
    repository: "https://github.com/advimman/lama",
    codeLicense: "Apache-2.0",
    weightsLicense: "Checkpoint/data terms require verification",
    reason: "Unavailable: exact weights and illustrated-art inference have not been qualified.",
  },
  {
    id: "sd-inpaint",
    name: "Stable Diffusion 1.5 inpainting",
    repository: "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting",
    codeLicense: "Diffusers Apache-2.0",
    weightsLicense: "CreativeML Open RAIL-M (use restrictions)",
    reason: "Unavailable: GPU, exact checkpoint/dependencies and manga quality not validated.",
  },
  {
    id: "gfpgan",
    name: "GFPGAN face restoration",
    repository: "https://github.com/TencentARC/GFPGAN",
    codeLicense: "Apache-2.0 with third-party exceptions",
    weightsLicense: "Checkpoint and dependency licenses require verification",
    reason:
      "Unavailable: photographic face prior; illustrated identity fidelity unverified. Not a hands model.",
  },
  {
    id: "codeformer",
    name: "CodeFormer",
    repository: "https://github.com/sczhou/CodeFormer",
    codeLicense: "S-Lab 1.0",
    weightsLicense: "Commercial permission required",
    reason: "Excluded: upstream license restricts commercial use without permission.",
  },
  {
    id: "realesrgan",
    name: "Real-ESRGAN",
    repository: "https://github.com/xinntao/Real-ESRGAN",
    codeLicense: "BSD-3-Clause",
    weightsLicense: "Exact illustration checkpoint not yet qualified",
    reason: "Unavailable: no new checkpoint inference or illustration-quality benchmark in F1.",
  },
  {
    id: "sam2",
    name: "SAM 2 segmentation",
    repository: "https://github.com/facebookresearch/sam2",
    codeLicense: "Apache-2.0",
    weightsLicense: "Apache-2.0 per upstream; exact artifact pending",
    reason:
      "Unavailable: GPU/runtime and mask-quality qualification pending. Existing selection tools remain available.",
  },
] as const;
export function localCapability(environment: { worker: boolean; canvas: boolean; wasm: boolean }) {
  return Object.values(environment).every(Boolean)
    ? { available: true, reason: "Local browser inference; artwork stays on this device." }
    : {
        available: false,
        reason:
          "This browser requires Web Workers, OffscreenCanvas and WebAssembly. Raster editing remains available.",
      };
}
