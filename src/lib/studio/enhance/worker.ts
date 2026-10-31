import { boundedBitmap } from "../image-decode";
import { preflightImage, browserImagePolicy } from "../image-policy";
import { ENHANCE_MODELS, type EnhanceModel } from "./models";
import { enhancementPlan } from "./plan";
import { downloadModelBytes } from "./model-bytes";
/// <reference lib="webworker" />
import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasmUrl from "../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import { cleanPixels, finishPixels, repairInkGaps } from "./filters";
import { validateEnhanceOptions, type EnhanceOptions, type WorkerReply } from "./types";

// Single-thread WASM works without cross-origin isolation or GPU infrastructure.
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = {
  wasm: new URL(wasmUrl, self.location.origin).href,
  mjs: new URL(wasmModuleUrl, self.location.origin).href,
};
let model: { key: EnhanceModel; session: Promise<InferenceSession> } | undefined;
let processing = false;
const send = (message: WorkerReply) => self.postMessage(message);
const progress = (stage: string, done = 0, total = 0) =>
  send({ type: "progress", progress: { stage, done, total } });
async function loadModel(key: EnhanceModel) {
  const spec = ENHANCE_MODELS[key];
  let cache: Cache | undefined;
  try {
    cache = await caches.open(spec.cache);
  } catch {
    /* Optional cache. */
  }
  let bytes: ArrayBuffer | undefined;
  const cached = await cache?.match(spec.url);
  if (cached) {
    try {
      bytes = await downloadModelBytes(cached, spec, () => {});
    } catch {
      await cache?.delete(spec.url);
    }
  }
  if (!bytes) {
    bytes = await downloadModelBytes(
      await fetch(spec.url, { signal: AbortSignal.timeout(180_000) }),
      spec,
      (received, total) =>
        progress(`Downloading AI model · ${(received / 1_048_576).toFixed(1)} MB`, received, total),
    );
    try {
      await cache?.put(spec.url, new Response(bytes));
    } catch {
      /* Quota cannot block processing. */
    }
  }
  progress("Preparing AI engine · this can take a moment");
  try {
    return await InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  } catch (error) {
    await cache?.delete(spec.url);
    throw error;
  }
}
async function sessionFor(key: EnhanceModel) {
  if (model?.key !== key) {
    if (model) await (await model.session).release();
    model = { key, session: loadModel(key) };
  }
  return model.session;
}

async function restoreTile(pixels: ImageData, session: InferenceSession, key: EnhanceModel) {
  // Match Swin2SR's rescale + symmetric pad-to-window preprocessing.
  const w = key === "swin2sr" ? (Math.floor(pixels.width / 8) + 1) * 8 : pixels.width;
  const h = key === "swin2sr" ? (Math.floor(pixels.height / 8) + 1) * 8 : pixels.height;
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
  const tensor = new Tensor("float32", data, [1, 3, h, w]);
  try {
    const outputs = await session.run({ [session.inputNames[0]!]: tensor });
    const result = outputs[session.outputNames[0]!]!;
    try {
      const ow = Number(result.dims[3]),
        oh = Number(result.dims[2]);
      const nativeScale = ENHANCE_MODELS[key].scale;
      if (
        ow !== w * nativeScale ||
        oh !== h * nativeScale ||
        !(result.data instanceof Float32Array) ||
        result.data.length !== 3 * ow * oh
      )
        throw Error("The AI model returned invalid tensor dimensions.");
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
  if (processing) {
    send({ type: "error", error: "Enhancement is already running." });
    return;
  }
  processing = true;
  let bitmap: ImageBitmap | undefined;
  const surfaces = new Set<OffscreenCanvas>();
  const canvas = (w: number, h: number) => {
    const c = new OffscreenCanvas(w, h);
    surfaces.add(c);
    return c;
  };
  try {
    const { blob, options } = event.data;
    validateEnhanceOptions(options);
    const key = options.model ?? "swin2sr",
      spec = ENHANCE_MODELS[key];
    const info = await preflightImage(blob, {
      ...browserImagePolicy(),
      maxPixels: 4_000_000,
      maxSide: 4096,
    });
    enhancementPlan(info.width, info.height, options.scale, key); // BEFORE decode/model/large allocation.
    bitmap = await boundedBitmap(blob, info);
    const size = enhancementPlan(bitmap.width, bitmap.height, options.scale, key);
    progress("Loading verified AI model · first use needs a download");
    const session = await sessionFor(key);
    const input = canvas(bitmap.width, bitmap.height),
      ctx = input.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw Error("Your browser cannot prepare this image.");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = undefined;
    const original = ctx.getImageData(0, 0, input.width, input.height);
    if (options.inkGaps) repairInkGaps(original.data, input.width, input.height);
    cleanPixels(
      original.data,
      input.width,
      input.height,
      Math.max(options.denoise, options.artifacts ? 10 : 0),
    );
    ctx.putImageData(original, 0, 0);
    let source = input,
      output = input,
      done = 0;
    for (let pass = 0; pass < size.passes; pass++) {
      const scale = key === "swin2sr" ? 2 : options.scale;
      output = canvas(source.width * scale, source.height * scale);
      const target = output.getContext("2d")!,
        sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
      const tile = 64,
        overlap = spec.overlap;
      for (let y = 0; y < source.height; y += tile)
        for (let x = 0; x < source.width; x += tile) {
          progress(`Restoring fine detail · pass ${pass + 1}/${size.passes}`, done, size.tiles);
          const left = Math.max(0, x - overlap),
            top = Math.max(0, y - overlap),
            right = Math.min(source.width, x + tile + overlap),
            bottom = Math.min(source.height, y + tile + overlap);
          const rgba = await restoreTile(
            sourceCtx.getImageData(left, top, right - left, bottom - top),
            session,
            key,
          );
          const patch = new OffscreenCanvas(rgba.width, rgba.height);
          try {
            patch.getContext("2d")!.putImageData(rgba, 0, 0);
            const w = Math.min(tile, source.width - x) * scale,
              h = Math.min(tile, source.height - y) * scale;
            if (scale === spec.scale)
              target.drawImage(
                patch,
                (x - left) * scale,
                (y - top) * scale,
                w,
                h,
                x * scale,
                y * scale,
                w,
                h,
              );
            else {
              // Resample the halo too, then clip to the owned core. Never allocate a
              // full-resolution 4x intermediate just to return 1x/2x Fast Anime output.
              target.save();
              target.beginPath();
              target.rect(x * scale, y * scale, w, h);
              target.clip();
              target.imageSmoothingEnabled = true;
              target.imageSmoothingQuality = "high";
              target.drawImage(
                patch,
                left * scale,
                top * scale,
                (right - left) * scale,
                (bottom - top) * scale,
              );
              target.restore();
            }
          } finally {
            patch.width = patch.height = 0;
          }
          done++;
        }
      if (source !== input) {
        source.width = source.height = 0;
        surfaces.delete(source);
      }
      source = output;
    }
    progress("Finishing colors and edges", size.tiles, size.tiles);
    const final =
        output.width === size.width && output.height === size.height
          ? output
          : canvas(size.width, size.height),
      finalCtx = final.getContext("2d", { willReadFrequently: true })!;
    if (final !== output) {
      finalCtx.imageSmoothingEnabled = true;
      finalCtx.imageSmoothingQuality = "high";
      finalCtx.drawImage(output, 0, 0, size.width, size.height);
    }
    const pixels = finalCtx.getImageData(0, 0, size.width, size.height);
    finishPixels(pixels.data, size.width, size.height, options.sharpen, options.color);
    const alpha = canvas(size.width, size.height),
      alphaCtx = alpha.getContext("2d")!;
    alphaCtx.drawImage(input, 0, 0, size.width, size.height);
    const alphaPixels = alphaCtx.getImageData(0, 0, size.width, size.height);
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = alphaPixels.data[i]!;
    finalCtx.putImageData(pixels, 0, 0);
    send({
      type: "result",
      result: {
        blob: await final.convertToBlob({ type: "image/png" }),
        width: size.width,
        height: size.height,
      },
    });
  } catch (error) {
    const old = model;
    model = undefined;
    if (old) await old.session.then((s) => s.release()).catch(() => {});
    send({
      type: "error",
      error: error instanceof Error ? error.message : "Enhancement failed. Original unchanged.",
    });
  } finally {
    bitmap?.close();
    for (const c of surfaces) c.width = c.height = 0;
    processing = false;
  }
};
