/** R9 SVG interoperability for Raster vector content: parametric stars/polygons, rounded
 * rectangles, compound even-odd paths, transformed shapes and text on a path. Native PNG
 * vs exported SVG, then SVG re-import vs the original, are compared pixel by pixel.
 * Malicious or unsupported SVG is rejected with a named reason, never partially run. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { attachText } from "../src/lib/studio/pro/text-path.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  fx = proBrowserFixtures(base, errors);

function document() {
  const d = fromPanel({ id: "svg", name: "R9 SVG", width: 128, height: 96 });
  d.version = 2;
  d.layers[0].visible = false; // SVG export carries vectors only
  const shape = (name, kind, x, y, w, h, extra = {}) => {
    const l = layer("shape", w, h);
    Object.assign(l, { name, shape: kind, strokeWidth: 0, ...extra });
    l.transform.x = x;
    l.transform.y = y;
    return l;
  };
  const star = shape("Star", "star", 6, 6, 40, 40, {
    fill: "#3fd0a4",
    shapeOptions: { sides: 6, inner: 0.4 },
  });
  star.transform = { ...star.transform, rotation: 20, scaleX: 1.2 };
  const ring = shape("Ring", "path", 52, 52, 40, 40, {
    fill: "#ff3366",
    fillRule: "evenodd",
    anchors: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
    closed: true,
    subpaths: [
      {
        closed: true,
        anchors: [
          { x: 10, y: 20, outgoing: { x: 10, y: 10 } },
          { x: 30, y: 20, incoming: { x: 30, y: 10 }, outgoing: { x: 30, y: 30 } },
        ],
      },
    ],
    vectorOverflow: true,
  });
  const curve = shape("Curve", "path", 0, 0, 128, 96, {
    fill: "transparent",
    stroke: "#101010",
    strokeWidth: 2,
    anchors: [
      { x: 8, y: 90, outgoing: { x: 30, y: 60 } },
      { x: 60, y: 88, incoming: { x: 40, y: 60 } },
    ],
    closed: false,
    vectorOverflow: true,
  });
  d.layers.push(
    star,
    shape("Rounded", "rectangle", 60, 8, 60, 34, {
      fill: "#ffcc00",
      stroke: "#172420",
      strokeWidth: 3,
      shapeOptions: { radius: 10 },
      // Without overflow the outer half of a stroke is clipped to the layer box, which
      // SVG cannot express; Pen/Pathfinder/SVG shapes always use overflow.
      vectorOverflow: true,
    }),
    shape("Octagon", "polygon", 96, 50, 28, 28, { fill: "#3366ff", shapeOptions: { sides: 8 } }),
    ring,
    curve,
  );
  const withText = attachText(d, curve.id).document;
  const text = withText.layers.find((l) => l.textPath);
  Object.assign(text, { text: "INKSTRIP", fontSize: 10, fill: "#202020" });
  return withText;
}
async function svg(p) {
  await fx.tab(p, "Export");
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export SVG · vectors only", exact: true }).click();
  return readFile(await (await ev).path());
}
async function image(p, bytes) {
  return p.evaluate(
    async (bytes) => {
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: "image/svg+xml" }),
      );
      try {
        const im = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(Error("SVG decoding failed"));
          i.src = url;
        });
        const c = document.createElement("canvas");
        c.width = im.width;
        c.height = im.height;
        const x = c.getContext("2d");
        x.drawImage(im, 0, 0);
        return {
          width: c.width,
          height: c.height,
          pixels: [...x.getImageData(0, 0, c.width, c.height).data],
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [...bytes],
  );
}
/** Premultiplied mean difference and share of pixels off by more than 24 levels. */
function compare(a, b, { mean = 0.7, fraction = 0.02 } = {}) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let total = 0,
    bad = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    let maximum = 0;
    for (let c = 0; c < 4; c++) {
      const av = c === 3 ? a.pixels[i + c] : (a.pixels[i + c] * a.pixels[i + 3]) / 255,
        bv = c === 3 ? b.pixels[i + c] : (b.pixels[i + c] * b.pixels[i + 3]) / 255,
        d = Math.abs(av - bv);
      total += d;
      maximum = Math.max(maximum, d);
    }
    if (maximum > 24) bad++;
  }
  const result = { mean: total / a.pixels.length, fraction: bad / (a.width * a.height) };
  assert.ok(result.mean <= mean && result.fraction <= fraction, JSON.stringify(result));
  return result;
}
async function importSvg(p, text) {
  await fx.tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({ name: "fixture.svg", mimeType: "image/svg+xml", buffer: Buffer.from(text) });
}

const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const source = await fx.start(p);
await fx.open(p, "Raster");
const d = document();
await fx.load(p, d, source);
const original = await fx.raster(p),
  exported = await svg(p),
  text = exported.toString();
// 1. Export: editable vectors, no scripts, curves kept as cubic path data.
assert.match(text, /<textPath /);
assert.match(text, /fill-rule="evenodd"/);
assert.doesNotMatch(text, /<script|on[a-z]+=|javascript:/i);
const exportDifference = compare(original, await image(p, exported));

// 2. Re-import into an empty document: same pixels, editable layers.
const empty = fromPanel({ id: "svg", name: "R9 SVG", width: 128, height: 96 });
empty.version = 2;
empty.layers[0].visible = false;
await fx.load(p, empty, source);
await importSvg(p, text);
await p.getByText("SVG vectors imported. Chapter unchanged.", { exact: true }).waitFor();
const reimported = (await fx.native(p)).value.document;
assert.ok(
  reimported.layers.some((l) => l.kind === "text" && l.textPath),
  "text on path kept",
);
assert.ok(
  reimported.layers.filter((l) => l.kind === "shape" && l.shape === "path").length >= 4,
  "shapes kept as editable paths",
);
const roundTrip = compare(original, await fx.raster(p));

// 3. Unsafe SVG is rejected with a reason and changes nothing.
const before = (await fx.native(p)).value.document;
for (const [payload, reason] of [
  [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="5" height="5"/></svg>',
    /script/,
  ],
  [
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" onclick="alert(1)"/></svg>',
    /onclick/,
  ],
  [
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png" width="5" height="5"/></svg>',
    /image|href|Unsafe/i,
  ],
]) {
  await importSvg(p, payload);
  const alert = p.locator(".pro-alert");
  await alert.waitFor();
  assert.match(await alert.innerText(), reason);
}
assert.deepEqual((await fx.native(p)).value.document.layers, before.layers);
await browser.close();
assert.deepEqual(errors, []);
console.log(JSON.stringify({ exportDifference, roundTrip, unsafeRejected: 3, errors }));
