import type { Layer } from "./model.ts";
import { blendPixel } from "./blend.ts";
/** Source-atop blending: a clipping stack can change color, never its base alpha.
 * Base opacity/blend are applied once when the completed stack meets its backdrop.
 */
export function blendClippedPixels(
  base: Uint8ClampedArray,
  source: Uint8ClampedArray,
  opacity: number,
  blend: Layer["blend"],
) {
  if (base.length !== source.length || base.length % 4)
    throw new Error("Clipping surfaces must have matching dimensions.");
  const mixed = new Float64Array(3);
  for (let i = 0; i < base.length; i += 4) {
    if (!base[i + 3]) continue;
    const alpha = (source[i + 3]! / 255) * opacity;
    if (!alpha) continue;
    blendPixel(blend, base, source, i, mixed);
    for (let c = 0; c < 3; c++) {
      const b = base[i + c]! / 255;
      base[i + c] = Math.round((b * (1 - alpha) + mixed[c]! * alpha) * 255);
    }
  }
  return base;
}
