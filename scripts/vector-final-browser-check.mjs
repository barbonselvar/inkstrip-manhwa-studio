/** Phase D real renderer, appearance/text UI, secure SVG and native round trips. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { appearanceItem, defaultVectorGradient } from "../src/lib/studio/pro/vector-appearance.ts";
import { defaultTextPath, layoutPathText } from "../src/lib/studio/pro/text-path.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
const {
  tab: rawTab,
  start,
  open,
  load: rawLoad,
  native: rawNative,
  raster: rawRaster,
  same,
  preview,
  artboardBounds,
  records,
} = proBrowserFixtures(base, errors);
async function panels(p, enabled = true) {
  const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if ((await b.getAttribute("aria-expanded")) !== String(enabled)) await b.click();
}
async function tab(p, name) {
  await panels(p);
  await rawTab(p, name);
}
async function native(p) {
  await panels(p);
  return rawNative(p);
}
async function raster(p, mime) {
  await panels(p);
  return rawRaster(p, mime);
}
async function load(p, ...args) {
  await panels(p);
  return rawLoad(p, ...args);
}
let cases = 0;
const passed = (name) => {
  cases++;
  console.log(JSON.stringify({ case: name, pass: true }));
};
const at = (im, x, y) => im.pixels.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4);
function fixture() {
  const d = fromPanel({ id: "vector-final", name: "Vector Final QA", width: 128, height: 96 });
  d.layers[0].visible = false;
  const l = layer("shape", 64, 48, "shape");
  Object.assign(l, {
    name: "Appearance subject",
    fill: "#ff0000",
    stroke: "#000000",
    strokeWidth: 0,
    vectorOverflow: true,
  });
  l.transform.x = 32;
  l.transform.y = 24;
  d.layers.push(l);
  return d;
}
async function svg(p) {
  await tab(p, "Export");
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export SVG · vectors only", exact: true }).click();
  return readFile(await (await ev).path());
}
async function image(p, bytes, mime = "image/svg+xml") {
  return p.evaluate(
    async ({ bytes, mime }) => {
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mime }));
      try {
        const im = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(Error("Image decoding failed"));
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
    { bytes: [...bytes], mime },
  );
}
function compare(a, b, { mean = 0.7, fraction = 0.02 } = {}) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let total = 0,
    bad = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    let maximum = 0;
    for (let c = 0; c < 4; c++) {
      // Premultiplied comparisons avoid undefined RGB in transparent edge pixels.
      const av = c === 3 ? a.pixels[i + c] : (a.pixels[i + c] * a.pixels[i + 3]) / 255;
      const bv = c === 3 ? b.pixels[i + c] : (b.pixels[i + c] * b.pixels[i + 3]) / 255;
      const difference = Math.abs(av - bv);
      total += difference;
      maximum = Math.max(maximum, difference);
    }
    if (maximum > 24) bad++;
  }
  const result = { mean: total / a.pixels.length, fraction: bad / (a.width * a.height) };
  console.log(JSON.stringify({ renderDifference: result }));
  assert.ok(result.mean <= mean, JSON.stringify(result));
  assert.ok(result.fraction <= fraction, JSON.stringify(result));
}
async function reopen(p, file) {
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
    name: "actual-v4.inkstrip",
    mimeType: "application/json",
    buffer: file.bytes,
  });
  await p
    .getByText("Native document imported into this Pro draft. Chapter unchanged.", { exact: true })
    .waitFor();
  await preview(p);
}
async function importSvg(p, text, success = true) {
  await tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({ name: "fixture.svg", mimeType: "image/svg+xml", buffer: Buffer.from(text) });
  if (success)
    await p.getByText("SVG vectors imported. Chapter unchanged.", { exact: true }).waitFor();
  else await p.locator(".pro-alert").waitFor();
}
async function position(p, point) {
  await artboardBounds(p);
  return p.locator('svg[aria-label="Pro selection overlays"]').evaluate((el, point) => {
    const r = el.getBoundingClientRect(),
      b = el.viewBox.baseVal;
    return {
      x: r.x + ((point.x - b.x) / b.width) * r.width,
      y: r.y + ((point.y - b.y) / b.height) * r.height,
    };
  }, point);
}
async function touch(p, a, b, cancel = false) {
  const from = await position(p, a),
    to = await position(p, b),
    cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8, id: 1 },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const p = await context.newPage(),
    source = await start(p);
  await open(p, "Vector");
  for (const alignment of ["center", "inside", "outside"]) {
    const d = fixture(),
      l = d.layers[1],
      f = appearanceItem("fill", l),
      s = appearanceItem("stroke", l);
    f.paint.gradient = defaultVectorGradient();
    f.paint.gradient.stops = [
      { position: 0, color: "#ff0000", opacity: 1 },
      { position: 0.45, color: "#00ff00", opacity: 0.3 },
      { position: 1, color: "#0000ff", opacity: 1 },
    ];
    s.width = 8;
    s.alignment = alignment;
    s.paint.color = "#ffffff";
    s.join = "miter";
    l.appearance = [f, s];
    await load(p, d, source);
    const png = await raster(p),
      bytes = await svg(p),
      oracle = await image(p, bytes);
    compare(png, oracle);
    assert.equal(at(png, 64, 48)[3] > 0, true);
    if (alignment === "inside") assert.deepEqual(at(png, 29, 48), [0, 0, 0, 0]);
    if (alignment === "outside") assert.deepEqual(at(png, 29, 48), [255, 255, 255, 255]);
    const saved = await native(p);
    assert.equal(saved.value.version, 4);
    await reopen(p, saved);
    same(png, await raster(p));
    await load(p, { ...d, layers: [d.layers[0]] }, source);
    await importSvg(p, bytes.toString());
    const imported = await native(p),
      subject = imported.value.document.layers.find((a) => a.appearance);
    assert.equal(subject.appearance.length, 2);
    assert.equal(subject.appearance[1].alignment, alignment);
    compare(png, await raster(p));
    passed(`${alignment} gradient stack SVG/native/raster roundtrip`);
  }
  // Radial paint with transformed stops, stroke gradients and isolated paint blending.
  {
    const d = fixture(),
      l = d.layers[1],
      f = appearanceItem("fill", l),
      s = appearanceItem("stroke", l);
    f.paint.gradient = {
      ...defaultVectorGradient(),
      kind: "radial",
      from: { x: 0.4, y: 0.4 },
      to: { x: 0.5, y: 0.5 },
      matrix: [1, 0.2, 0.1, 0.8, 0, 0],
    };
    f.paint.gradient.stops[0].color = "#ff8800";
    s.width = 6;
    s.paint.gradient = defaultVectorGradient();
    s.dash = [4, 3];
    s.cap = "round";
    s.join = "bevel";
    const top = {
      ...appearanceItem("fill", l),
      opacity: 0.3,
      blend: "multiply",
      paint: { color: "#00ff00" },
    };
    l.appearance = [f, top, s];
    await load(p, d, source);
    compare(await raster(p), await image(p, await svg(p)));
    passed("radial transformed fill, gradient dashes and paint blending");
  }
  // Curved compound holes, nonuniform affine paint coordinates and outside stroke winding.
  {
    const d = fixture(),
      l = d.layers[1];
    l.shape = "path";
    l.closed = true;
    l.anchors = [
      { x: 0, y: 0 },
      { x: 64, y: 0 },
      { x: 64, y: 48 },
      { x: 0, y: 48 },
    ];
    l.subpaths = [
      {
        closed: true,
        anchors: [
          { x: 20, y: 12 },
          { x: 44, y: 12 },
          { x: 44, y: 36 },
          { x: 20, y: 36 },
        ],
      },
    ];
    l.transform = { ...l.transform, scaleX: 0.9, scaleY: 0.75, rotation: 12, shearX: 8 };
    for (const rule of ["nonzero", "evenodd"]) {
      const f = appearanceItem("fill", l),
        s = appearanceItem("stroke", l);
      f.fillRule = s.fillRule = rule;
      f.paint.gradient = defaultVectorGradient();
      f.paint.gradient.matrix = [1, 0.4, 0.2, 1, 0, 0];
      s.width = 5;
      s.alignment = "outside";
      s.paint.gradient = {
        ...defaultVectorGradient(),
        kind: "radial",
        from: { x: 0.5, y: 0.5 },
        to: { x: 0.5, y: 0.5 },
      };
      l.appearance = [f, s];
      await load(p, d, source);
      compare(await raster(p), await image(p, await svg(p)), { mean: 1, fraction: 0.025 });
    }
    passed("compound winding, affine gradients and radial outside strokes");
  }
  {
    const d = fixture(),
      l = d.layers[1],
      a = appearanceItem("fill", l),
      b = appearanceItem("fill", l);
    a.paint.color = "#ff0000";
    b.paint.color = "#0000ff";
    b.opacity = 0.5;
    l.appearance = [a, b];
    l.vectorClips = [
      {
        enabled: true,
        rule: "nonzero",
        matrix: [1, 0, 0, 1, 0, 0],
        contours: [
          {
            closed: true,
            anchors: [
              { x: 6, y: 24, outgoing: { x: 6, y: -10 } },
              { x: 58, y: 24, incoming: { x: 58, y: -10 }, outgoing: { x: 58, y: 58 } },
              { x: 6, y: 24, incoming: { x: 6, y: 58 } },
            ],
          },
        ],
      },
    ];
    await load(p, d, source);
    const output = await raster(p),
      bytes = await svg(p);
    compare(output, await image(p, bytes), { mean: 0.3, fraction: 0.01 });
    await load(p, { ...d, layers: [d.layers[0]] }, source);
    await importSvg(p, bytes.toString());
    compare(output, await raster(p), { mean: 0.3, fraction: 0.01 });
    passed("curved clipping applies once to the whole stacked appearance, including SVG reopen");
  }
  // Raster masks and clipping stacks use the real shared compositor with advanced paints.
  {
    const d = fixture(),
      l = d.layers[1],
      f = appearanceItem("fill", l);
    f.paint.color = "#00ff00";
    l.appearance = [f];
    l.mask = {
      enabled: true,
      strokes: [],
      selection: {
        inverted: false,
        feather: 0,
        regions: [
          {
            kind: "rectangle",
            operation: "add",
            points: [
              { x: 32, y: 0 },
              { x: 64, y: 48 },
            ],
          },
        ],
      },
    };
    const upper = layer("shape", 128, 96, "clipped");
    upper.name = "Clipped blue";
    upper.fill = "#0000ff";
    upper.strokeWidth = 0;
    upper.clipped = true;
    d.layers.push(upper);
    await load(p, d, source);
    const before = await raster(p);
    assert.deepEqual(at(before, 40, 40), [0, 0, 0, 0]);
    assert.deepEqual(at(before, 80, 40), [0, 0, 255, 255]);
    const file = await native(p);
    await reopen(p, file);
    same(before, await raster(p));
    passed("advanced appearance with raster masks and layer clipping");
  }
  {
    const d = fixture(),
      l = d.layers[1];
    l.shape = "path";
    l.closed = false;
    l.anchors = [
      { x: 32, y: 0 },
      { x: 32, y: 48 },
    ];
    l.strokeWidth = 4;
    l.fill = "transparent";
    l.stroke = "#ffffff";
    await load(p, d, source);
    await tab(p, "Layers");
    await p.getByLabel("Select layer Appearance subject", { exact: true }).check();
    await tab(p, "Appearance");
    await p.getByLabel("Appearance item", { exact: true }).selectOption({ label: "2. stroke" });
    await p.getByLabel("Vector paint type", { exact: true }).selectOption("linear");
    const output = await raster(p);
    assert.ok(
      at(output, 64, 70)[0] - at(output, 64, 26)[0] > 150,
      "vertical gradient stroke actually interpolates along its geometry",
    );
    const file = await native(p);
    assert.equal(
      file.value.document.layers[1].appearance[1].paint.gradient.units,
      "userSpaceOnUse",
    );
    compare(output, await image(p, await svg(p)));
    passed("creating and exporting a vertical gradient stroke uses a valid user-space fallback");
  }
  // UI operations modify real native state, render pixels, and undo atomically.
  await load(p, fixture(), source);
  await tab(p, "Layers");
  await p.getByLabel("Select layer Appearance subject", { exact: true }).check();
  await tab(p, "Appearance");
  await p.getByRole("button", { name: "Add fill", exact: true }).click();
  await p.getByLabel("Appearance color", { exact: true }).fill("#00ff00");
  let n = await native(p);
  assert.equal(n.value.document.layers[1].appearance.length, 3);
  assert.deepEqual(at(await raster(p), 64, 48), [0, 255, 0, 255]);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.deepEqual(at(await raster(p), 64, 48), [255, 0, 0, 255]);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  await tab(p, "Appearance");
  await p.getByRole("button", { name: "Duplicate item", exact: true }).click();
  await p.getByRole("button", { name: "Lower item", exact: true }).click();
  n = await native(p);
  assert.equal(n.value.document.layers[1].appearance.length, 4);
  await tab(p, "Appearance");
  await p.getByLabel("Appearance item visible", { exact: true }).uncheck();
  await p.getByRole("button", { name: "Copy appearance", exact: true }).click();
  await p.getByRole("button", { name: "Remove item", exact: true }).click();
  await p.getByRole("button", { name: "Paste appearance", exact: true }).click();
  n = await native(p);
  assert.equal(n.value.document.layers[1].appearance.length, 4);
  assert.equal(n.value.document.layers[1].appearance.filter((a) => !a.visible).length, 1);
  passed("appearance CRUD, ordering, visibility, clipboard, undo/redo and actual pixels");
  // Editable path text renders real curves and exports standard textPath.
  {
    const d = fixture(),
      l = d.layers[1];
    l.shape = "path";
    l.anchors = [
      { x: 0, y: 30, outgoing: { x: 20, y: -25 } },
      { x: 90, y: 30, incoming: { x: 70, y: -25 } },
    ];
    l.closed = false;
    l.width = 90;
    l.transform.x = 16;
    l.fill = "transparent";
    l.stroke = "#666666";
    l.strokeWidth = 1;
    await load(p, d, source);
    await tab(p, "Layers");
    await p.getByLabel("Select layer Appearance subject", { exact: true }).check();
    await tab(p, "Typography");
    await p.getByRole("button", { name: "Create text on selected contour", exact: true }).click();
    await p.getByLabel("Path text content", { exact: true }).fill("Inkstrip曲");
    await p.getByLabel("Path text font size", { exact: true }).fill("12");
    await p.getByLabel("Path text letter spacing", { exact: true }).fill("0.5");
    await p.getByRole("button", { name: "Edit text baseline anchors · A", exact: true }).click();
    await tab(p, "Properties");
    assert.ok(
      await p
        .getByRole("button", { name: "Fit vector frame to content", exact: true })
        .isDisabled(),
    );
    await p
      .getByRole("button", { name: "Insert anchor without changing curve", exact: true })
      .click();
    assert.equal((await native(p)).value.document.layers.at(-1).anchors.length, 3);
    await p.locator(".pro-viewport").focus();
    await p.keyboard.press("Delete");
    let edited = (await native(p)).value.document;
    assert.equal(edited.layers.length, 3);
    assert.ok(edited.layers.at(-1).textPath);
    assert.equal(edited.layers.at(-1).anchors.length, 2);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await p.getByRole("button", { name: "Move tool", exact: true }).click();
    n = await native(p);
    assert.ok(n.value.document.layers.at(-1).textPath);
    const before = await raster(p),
      bytes = await svg(p);
    assert.match(bytes.toString(), /<textPath/);
    compare(before, await image(p, bytes), { mean: 1.2, fraction: 0.04 });
    assert.ok(before.pixels.some((v, i) => i % 4 === 3 && v > 0));
    await reopen(p, n);
    same(before, await raster(p));
    await tab(p, "Typography");
    await p.getByLabel("Path text position", { exact: true }).fill("8");
    assert.notDeepEqual(before.pixels, (await raster(p)).pixels);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    same(before, await raster(p));
    const originalChapter = (await records(p))[0];
    assert.equal(n.value.assets[n.value.document.source.assetId].data, source);
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await p
      .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
      .waitFor();
    await p.reload();
    await open(p, "Vector");
    same(before, await raster(p));
    assert.deepEqual((await records(p))[0], originalChapter);
    await p.getByRole("button", { name: "Raster", exact: true }).click();
    same(before, await raster(p));
    await p.getByRole("button", { name: "Vector", exact: true }).click();
    for (const mime of ["image/jpeg", "image/webp"]) {
      const output = await raster(p, mime);
      assert.equal(output.width, 128);
      assert.equal(output.height, 96);
      assert.ok(output.pixels.some((v, i) => i % 4 !== 3 && v > 0));
      if (mime === "image/jpeg") assert.ok(output.pixels.every((v, i) => i % 4 !== 3 || v === 255));
    }
    passed("editable text local save/reload, source bytes, Raster switch and JPEG/WebP exports");
    // Real SVG re-import remains editable native text, not an image.
    await load(p, { ...d, layers: [d.layers[0]] }, source);
    await importSvg(p, bytes.toString());
    n = await native(p);
    assert.ok(n.value.document.layers.some((a) => a.kind === "text" && a.textPath));
    compare(before, await raster(p), { mean: 1.2, fraction: 0.04 });
    passed("curved Unicode text, typography, positioning, SVG/native and undo");
  }
  // Paints span the complete text object; opacity is applied once to overlapping glyph coverage.
  for (const kind of ["linear", "radial"]) {
    const d = fixture(),
      t = layer("text", 108, 72, "gradient-text");
    t.name = "Gradient path text";
    t.shape = "path";
    t.text = "VECTOR";
    t.fontSize = 23;
    t.fontWeight = 700;
    t.letterSpacing = -1;
    t.strokeWidth = 0;
    t.closed = false;
    t.anchors = [
      { x: 0, y: 45, outgoing: { x: 28, y: 0 } },
      { x: 108, y: 45, incoming: { x: 80, y: 0 } },
    ];
    t.textPath = defaultTextPath();
    t.align = "center";
    t.transform.x = 10;
    t.transform.y = 20;
    const a = appearanceItem("fill", t);
    a.opacity = 0.65;
    a.paint.gradient = defaultVectorGradient();
    a.paint.gradient.stops = [
      { position: 0, color: "#ff0000", opacity: 1 },
      { position: 1, color: "#0000ff", opacity: 1 },
    ];
    if (kind === "radial")
      Object.assign(a.paint.gradient, {
        kind,
        from: { x: 0.5, y: 0.5 },
        to: { x: 0.5, y: 0.5 },
        radius: 0.5,
      });
    t.appearance = [a];
    d.layers = [d.layers[0], t];
    await load(p, d, source);
    await tab(p, "Properties");
    assert.ok(await p.getByLabel("Text fill", { exact: true }).isDisabled());
    assert.ok(await p.getByLabel("Text line height", { exact: true }).isDisabled());
    const output = await raster(p),
      exportedSvg = await svg(p);
    compare(output, await image(p, exportedSvg), { mean: 1.2, fraction: 0.04 });
    const metrics = await p.evaluate(
      ({ svg, font, text }) => {
        const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement,
          holder = document.createElement("div");
        holder.style.position = "fixed";
        holder.style.left = "-10000px";
        holder.append(document.importNode(root, true));
        document.body.append(holder);
        try {
          const el = holder.querySelector("text"),
            ctx = document.createElement("canvas").getContext("2d");
          ctx.font = font;
          ctx.fontKerning = "none";
          return {
            widths: [...text].map((c) => ctx.measureText(c).width),
            positions: [...text].map((_, i) => {
              const a = el.getStartPositionOfChar(i),
                b = el.getEndPositionOfChar(i);
              return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: el.getRotationOfChar(i) };
            }),
          };
        } finally {
          holder.remove();
        }
      },
      {
        svg: exportedSvg.toString(),
        font: `${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`,
        text: t.text,
      },
    );
    let metric = 0;
    const positioned = layoutPathText(t, () => metrics.widths[metric++]);
    positioned.forEach((g, i) => {
      assert.ok(
        Math.hypot(g.x - metrics.positions[i].x, g.y - metrics.positions[i].y) < 0.6,
        "SVG/native glyph centers agree within 0.6 local px",
      );
      assert.ok(
        Math.abs((g.angle * 180) / Math.PI - metrics.positions[i].angle) < 1,
        "SVG/native glyph directions agree within one degree",
      );
    });
    if (kind === "linear") {
      let red = 0,
        blue = 0;
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 128; x++) {
          const c = at(output, x, y);
          if (c[3] > 80) {
            if (c[0] > c[2] + 30) red++;
            if (c[2] > c[0] + 30) blue++;
          }
        }
      assert.ok(red > 20 && blue > 20, `whole-object gradient needs both colors (${red},${blue})`);
    }
    const file = await native(p);
    await reopen(p, file);
    same(output, await raster(p));
    passed(
      `${kind} text-path paint coordinates, overlapping glyph opacity and native/SVG fidelity`,
    );
  }
  // Standards SVG imports: inherited transforms, viewBox, units, gradients and binary clipping/masks.
  const svgCases = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="-10 -5 128 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(12 .5 .5)"><stop offset="0" stop-color="red"/><stop offset=".5" stop-color="blue" stop-opacity=".4"/><stop offset=".5" stop-color="green"/><stop offset="1" stop-color="white"/></linearGradient></defs><g transform="translate(12 8)" opacity=".7"><g transform="rotate(8)"><path d="M0 0H80V60H0Z M20 20V40H50V20Z" fill="url(#g)" fill-rule="evenodd" stroke="black" stroke-dasharray="3 4"/></g></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><defs><clipPath id="c"><path d="M25 25H80V70H25Z"/></clipPath><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="64" cy="48" r="48" fx="50" fy="40" gradientTransform="matrix(1 .1 0 1 0 0)"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="red"/></radialGradient></defs><g clip-path="url(#c)"><rect width="120" height="90" fill="url(#g)"/></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><defs><mask id="m" mask-type="alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="70" height="80"><rect x="20" y="20" width="70" height="60" fill="red"/></mask></defs><rect x="10" y="10" width="100" height="80" fill="blue" mask="url(#m)"/></svg>',
  ];
  svgCases.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><defs><clipPath id="clip" clipPathUnits="objectBoundingBox"><path d="M.2 .1H.8V.9H.2Z"/></clipPath></defs><g transform="translate(8 6)"><rect x="10" y="10" width="90" height="60" fill="purple" transform="rotate(5 55 40)" clip-path="url(#clip)"/></g></svg>',
  );
  svgCases.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 64 48"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="64" height="48" fill="url(#g)"/></svg>',
  );
  svgCases.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" stop-color="red" stop-opacity=".6"><defs><linearGradient id="g"><stop offset="0"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect x="10" y="10" width="108" height="76" fill="url(#g)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><defs><clipPath id="c"><path fill-rule="evenodd" d="M10 10H118V86H10Z M30 30H90V65H30Z"/></clipPath></defs><rect width="128" height="96" fill="green" clip-path="url(#c)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><defs><mask id="m" mask-type="alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="96"><path fill="white" fill-rule="nonzero" clip-rule="evenodd" d="M10 10H118V86H10Z M30 30H90V65H30Z"/></mask></defs><rect width="128" height="96" fill="purple" mask="url(#m)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><text x="10" y="48" dy="6" font-family="Arial" font-size="22" fill="blue">Vector</text></svg>',
  );
  svgCases.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><g visibility="hidden" fill="red"><rect x="10" y="10" width="80" height="60" visibility="inherit"/><rect x="100" y="10" width="20" height="60" visibility="visible" fill="inherit"/></g></svg>',
  );
  for (const [i, text] of svgCases.entries()) {
    const d = fixture();
    d.layers = [d.layers[0]];
    await load(p, d, source);
    await importSvg(p, text);
    compare(await raster(p), await image(p, Buffer.from(text)), { mean: 0.8, fraction: 0.025 });
    n = await native(p);
    const before = await raster(p);
    await reopen(p, n);
    same(before, await raster(p));
    passed(`SVG standards oracle ${i + 1}`);
  }
  const unsafe = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://evil.test/a">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" onclick="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="url(https://evil.test/a)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><filter id="f"/><rect width="10" height="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><mask id="m"><rect width="10" height="10" fill="gray"/></mask></defs><rect width="10" height="10" mask="url(#m)"/></svg>',
  ];
  unsafe.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><defs><mask id="m" opacity=".5"><rect width="128" height="96" fill="white"/></mask></defs><rect width="128" height="96" fill="blue" mask="url(#m)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" fill-opacity=".5"><defs><mask id="m"><rect width="128" height="96" fill="white"/></mask></defs><rect width="128" height="96" fill="blue" mask="url(#m)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><defs><mask id="m"><rect width="128" height="96" fill="white" display="none"/></mask></defs><rect width="128" height="96" fill="blue" mask="url(#m)"/></svg>',
  );
  for (const text of unsafe) {
    const before = (await native(p)).value.document;
    await importSvg(p, text, false);
    assert.deepEqual((await native(p)).value.document, before);
  }
  passed("unsafe and unrepresentable SVG rejection is transactional");
  {
    await tab(p, "Assets");
    await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
      name: "font-fallback.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><text x="10" y="30">Font</text></svg>',
      ),
    });
    await p.getByText(/^SVG vectors imported with compatibility notes:/).waitFor();
    assert.equal((await native(p)).value.document.layers.at(-1).fontFamily, "Arial");
    passed("generic/default font fallback is reported explicitly without losing editable text");
  }

  {
    const d = fixture();
    d.width = d.height = 1024;
    d.layers = d.layers.slice(0, 1);
    for (let j = 0; j < 40; j++) {
      const l = layer("shape", 100, 100, `benchmark-${j}`);
      l.shape = "path";
      l.closed = true;
      l.vectorOverflow = true;
      l.anchors = Array.from({ length: 1000 }, (_, i) => ({
        x: 50 + 45 * Math.cos((i * Math.PI) / 500),
        y: 50 + 45 * Math.sin((i * Math.PI) / 500),
      }));
      l.transform.x = (j % 8) * 125;
      l.transform.y = Math.floor(j / 8) * 160;
      const f = appearanceItem("fill", l);
      f.paint.gradient = defaultVectorGradient();
      l.appearance = [f];
      d.layers.push(l);
    }
    d.artboards = Array.from({ length: 32 }, (_, i) => ({
      id: `board-${i}`,
      name: `Board ${i}`,
      x: (i % 8) * 128,
      y: Math.floor(i / 8) * 256,
      width: 128,
      height: 256,
      background: "transparent",
    }));
    const begin = performance.now();
    await load(p, d, source);
    await p.waitForFunction(
      () =>
        document
          .querySelector('canvas[aria-label="Pro composite preview"]')
          ?.getAttribute("aria-busy") === "false",
    );
    const importRenderMs = performance.now() - begin;
    await tab(p, "Export");
    await p.getByLabel("Pro export format", { exact: true }).selectOption("image/png");
    const exportStart = performance.now(),
      ev = p.waitForEvent("download");
    await p.getByRole("button", { name: /^Export composite ·/ }).click();
    const exported = await readFile(await (await ev).path()),
      exportMs = performance.now() - exportStart;
    const out = await p.evaluate(
      async (bytes) => {
        const b = await createImageBitmap(
            new Blob([Uint8Array.from(bytes)], { type: "image/png" }),
          ),
          c = new OffscreenCanvas(b.width, b.height),
          x = c.getContext("2d");
        x.drawImage(b, 0, 0);
        const result = {
          width: b.width,
          height: b.height,
          pixel: [...x.getImageData(50, 50, 1, 1).data],
        };
        b.close();
        return result;
      },
      [...exported],
    );
    assert.equal(out.width, 1024);
    assert.equal(out.pixel[3], 255);
    console.log(
      JSON.stringify({
        benchmark: {
          paths: 40,
          anchors: 40000,
          artboards: 32,
          width: 1024,
          height: 1024,
          importAndPreviewWallMs: +importRenderMs.toFixed(1),
          pngExportDownloadWallMs: +exportMs.toFixed(1),
          chromium: browser.version(),
        },
      }),
    );
    passed("representative 40k-anchor/32-artboard import, preview and native-resolution PNG");
  }
  await p.screenshot({ path: "/workspace/screenshots/dd-vector-desktop.png" });
  await context.close();
  for (const width of [320, 390]) {
    const c = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true,
        acceptDownloads: true,
      }),
      p = await c.newPage(),
      source = await start(p);
    await open(p, "Vector");
    const d = fixture(),
      l = d.layers[1],
      f = appearanceItem("fill", l);
    f.paint.gradient = defaultVectorGradient();
    f.paint.gradient.stops.splice(1, 0, { position: 0.5, color: "#ff0000", opacity: 1 });
    l.appearance = [f];
    await load(p, d, source);
    await tab(p, "Layers");
    await p.getByLabel("Select layer Appearance subject", { exact: true }).check();
    await tab(p, "Appearance");
    await p.getByRole("button", { name: "Edit gradient on canvas · G", exact: true }).click();
    await panels(p, false);
    const saved = await native(p);
    await panels(p, false);
    await touch(p, { x: 32, y: 48 }, { x: 40, y: 54 }, true);
    assert.deepEqual(
      (await native(p)).value.document.layers[1].appearance,
      saved.value.document.layers[1].appearance,
    );
    await panels(p, false);
    await touch(p, { x: 32, y: 48 }, { x: 40, y: 54 });
    n = await native(p);
    assert.ok(n.value.document.layers[1].appearance[0].paint.gradient.from.x > 0.1);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.deepEqual(
      (await native(p)).value.document.layers[1].appearance,
      saved.value.document.layers[1].appearance,
    );
    await panels(p, false);
    await touch(p, { x: 64, y: 48 }, { x: 76.8, y: 48 });
    n = await native(p);
    assert.ok(
      Math.abs(n.value.document.layers[1].appearance[0].paint.gradient.stops[1].position - 0.7) <
        0.025,
    );
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await tab(p, "Appearance");
    await p.getByLabel("Vector paint type", { exact: true }).selectOption("radial");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await preview(p);
    assert.equal(
      await p.locator(".pro-inspector").evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
    );
    assert.equal(await p.evaluate(() => scrollY), 0);
    await p.screenshot({ path: `/workspace/screenshots/dd-vector-${width}.png` });
    passed(`${width}px touch gradient apply/cancel, undo and responsive controls`);
    await c.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ suite: "vector-final", cases, errors }));
} finally {
  await browser.close();
}
