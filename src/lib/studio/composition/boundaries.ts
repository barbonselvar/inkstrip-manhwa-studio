import type { Fade } from "./model.ts";
export const BOUNDARY_SHAPES = [
  "Straight",
  "Wave",
  "Curved",
  "Zigzag",
  "Organic",
  "Diagonal",
  "Elliptical",
  "Bezier",
  "Freehand",
] as const;
export type Boundary = {
  shape: (typeof BOUNDARY_SHAPES)[number];
  amplitude: number;
  frequency: number;
  direction: number;
  placement: "Top" | "Bottom" | "Both";
  points: { x: number; y: number }[];
};
export const boundary = (shape: Boundary["shape"] = "Wave"): Boundary => ({
  shape,
  amplitude: 100,
  frequency: 2,
  direction: 1,
  placement: "Bottom",
  points: [
    { x: 0, y: 0.5 },
    { x: 0.3, y: 0 },
    { x: 0.7, y: 1 },
    { x: 1, y: 0.5 },
  ],
});
const caches = new WeakMap<Boundary, Float64Array>();
export function boundaryOffset(b: Boundary, u: number): number {
  u = Math.max(0, Math.min(1, u));
  let v = 0;
  switch (b.shape) {
    case "Straight":
      return 0;
    case "Wave":
      v = (1 + Math.sin(u * Math.PI * 2 * b.frequency)) / 2;
      break;
    case "Curved":
      v = Math.pow(Math.sin(u * Math.PI), 2);
      break;
    case "Zigzag":
      v = Math.abs(((u * b.frequency) % 1) * 2 - 1);
      break;
    case "Organic":
      v =
        0.5 +
        0.23 * Math.sin(u * 13 * b.frequency) +
        0.15 * Math.cos(u * 7 * b.frequency) +
        0.1 * Math.sin(u * 31);
      break;
    case "Diagonal":
      v = u;
      break;
    case "Elliptical":
      v = Math.sqrt(Math.max(0, 1 - Math.pow(u * 2 - 1, 2)));
      break;
    default: {
      let samples = caches.get(b);
      if (!samples) {
        samples = new Float64Array(1025);
        let points = b.points;
        if (b.shape === "Bezier") {
          const [a, c, d, z] = points;
          points = Array.from({ length: 257 }, (_, i) => {
            const t = i / 256,
              s = 1 - t;
            return {
              x: s * s * s * a.x + 3 * s * s * t * c.x + 3 * s * t * t * d.x + t * t * t * z.x,
              y: s * s * s * a.y + 3 * s * s * t * c.y + 3 * s * t * t * d.y + t * t * t * z.y,
            };
          });
        }
        points = [...points].sort((a, b) => a.x - b.x);
        let j = 1;
        for (let i = 0; i <= 1024; i++) {
          const x = i / 1024;
          while (j < points.length - 1 && points[j].x < x) j++;
          const a = points[j - 1],
            z = points[j];
          samples[i] =
            x <= points[0].x
              ? points[0].y
              : x >= points.at(-1)!.x
                ? points.at(-1)!.y
                : a.y +
                  (z.y - a.y) * Math.max(0, Math.min(1, (x - a.x) / Math.max(0.00001, z.x - a.x)));
        }
        caches.set(b, samples);
      }
      const n = u * 1024,
        i = Math.floor(n);
      v = samples[i] + (samples[Math.min(1024, i + 1)] - samples[i]) * (n - i);
    }
  }
  return b.amplitude * (b.direction < 0 ? 1 - v : v);
}
export function shapedCoverage(f: Fade, x: number, y: number, w: number, h: number) {
  const b = f.boundary!;
  const offset = boundaryOffset(b, x / w),
    length = f.length + f.feather;
  const top = 1 - (y - offset - f.start) / length,
    bottom = 1 - (h - y - offset - f.start) / length;
  return Math.max(
    0,
    Math.min(
      1,
      b.placement === "Top" ? top : b.placement === "Bottom" ? bottom : Math.max(top, bottom),
    ),
  );
}
