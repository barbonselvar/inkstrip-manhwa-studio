/// <reference lib="webworker" />
/** Research only: this 208MB graph is never loaded by the production editor. */
import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import { downloadModelBytes } from "../../src/lib/studio/enhance/model-bytes";
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.wasmPaths = {
  wasm: new URL(wasmUrl, self.location.origin).href,
  mjs: new URL(wasmModuleUrl, self.location.origin).href,
};
self.onmessage = async ({ data }: MessageEvent<{ blob: Blob }>) => {
  let session: InferenceSession | undefined, bitmap: ImageBitmap | undefined;
  try {
    const start = performance.now(),
      url =
        "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx";
    const bytes = await downloadModelBytes(
      await fetch(url, { signal: AbortSignal.timeout(120000) }),
      {
        bytes: 208044816,
        sha256: "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
      },
      () => {},
    );
    session = await InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    self.postMessage({
      stage: "loaded",
      ms: performance.now() - start,
      inputs: session.inputMetadata,
      outputs: session.outputMetadata,
    });
    bitmap = await createImageBitmap(data.blob);
    const canvas = new OffscreenCanvas(512, 512),
      ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, 512, 512);
    bitmap.close();
    bitmap = undefined;
    const pixels = ctx.getImageData(0, 0, 512, 512),
      n = 512 * 512,
      values = new Float32Array(3 * n),
      mask = new Float32Array(n);
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const p = y * 512 + x;
        mask[p] = x >= 210 && x < 302 && y >= 220 && y < 280 ? 1 : 0;
        for (let c = 0; c < 3; c++) values[c * n + p] = mask[p] ? 1 : pixels.data[4 * p + c]! / 255;
      }
    const imageTensor = new Tensor("float32", values, [1, 3, 512, 512]),
      maskTensor = new Tensor("float32", mask, [1, 1, 512, 512]),
      begin = performance.now();
    try {
      const outputs = await session.run({ image: imageTensor, mask: maskTensor });
      try {
        const output = outputs[session.outputNames[0]!]!,
          data = output.data as Float32Array;
        let min = Infinity,
          max = -Infinity;
        for (const v of data) {
          if (!Number.isFinite(v)) throw Error("Non-finite LaMa output");
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
        const image = new ImageData(512, 512);
        for (let p = 0; p < n; p++) {
          for (let c = 0; c < 3; c++)
            image.data[p * 4 + c] = mask[p] ? data[c * n + p]! : pixels.data[p * 4 + c]!;
          image.data[p * 4 + 3] = pixels.data[p * 4 + 3]!;
        }
        ctx.putImageData(image, 0, 0);
        self.postMessage({
          stage: "result",
          inferenceMs: performance.now() - begin,
          totalMs: performance.now() - start,
          type: output.type,
          dims: output.dims,
          min,
          max,
          blob: await canvas.convertToBlob(),
        });
      } finally {
        Object.values(outputs).forEach((t) => t.dispose());
      }
    } finally {
      imageTensor.dispose();
      maskTensor.dispose();
      canvas.width = canvas.height = 1;
    }
  } catch (e) {
    self.postMessage({ stage: "error", error: (e as Error).message });
  } finally {
    bitmap?.close();
    await session?.release();
  }
};
