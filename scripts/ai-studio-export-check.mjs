/** Synthetic solid-alpha AI layer tests real compositing and codec fidelity, not model quality. */
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { SWIN } from "../src/lib/studio/ai/registry.ts";
const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const p = await b.newPage(),
    f = proBrowserFixtures(base, []);
  await f.start(p);
  await f.open(p);
  const blobs = await p.evaluate(() =>
    ["rgba(80,100,120,0.5)", "rgba(200,40,80,0.5)"].map((color) => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 96;
      const x = c.getContext("2d");
      x.fillStyle = color;
      x.fillRect(0, 0, 128, 96);
      return c.toDataURL().split(",")[1];
    }),
  );
  const d = fromPanel({ id: "test", name: "Alpha AI", width: 128, height: 96 }),
    l = layer("raster", 128, 96);
  l.assetId = "result";
  l.ai = {
    version: 1,
    task: "restoration",
    composite: "preserve-alpha",
    modelId: SWIN.id,
    modelRevision: SWIN.revision,
    weightsSha256: SWIN.sha256,
    backend: "browser-wasm",
    sourceAssetId: "snapshot",
    sourceWidth: 128,
    sourceHeight: 96,
    sourceDocumentSha256: "a".repeat(64),
    region: { x: 0, y: 0, width: 128, height: 96 },
    settings: { denoise: 0, sharpen: 0, color: false, artifacts: false },
    createdAt: 0,
    elapsedMs: 1,
  };
  d.layers.push(l);
  await f.load(p, d, blobs[0], {
    source: { mime: "image/png", data: blobs[0] },
    snapshot: { mime: "image/png", data: blobs[0] },
    result: { mime: "image/png", data: blobs[1] },
  });
  const png = await f.raster(p),
    jpeg = await f.raster(p, "image/jpeg");
  const a = png.pixels.slice(0, 4),
    actual = jpeg.pixels.slice(0, 4),
    expected = a.slice(0, 3).map((c) => Math.round((c * a[3]) / 255 + 255 * (1 - a[3] / 255)));
  assert.ok(
    Math.max(...expected.map((n, i) => Math.abs(n - actual[i]))) <= 3,
    "JPEG must flatten the composed PNG colors, within codec rounding",
  );
  const webp = await f.raster(p, "image/webp");
  f.same(webp, png, 4);
  const assets = {
      source: { mime: "image/png", data: blobs[0] },
      snapshot: { mime: "image/png", data: blobs[0] },
      result: { mime: "image/png", data: blobs[1] },
    },
    pixel = (image, x = 0, y = 0) =>
      image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
    near = (actual, expected, tolerance = 2) =>
      actual.forEach((v, i) =>
        assert.ok(Math.abs(v - expected[i]) <= tolerance, `${actual} differs from ${expected}`),
      );
  let changed = structuredClone(d);
  changed.layers[1].visible = false;
  await f.load(p, changed, blobs[0], assets);
  const basePixels = await f.raster(p),
    original = pixel(basePixels);
  assert.equal(original[3], 128);
  changed = structuredClone(d);
  changed.layers[1].opacity = 0.5;
  await f.load(p, changed, blobs[0], assets);
  const faded = pixel(await f.raster(p));
  near(
    faded,
    original.map((v, i) => (i === 3 ? v : Math.round(v * 0.75 + [200, 40, 80][i] * 0.25))),
  );
  changed = structuredClone(d);
  changed.layers[1].blend = "multiply";
  await f.load(p, changed, blobs[0], assets);
  near(
    pixel(await f.raster(p)),
    original.map((v, i) =>
      i === 3 ? v : Math.round(v * 0.5 + ((v * [200, 40, 80][i]) / 255) * 0.5),
    ),
  );
  changed = structuredClone(d);
  changed.layers[1].mask = {
    enabled: true,
    selection: {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 64, y: 96 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    },
    strokes: [],
  };
  await f.load(p, changed, blobs[0], assets);
  const masked = await f.raster(p);
  near(pixel(masked, 16, 48), a);
  near(pixel(masked, 96, 48), original, 0);
  changed = structuredClone(d);
  changed.layers[1].transform.x = 32;
  await f.load(p, changed, blobs[0], assets);
  const translated = await f.raster(p);
  near(pixel(translated, 16, 48), original, 0);
  near(pixel(translated, 64, 48), a);
  console.log(
    JSON.stringify({
      png: a,
      jpeg: actual,
      expectedFlattened: expected,
      jpegMaxError: Math.max(...expected.map((n, i) => Math.abs(n - actual[i]))),
      webpAlpha: webp.pixels[3],
      restorationChecks: [
        "visibility",
        "opacity",
        "multiply",
        "mask coverage",
        "translated bounds",
      ],
    }),
  );
} finally {
  await b.close();
}
