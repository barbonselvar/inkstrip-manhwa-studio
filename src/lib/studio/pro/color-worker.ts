/// <reference lib="webworker" />
import { preflightImage, imagePolicy } from "../image-policy";
import {
  COLOR_MAX_AREA,
  histogram,
  processColor,
  validateColorWork,
  type ColorOperation,
} from "./color-engine";
import { selectionCanvas } from "./render";
import type { Selection } from "./model";
self.onmessage = async ({
  data,
}: {
  data: { source: Blob; operation: ColorOperation; selection?: Selection; maxArea: number };
}) => {
  let bitmap: ImageBitmap | undefined,
    canvas: OffscreenCanvas | undefined,
    mask: OffscreenCanvas | undefined;
  try {
    await preflightImage(data.source, {
      ...imagePolicy(data.maxArea <= COLOR_MAX_AREA),
      maxPixels: Math.min(COLOR_MAX_AREA, data.maxArea),
      maxSide: 16384,
    });
    bitmap = await createImageBitmap(data.source);
    const { width, height } = bitmap;
    validateColorWork(width, height, data.operation);
    if (width * height > data.maxArea)
      throw Error("Color source exceeds this device’s memory budget.");
    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = undefined;
    const image = ctx.getImageData(0, 0, width, height),
      sourceHistogram = histogram(image.data);
    let coverage: Uint8ClampedArray | undefined;
    if (data.selection) {
      mask = selectionCanvas(data.selection, width, height);
      const rgba = mask.getContext("2d")!.getImageData(0, 0, width, height).data;
      coverage = new Uint8ClampedArray(width * height);
      for (let i = 0; i < coverage.length; i++) coverage[i] = rgba[i * 4 + 3]!;
      mask.width = mask.height = 1;
    }
    const started = performance.now();
    image.data.set(processColor(image.data, width, height, data.operation, coverage));
    const milliseconds = performance.now() - started;
    ctx.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    // The UI displays this encoded PNG, matching Apply/export quantization.
    self.postMessage({ blob, histogram: sourceHistogram, milliseconds });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 1;
    if (mask) mask.width = mask.height = 1;
  }
};
