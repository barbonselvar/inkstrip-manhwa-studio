import { processColor, histogram, type Channel } from "./color-engine.ts";
import { type AdjustmentOperation, validateAdjustmentLayer } from "./adjustment-schema.ts";
import { blendClippedPixels } from "./clipping.ts";
import type { BlendMode } from "./blend.ts";
export const ADJUSTMENT_TILE_SIDE = 512;
export type ColorHistogram = Record<Channel, number[]>;
export function emptyHistogram(): ColorHistogram {
  return {
    rgb: Array(256).fill(0),
    red: Array(256).fill(0),
    green: Array(256).fill(0),
    blue: Array(256).fill(0),
  };
}
type Plane = Pick<OffscreenCanvasRenderingContext2D, "getImageData" | "putImageData">;
/** Point-only operations: bounded RGBA tiles, no halo and no resampling of source artwork. */
export async function applyAdjustmentTiles(
  target: Plane,
  coverage: Pick<Plane, "getImageData">,
  width: number,
  height: number,
  operation: AdjustmentOperation,
  opacity: number,
  blend: BlendMode,
  checkpoint: () => Promise<void>,
) {
  validateAdjustmentLayer({ version: 1, operation });
  for (let y = 0; y < height; y += ADJUSTMENT_TILE_SIDE)
    for (let x = 0; x < width; x += ADJUSTMENT_TILE_SIDE) {
      await checkpoint();
      const w = Math.min(ADJUSTMENT_TILE_SIDE, width - x),
        h = Math.min(ADJUSTMENT_TILE_SIDE, height - y),
        image = target.getImageData(x, y, w, h),
        filtered = processColor(image.data, w, h, operation),
        mask = coverage.getImageData(x, y, w, h).data;
      for (let i = 0; i < filtered.length; i += 4)
        filtered[i + 3] = image.data[i + 3] ? mask[i + 3]! : 0;
      image.data.set(blendClippedPixels(image.data, filtered, opacity, blend));
      target.putImageData(image, x, y);
    }
}
export async function histogramTiles(
  target: Pick<Plane, "getImageData">,
  width: number,
  height: number,
  checkpoint: () => Promise<void>,
) {
  const result = emptyHistogram();
  for (let y = 0; y < height; y += ADJUSTMENT_TILE_SIDE)
    for (let x = 0; x < width; x += ADJUSTMENT_TILE_SIDE) {
      await checkpoint();
      const part = histogram(
        target.getImageData(
          x,
          y,
          Math.min(ADJUSTMENT_TILE_SIDE, width - x),
          Math.min(ADJUSTMENT_TILE_SIDE, height - y),
        ).data,
      );
      for (const c of ["rgb", "red", "green", "blue"] as const)
        for (let i = 0; i < 256; i++) result[c][i]! += part[c][i]!;
    }
  return result;
}
