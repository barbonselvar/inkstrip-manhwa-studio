/** Immutable, commercially usable model sources; no user pixels are uploaded. */
export const ENHANCE_MODELS = {
  swin2sr: {
    name: "Swin2SR · fidelity",
    scale: 2,
    overlap: 8,
    url: "https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64/resolve/93dfc9089abda257351d3a58d5771e2c1ff69442/onnx/model.onnx",
    bytes: 54428699,
    sha256: "6dde3fe2440543ccae7c40d175609f83c18aeaa3d8456745c4329ef97ae744bd",
    license: "Apache-2.0",
    cache: "inkstrip-ai-swin2sr-v1",
  },
  "realesrgan-anime": {
    name: "Real-ESRGAN · fast anime",
    scale: 4,
    overlap: 20,
    url: "https://huggingface.co/tidus2102/Real-ESRGAN/resolve/c9a1cd990b587ccf20be2373fad8eb021e24ab01/RealESR-AnimeVideo-v3_x4.onnx",
    bytes: 2495473,
    sha256: "00ece3ac21c43ee31459216b5174b2cea0c5325044c5142aeb840f4890e175ff",
    license: "BSD-3-Clause",
    cache: "inkstrip-ai-realesr-anime-v1",
  },
} as const;
export type EnhanceModel = keyof typeof ENHANCE_MODELS;
