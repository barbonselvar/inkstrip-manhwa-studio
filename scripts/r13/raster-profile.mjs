/** R13: CPU-profile one brush stroke (+ autosave) on a heavy document and
 * aggregate self time by function, to attribute main-thread cost. */
import { chromium } from "playwright";
import { fromPanel, layer } from "../../src/lib/studio/pro/model.ts";
import { DAB_DEFAULTS } from "../../src/lib/studio/pro/brush-dynamics.ts";
import { proBrowserFixtures } from "../pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const fx = proBrowserFixtures(base, []);
const d = fromPanel({ id: "bench", name: "Bench", width: 128, height: 96 });
const paint = layer("paint", 128, 96, "Paint");
paint.strokes = Array.from({ length: 900 }, (_, i) => ({
  points: Array.from({ length: 100 }, (_, k) => ({
    x: 4 + ((k * 0.8) % 120),
    y: 4 + ((i * 0.37) % 88),
  })),
  size: 3,
  hardness: 0.8,
  opacity: 0.4,
  flow: 0.5,
  color: "#a4efd6",
  erase: false,
  dynamics: { ...DAB_DEFAULTS },
  seed: i + 1,
}));
d.layers.push(paint);
const p = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
p.setDefaultTimeout(120000);
const source = await fx.start(p);
await fx.open(p);
await fx.load(p, d, source);
await p.waitForTimeout(2000);
await p.getByRole("button", { name: "Brush tool", exact: true }).click();
const cdp = await p.context().newCDPSession(p);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
const box = await fx.artboardBounds(p);
await p.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 12 });
await p.mouse.up();
await p.waitForTimeout(2000);
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const n = byId.get(id),
    f = n.callFrame;
  const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop().split("?")[0]}:${f.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
});
const rows = [...self]
  .filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)"))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 18);
for (const [k, ms] of rows) console.log(ms.toFixed(1).padStart(8), "ms ", k);
await browser.close();
