/** Real pointer + keyboard interleaving, native downloads and pixels. No document hooks/mocked rendering. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
const f = (masked = false) => {
  const d = fromPanel({ id: "gesture", name: "Gesture transactions", width: 128, height: 96 }),
    l = layer("paint", 128, 96, "paint");
  l.name = "Transaction paint";
  if (masked) {
    l.mask = { enabled: true, selection: { regions: [], inverted: true, feather: 0 }, strokes: [] };
    l.strokes = [
      {
        points: [{ x: 64, y: 48 }],
        size: 24,
        hardness: 1,
        opacity: 1,
        flow: 1,
        color: "#ff0000",
        erase: false,
      },
    ];
  }
  d.layers = [l];
  return d;
};
async function at(p, x, y) {
  return p.locator(".pro-artboard").evaluate(
    (el, { x, y }) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + (x / 128) * r.width, y: r.y + (y / 96) * r.height };
    },
    { x, y },
  );
}
async function begin(p, fx, a, b) {
  await fx.artboardBounds(p);
  const start = await at(p, ...a),
    end = await at(p, ...b);
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  await p.mouse.move(end.x, end.y, { steps: 6 });
}
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    fx = proBrowserFixtures(base, errors),
    source = await fx.start(p);
  await fx.open(p);
  await fx.load(p, f(), source);
  await p.getByRole("button", { name: "Brush tool", exact: true }).click();
  await begin(p, fx, [30, 30], [70, 30]);
  await p.mouse.up();
  await fx.preview(p);
  let n = (await fx.native(p)).value;
  assert.equal(n.document.layers[0].strokes.length, 1);
  await p.getByRole("button", { name: "Brush tool", exact: true }).click();
  await begin(p, fx, [30, 50], [70, 50]);
  await p.keyboard.press("Control+z");
  await p.mouse.up();
  await fx.preview(p);
  n = (await fx.native(p)).value;
  assert.equal(
    n.document.layers[0].strokes.length,
    0,
    "pending stroke must not overwrite a newer Undo result",
  );
  console.log(
    "History interleaving: Undo cancels the pending stale stroke without restoring old document data.",
  );
  await p.keyboard.press("Control+Shift+z");
  await fx.preview(p);
  assert.equal(
    (await fx.native(p)).value.document.layers[0].strokes.length,
    1,
    "Redo restores only the previously committed stroke",
  );
  await p.getByRole("button", { name: "Rectangle selection tool", exact: true }).click();
  await begin(p, fx, [20, 20], [60, 60]);
  await p.keyboard.press("Control+z");
  await p.mouse.up();
  await fx.preview(p);
  n = (await fx.native(p)).value;
  assert.equal(n.document.layers[0].strokes.length, 0);
  assert.equal(
    n.document.selection?.regions.length ?? 0,
    0,
    "stale selection draft is canceled on history change",
  );
  await fx.tab(p, "Layers");
  await p.getByRole("button", { name: "Brush tool", exact: true }).click();
  await begin(p, fx, [20, 20], [60, 40]);
  await p.getByLabel("Layer panel opacity", { exact: true }).fill("65");
  await p.getByLabel("Layer panel opacity", { exact: true }).press("Tab");
  await p.mouse.up();
  await fx.preview(p);
  n = (await fx.native(p)).value;
  assert.equal(n.document.layers[0].opacity, 0.65);
  assert.equal(
    n.document.layers[0].strokes.length,
    0,
    "a concurrent layer edit cannot publish transient artwork",
  );
  await p.locator(".pro-viewport").focus();
  await p.keyboard.press("Control+z");
  await fx.preview(p);
  n = (await fx.native(p)).value;
  assert.equal(n.document.layers[0].opacity, 1, "property change remains one atomic undo step");
  assert.equal(n.document.layers[0].strokes.length, 0);
  await fx.load(p, f(true), source);
  await fx.tab(p, "Properties");
  const section = p.locator("summary").filter({ hasText: /^Layer mask$/ });
  if (!(await section.locator("..").evaluate((e) => e.open))) await section.click();
  await p.getByLabel("Paint layer mask", { exact: true }).check();
  await p.getByRole("button", { name: "Eraser tool", exact: true }).click();
  await begin(p, fx, [64, 48], [70, 48]);
  await p.getByLabel("Paint layer mask", { exact: true }).focus();
  await p.keyboard.press("Space");
  await p.mouse.up();
  await fx.preview(p);
  n = (await fx.native(p)).value;
  assert.equal(
    n.document.layers[0].mask.strokes.length,
    1,
    "pointer-down mask target stays fixed for this stroke",
  );
  assert.equal(
    n.document.layers[0].strokes.length,
    1,
    "mask target switch cannot turn the pending stroke into pixel erasure",
  );
  const image = await fx.raster(p);
  assert.equal(image.pixels[(48 * 128 + 64) * 4 + 3], 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      historyInterleaving: true,
      redo: true,
      staleSelection: true,
      concurrentPropertyEdit: true,
      maskPlaneSnapshot: true,
      native: true,
      pixels: true,
      errors,
      physicalAndroid: false,
    }),
  );
} finally {
  await browser.close();
}
