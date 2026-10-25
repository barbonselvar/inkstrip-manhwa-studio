import { gradientSampler, GRADIENT_PRESETS, validateStops, type GradientStop } from "./color.ts";
export type Gradient = {
  kind: "linear" | "radial";
  angle: number;
  scale: number;
  center: { x: number; y: number };
  stops: GradientStop[];
  /** Radial gradients fill the layer box as an ellipse unless "circle" (Raster Gradient
   * tool). Omitted in older documents, which keep the elliptical shape. */
  radialShape?: "ellipse" | "circle";
};
export const defaultGradient = (): Gradient => ({
  kind: "linear",
  angle: 0,
  scale: 1,
  center: { x: 0.5, y: 0.5 },
  stops: structuredClone(GRADIENT_PRESETS.Grayscale!),
});
export function validateGradient(g: Gradient) {
  const n = (v: unknown, a: number, b: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
  if (
    !g ||
    !["linear", "radial"].includes(g.kind) ||
    !n(g.angle, -360, 360) ||
    !n(g.scale, 0.01, 10) ||
    !g.center ||
    !n(g.center.x, -2, 3) ||
    !n(g.center.y, -2, 3) ||
    (g.radialShape !== undefined && !["ellipse", "circle"].includes(g.radialShape))
  )
    throw new Error("Invalid gradient geometry.");
  validateStops(g.stops);
}
export function gradientField(g: Gradient, width: number, height: number) {
  const rad = (g.angle * Math.PI) / 180,
    c = Math.cos(rad),
    s = Math.sin(rad),
    span = Math.abs(width * c) + Math.abs(height * s),
    sample = gradientSampler(g.stops);
  return (x: number, y: number) => {
    const dx = x - g.center.x * width,
      dy = y - g.center.y * height,
      u = dx * c + dy * s,
      v = -dx * s + dy * c;
    return sample(
      g.kind === "linear"
        ? 0.5 + u / (span * g.scale)
        : Math.hypot(u / (width / 2), v / ((g.radialShape === "circle" ? width : height) / 2)) /
            g.scale,
    );
  };
}
export function gradientPixels(width: number, height: number, g: Gradient) {
  const out = new Uint8ClampedArray(width * height * 4),
    sample = gradientField(g, width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const rgba = sample(x + 0.5, y + 0.5),
        i = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = rgba[c]! * 255;
    }
  return out;
}
