/// <reference lib="webworker" />
/** Isolated model evaluation, never imported by the production editor. */
import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = {
  wasm: new URL(wasmUrl, self.location.origin).href,
  mjs: new URL(wasmModuleUrl, self.location.origin).href,
};
const MODEL =
  "https://huggingface.co/tidus2102/Real-ESRGAN/resolve/c9a1cd990b587ccf20be2373fad8eb021e24ab01/RealESR-AnimeVideo-v3_x4.onnx";
let session: InferenceSession | undefined;
self.onmessage = async ({ data }: MessageEvent<{ blob: Blob }>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const start = performance.now();
    session ??= await InferenceSession.create(MODEL, { executionProviders: ["wasm"] });
    const loaded = performance.now();
    bitmap = await createImageBitmap(data.blob);
    if (bitmap.width > 256 || bitmap.height > 256) throw Error("Evaluation crop exceeds 256px.");
    const source = new OffscreenCanvas(bitmap.width, bitmap.height),
      ctx = source.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = undefined;
    const pixels = ctx.getImageData(0, 0, source.width, source.height),
      n = source.width * source.height,
      values = new Float32Array(3 * n);
    for (let p = 0; p < n; p++)
      for (let c = 0; c < 3; c++) values[c * n + p] = pixels.data[4 * p + c]! / 255;
    const tensor = new Tensor("float32", values, [1, 3, source.height, source.width]);
    try {
      const outputs = await session.run({ [session.inputNames[0]!]: tensor });
      try {
        const output = outputs[session.outputNames[0]!]!,
          w = Number(output.dims[3]),
          h = Number(output.dims[2]);
        if (w !== source.width * 4 || h !== source.height * 4)
          throw Error("Unexpected candidate output shape.");
        const result = new ImageData(w, h),
          floats = output.data as Float32Array;
        for (let p = 0; p < w * h; p++) {
          for (let c = 0; c < 3; c++) result.data[4 * p + c] = floats[c * w * h + p]! * 255;
          result.data[4 * p + 3] = 255;
        }
        const canvas = new OffscreenCanvas(w, h);
        canvas.getContext("2d")!.putImageData(result, 0, 0);
        self.postMessage({
          blob: await canvas.convertToBlob(),
          modelLoadMs: loaded - start,
          inferenceMs: performance.now() - loaded,
          metadata: session.inputMetadata,
        });
        canvas.width = canvas.height = source.width = source.height = 1;
      } finally {
        Object.values(outputs).forEach((t) => t.dispose());
      }
    } finally {
      tensor.dispose();
    }
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  } finally {
    bitmap?.close();
  }
};
