import { fullCrop, outputSize } from "./geometry";
import type { ProDocument } from "./model";
import { resample } from "./resample";
/** Consume a full-canvas composite only for final output; selections/repair/merges use source space. */
export function renderOutput(
  source: OffscreenCanvas,
  d: ProDocument,
  maxArea: number,
  jpeg = false,
) {
  const c = d.crop ?? fullCrop(d),
    size = outputSize(d);
  let output = source;
  try {
    if (c.width * c.height > maxArea || size.width * size.height > maxArea)
      throw new Error(
        "Crop or output image exceeds this device’s memory budget. No resolution was reduced.",
      );
    if (d.crop) {
      output = new OffscreenCanvas(c.width, c.height);
      const ctx = output.getContext("2d")!;
      ctx.imageSmoothingEnabled = d.imageSize?.resampling !== "nearest";
      ctx.imageSmoothingQuality = "high";
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((-c.rotation * Math.PI) / 180);
      ctx.translate(-c.x - c.width / 2, -c.y - c.height / 2);
      ctx.drawImage(source, 0, 0);
      ctx.resetTransform();
      source.width = source.height = 1;
    }
    if (output.width !== size.width || output.height !== size.height) {
      const pixels = output.getContext("2d")!.getImageData(0, 0, output.width, output.height),
        sampled = resample(
          pixels.data,
          output.width,
          output.height,
          size.width,
          size.height,
          d.imageSize?.resampling ?? "bicubic",
        );
      output.width = size.width;
      output.height = size.height;
      output.getContext("2d")!.putImageData(new ImageData(sampled, size.width, size.height), 0, 0);
    }
    if (jpeg) {
      const ctx = output.getContext("2d")!;
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, output.width, output.height);
      ctx.globalCompositeOperation = "source-over";
    }
    return output;
  } catch (e) {
    output.width = output.height = source.width = source.height = 1;
    throw e;
  }
}
