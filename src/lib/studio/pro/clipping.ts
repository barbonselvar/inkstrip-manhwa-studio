import type { Layer } from "./model.ts";
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
  for (let i = 0; i < base.length; i += 4) {
    if (!base[i + 3]) continue;
    const alpha = (source[i + 3]! / 255) * opacity;
    if (!alpha) continue;
    for (let c = 0; c < 3; c++) {
      const b = base[i + c]! / 255,
        s = source[i + c]! / 255;
      const color =
        blend === "multiply"
          ? b * s
          : blend === "screen"
            ? b + s - b * s
            : blend === "overlay"
              ? b <= 0.5
                ? 2 * b * s
                : 1 - 2 * (1 - b) * (1 - s)
              : blend === "darken"
                ? Math.min(b, s)
                : blend === "lighten"
                  ? Math.max(b, s)
                  : s;
      base[i + c] = Math.round((b * (1 - alpha) + color * alpha) * 255);
    }
  }
  return base;
}
