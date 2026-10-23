import { SWIN } from "../ai/registry";
/// <reference lib="webworker" />
import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasmUrl from "../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import { cleanPixels, finishPixels } from "./filters";
import { enhancementSize, type EnhanceOptions, type WorkerReply } from "./types";

// Versioned public model; only weights are downloaded, never user artwork.
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = {
  wasm: new URL(wasmUrl, self.location.origin).href,
  mjs: new URL(wasmModuleUrl, self.location.origin).href,
};
const MODEL =
  "https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64/resolve/93dfc9089abda257351d3a58d5771e2c1ff69442/onnx/model.onnx";
let model: Promise<InferenceSession> | undefined;
const send = (message: WorkerReply) => self.postMessage(message);
const progress = (stage: string, done = 0, total = 0) =>
  send({ type: "progress", progress: { stage, done, total } });

async function loadModel() {
  let cache: Cache | undefined;
  try {
    cache = await caches.open("inkstrip-ai-swin2sr-v1");
  } catch {
    /* Cache is optional. */
  }
  const cached = await cache?.match(MODEL);
  let bytes: ArrayBuffer;
  if (cached) bytes = await cached.arrayBuffer();
  else {
    const response = await fetch(MODEL, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body)
      throw new Error("Could not download the AI model. Check your connection and try again.");
    const reader = response.body.getReader();
    const total = Number(response.headers.get("content-length")) || 0;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(new Uint8Array(value));
      received += value.byteLength;
      if (received > SWIN.bytes) {
        await reader.cancel();
        throw Error("Model download exceeds its pinned size.");
      }
      progress(`Downloading AI model · ${(received / 1_048_576).toFixed(1)} MB`, received, total);
    }
    bytes = await new Blob(chunks).arrayBuffer();
    try {
      await cache?.put(MODEL, new Response(bytes));
    } catch {
      /* Storage may be full. */
    }
  }
  if (
    bytes.byteLength !== SWIN.bytes ||
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("") !== SWIN.sha256
  ) {
    await cache?.delete(MODEL);
    throw Error(
      "The Swin2SR checkpoint failed integrity verification. Nothing was processed; retry the model download.",
    );
  }
  progress("Preparing AI engine · this can take a moment");
  // ORT supports an explicit binary. Some static preview hosts use octet-stream
  // for .wasm, which makes Emscripten log a failed streaming compile before retry.
  // Use the bundled runtime bytes directly; this changes no model/output pixels.
  if (!env.wasm.wasmBinary) {
    const response = await fetch(new URL(wasmUrl, self.location.origin).href, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw Error("Could not load the bundled AI runtime.");
    const binary = await response.arrayBuffer();
    const magic = new Uint8Array(binary, 0, Math.min(4, binary.byteLength));
    if (
      binary.byteLength > 32_000_000 ||
      magic.length !== 4 ||
      [0, 97, 115, 109].some((n, i) => magic[i] !== n)
    )
      throw Error("The bundled AI runtime is invalid.");
    env.wasm.wasmBinary = binary;
  }
  try {
    return await InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  } catch (error) {
    await cache?.delete(MODEL);
    throw error;
  }
}

async function restoreTile(pixels: ImageData) {
  // Match Swin2SR's rescale + symmetric pad-to-window preprocessing.
  const w = (Math.floor(pixels.width / 8) + 1) * 8;
  const h = (Math.floor(pixels.height / 8) + 1) * 8;
  const data = new Float32Array(3 * w * h);
  const reflect = (n: number, size: number) => {
    if (size === 1) return 0;
    const position = n % (2 * size - 2);
    return position < size ? position : 2 * size - position - 2;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (reflect(y, pixels.height) * pixels.width + reflect(x, pixels.width)) * 4;
      for (let c = 0; c < 3; c++) data[c * w * h + y * w + x] = pixels.data[p + c]! / 255;
    }
  const session = await model!;
  const tensor = new Tensor("float32", data, [1, 3, h, w]);
  try {
    const outputs = await session.run({ [session.inputNames[0]!]: tensor });
    const result = outputs[session.outputNames[0]!]!;
    try {
      const ow = Number(result.dims[3]),
        oh = Number(result.dims[2]);
      const rgba = new Uint8ClampedArray(ow * oh * 4);
      const values = result.data as Float32Array;
      for (let i = 0; i < ow * oh; i++) {
        for (let c = 0; c < 3; c++) rgba[i * 4 + c] = values[c * ow * oh + i]! * 255;
        rgba[i * 4 + 3] = 255;
      }
      return new ImageData(rgba, ow, oh);
    } finally {
      Object.values(outputs).forEach((output) => output.dispose());
    }
  } finally {
    tensor.dispose();
  }
}

self.onmessage = async (event: MessageEvent<{ blob: Blob; options: EnhanceOptions }>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const { blob, options } = event.data;
    bitmap = await createImageBitmap(blob);
    const size = enhancementSize(bitmap.width, bitmap.height, options.scale);
    progress("Loading AI model · first download may take a few minutes");
    model ??= loadModel();
    await model;
    const input = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = input.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Your browser cannot prepare this image.");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = undefined;
    const original = ctx.getImageData(0, 0, input.width, input.height);
    cleanPixels(
      original.data,
      input.width,
      input.height,
      Math.max(options.denoise, options.artifacts ? 10 : 0),
    );
    ctx.putImageData(original, 0, 0);
    const output = new OffscreenCanvas(input.width * 2, input.height * 2);
    const target = output.getContext("2d");
    if (!target) throw new Error("Your browser cannot draw the enhanced image.");
    // Overlapped tiles bound Android memory. Crop the overlap, never the artwork.
    const tile = 64,
      overlap = 8;
    const total = Math.ceil(input.width / tile) * Math.ceil(input.height / tile);
    let done = 0;
    for (let y = 0; y < input.height; y += tile)
      for (let x = 0; x < input.width; x += tile) {
        progress("Restoring fine detail", done, total);
        const left = Math.max(0, x - overlap),
          top = Math.max(0, y - overlap);
        const right = Math.min(input.width, x + tile + overlap),
          bottom = Math.min(input.height, y + tile + overlap);
        const pixels = ctx.getImageData(left, top, right - left, bottom - top);
        const rgba = await restoreTile(pixels);
        const patch = new OffscreenCanvas(rgba.width, rgba.height);
        patch.getContext("2d")!.putImageData(rgba, 0, 0);
        const w = Math.min(tile, input.width - x) * 2,
          h = Math.min(tile, input.height - y) * 2;
        target.drawImage(patch, (x - left) * 2, (y - top) * 2, w, h, x * 2, y * 2, w, h);
        patch.width = patch.height = 0;
        done++;
      }
    progress("Finishing colors and edges", total, total);
    const final = new OffscreenCanvas(size.width, size.height);
    const finalCtx = final.getContext("2d", { willReadFrequently: true })!;
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = "high";
    finalCtx.drawImage(output, 0, 0, size.width, size.height);
    const pixels = finalCtx.getImageData(0, 0, size.width, size.height);
    finishPixels(pixels.data, size.width, size.height, options.sharpen, options.color);
    // Preserve source transparency, which the RGB restoration model does not infer.
    const alpha = new OffscreenCanvas(size.width, size.height);
    const alphaCtx = alpha.getContext("2d")!;
    alphaCtx.drawImage(input, 0, 0, size.width, size.height);
    const alphaPixels = alphaCtx.getImageData(0, 0, size.width, size.height);
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = alphaPixels.data[i]!;
    finalCtx.putImageData(pixels, 0, 0);
    const resultBlob = await final.convertToBlob({ type: "image/png" });
    input.width = output.width = alpha.width = final.width = 0;
    send({ type: "result", result: { blob: resultBlob, ...size } });
  } catch (error) {
    model = undefined;
    send({
      type: "error",
      error: error instanceof Error ? error.message : "Enhancement failed. Original unchanged.",
    });
  } finally {
    bitmap?.close();
  }
};
