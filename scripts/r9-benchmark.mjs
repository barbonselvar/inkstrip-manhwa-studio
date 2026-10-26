/** R9 vector performance on a long vertical manhwa page: snapping index build and
 * per-pointer-move snapping, path operations on large paths, ruler ticks and document
 * validation. Node timing on the current machine; not a device guarantee. */
import { performance } from "node:perf_hooks";
import { fromPanel, layer, validateDocument } from "../src/lib/studio/pro/model.ts";
import { buildSnapIndex, snapGeometry } from "../src/lib/studio/pro/precision.ts";
import {
  joinPaths,
  simplifyPath,
  smoothPath,
  splitPathAt,
} from "../src/lib/studio/pro/path-ops.ts";
import { rulerMap, rulerTicks } from "../src/lib/studio/pro/rulers.ts";
import { DEFAULT_LAYOUT } from "../src/lib/studio/pro/artboards.ts";

const W = 800,
  H = 16000,
  d = fromPanel({ id: "bench", name: "Long page", width: W, height: H });
d.version = 2;
d.layout = {
  ...structuredClone(DEFAULT_LAYOUT),
  guides: Array.from({ length: 64 }, (_, i) => ({
    id: `g${i}`,
    axis: i % 2 ? "x" : "y",
    position: i % 2 ? (i * 37) % W : (i * 250) % H,
    locked: false,
  })),
};
const kinds = ["rectangle", "star", "polygon", "ellipse"];
for (let i = 0; i < 40; i++) {
  const l = layer("shape", 120, 90);
  l.shape = kinds[i % 4];
  if (l.shape === "rectangle") l.shapeOptions = { radius: 12 };
  if (l.shape === "star") l.shapeOptions = { sides: 7, inner: 0.45 };
  l.transform = { ...l.transform, x: (i * 97) % (W - 120), y: i * 395 };
  d.layers.push(l);
}
// A traced-style path with 900 anchors (stroke of a long speed-line).
const big = layer("shape", W, H);
Object.assign(big, {
  shape: "path",
  closed: false,
  fill: "transparent",
  anchors: Array.from({ length: 900 }, (_, i) => ({
    x: 400 + 300 * Math.sin(i / 9),
    y: (i / 899) * (H - 10),
  })),
});
const tail = layer("shape", W, H);
Object.assign(tail, {
  shape: "path",
  closed: false,
  fill: "transparent",
  anchors: [
    { x: big.anchors.at(-1).x, y: big.anchors.at(-1).y },
    { x: 100, y: H - 5 },
  ],
});
d.layers.push(big, tail);

const time = (label, runs, fn) => {
  fn();
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const ms = (performance.now() - start) / runs;
  return [label, Math.round(ms * 1000) / 1000];
};
const index = buildSnapIndex(d, []);
const results = [
  time("validateDocument (42 vector layers, 64 guides)", 20, () => validateDocument(d)),
  time("buildSnapIndex (pointer-down)", 10, () => buildSnapIndex(d, [])),
  time("snapGeometry per pointer move", 2000, () =>
    snapGeometry(d, index, { x: 397, y: 11994, width: 120, height: 90 }, 0.04),
  ),
  time("smoothPath (900 anchors)", 10, () => smoothPath(d, big.id)),
  time("splitPathAt (900 anchors)", 10, () => splitPathAt(d, big.id, 450)),
  time("joinPaths (900 + 2 anchors)", 10, () => joinPaths(d, big.id, tail.id)),
  time("simplifyPath (900 anchors, 2 px)", 1, () => simplifyPath(d, big.id, 2)),
  time("rulerTicks (both rulers, 16000 px page)", 2000, () => {
    const frame = { x: 0, y: 0, width: W, height: H },
      view = { zoom: 1, x: 0, y: 0, rotation: 0 };
    for (const edge of ["top", "left"]) {
      const m = rulerMap(edge, { width: 1200, height: 800 }, frame, 0.03, view);
      rulerTicks(m, edge === "top" ? 1200 : 800, edge === "top" ? W : H, "px");
    }
  }),
];
const simplified = simplifyPath(d, big.id, 2);
console.log(
  JSON.stringify(
    {
      page: `${W}×${H}`,
      node: process.version,
      milliseconds: Object.fromEntries(results),
      simplifyRemoved: simplified.removed,
    },
    null,
    2,
  ),
);
