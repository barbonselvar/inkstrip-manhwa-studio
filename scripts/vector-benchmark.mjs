/** Reproducible geometry benchmark; timings are observations, not speed guarantees. */
import { performance } from "node:perf_hooks";
import os from "node:os";
import { fromPanel, layer, validateDocument } from "../src/lib/studio/pro/model.ts";
import { buildSnapIndex, snapGeometry } from "../src/lib/studio/pro/precision.ts";
import {
  defaultTextPath,
  measureTextPath,
  layoutPathText,
} from "../src/lib/studio/pro/text-path.ts";
const d = fromPanel({ id: "benchmark", name: "Benchmark", width: 2000, height: 2000 });
d.layers[0].visible = false;
for (let n = 0; n < 40; n++) {
  const l = layer("shape", 1000, 1000, `path-${n}`);
  l.shape = "path";
  l.closed = true;
  l.anchors = Array.from({ length: 1000 }, (_, i) => ({
    x: 500 + 400 * Math.cos((i * Math.PI) / 500),
    y: 500 + 400 * Math.sin((i * Math.PI) / 500),
  }));
  l.transform.x = (n % 8) * 120;
  l.transform.y = Math.floor(n / 8) * 120;
  d.layers.push(l);
}
d.artboards = Array.from({ length: 32 }, (_, i) => ({
  id: `board-${i}`,
  name: `Board ${i + 1}`,
  x: (i % 8) * 240,
  y: Math.floor(i / 8) * 400,
  width: 240,
  height: 400,
  background: "transparent",
}));
validateDocument(d);
function run(name, count, fn) {
  fn(0);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    fn(i);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    name,
    iterations: count,
    medianMs: +samples[Math.floor(count / 2)].toFixed(3),
    p95Ms: +samples[Math.min(count - 1, Math.floor(count * 0.95))].toFixed(3),
  };
}
const index = buildSnapIndex(d),
  t = layer("text", 1000, 200, "text");
t.shape = "path";
t.closed = false;
t.textPath = defaultTextPath();
t.text = "Editable curved text ".repeat(20);
t.anchors = Array.from({ length: 128 }, (_, i) => ({
  x: i * 8,
  y: 100 + Math.sin(i * 0.2) * 20,
  outgoing: { x: i * 8 + 2, y: 100 + Math.sin(i * 0.2) * 20 },
}));
const results = [
  run("validate 40,000 anchors / 32 artboards", 30, () => validateDocument(d)),
  run("build snap index 40,000 anchors / 32 artboards", 15, () => buildSnapIndex(d)),
  run("cached snap lookup", 1000, (i) =>
    snapGeometry(d, index, { x: i % 1000, y: i % 500, width: 80, height: 80 }, 2),
  ),
  run("cached anchor snapping across 40,000 anchor candidates",1000,(i)=>snapGeometry(d,index,{x:i%1000,y:i%500,width:0,height:0},2,true)),
  run("cold adaptive text baseline 128 cubic anchors", 10, () =>
    measureTextPath({ ...t, anchors: structuredClone(t.anchors) }),
  ),
  run("cached text arc lookup + 420 glyph layout", 100, () => layoutPathText(t, () => 8)),
];
console.log(
  JSON.stringify(
    {
      node: process.version,
      cpu: os.cpus()[0]?.model,
      platform: process.platform,
      document: { paths: 40, anchors: 40000, artboards: 32, width: 2000, height: 2000 },
      results,
    },
    null,
    2,
  ),
);
