import type { Transform, Point } from "./model";
import { projectPixels, sampleDocument } from "./transform-pixels";
export function projectSurface(
  source: OffscreenCanvas,
  t: Transform,
  width: number,
  height: number,
  scale = 1,
  origin?: Point,
) {
  const output = new OffscreenCanvas(width, height),
    image = source.getContext("2d")!.getImageData(0, 0, source.width, source.height),
    pixels = projectPixels(
      image.data,
      source.width,
      source.height,
      t,
      width,
      height,
      scale,
      origin,
    );
  output.getContext("2d")!.putImageData(new ImageData(pixels, width, height), 0, 0);
  return output;
}
export function sampleSurface(
  source: OffscreenCanvas | ImageBitmap,
  target: OffscreenCanvas,
  t: Transform,
  scale: number,
  offset?: Point,
  premapping?: import("./transform").Matrix,
) {
  const scratch = new OffscreenCanvas(source.width, source.height),
    ctx = scratch.getContext("2d")!;
  try {
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, source.width, source.height),
      pixels = sampleDocument(
        image.data,
        source.width,
        source.height,
        t,
        target.width,
        target.height,
        scale,
        offset,
        premapping,
      );
    target.getContext("2d")!.putImageData(new ImageData(pixels, target.width, target.height), 0, 0);
  } finally {
    scratch.width = scratch.height = 1;
  }
}
