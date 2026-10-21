/** Real worker affine/projective/warp pixels, document transactions and native touch QA. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { TRANSFORM } from "../src/lib/studio/pro/model.ts";
import { MESH } from "../src/lib/studio/pro/transform.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [];
async function tab(p, name) {
  await p
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function records(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows;
  });
}
async function start(p) {
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Transform QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  const source = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    const image = x.createImageData(128, 96);
    for (let y = 0; y < 96; y++)
      for (let px = 0; px < 128; px++)
        image.data.set([px * 2, y * 2, 80, px < 16 ? 0 : px < 32 ? 128 : 255], (y * 128 + px) * 4);
    x.putImageData(image, 0, 0);
    return c.toDataURL().split(",")[1];
  });
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "geometry.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
    ]);
  await p.getByRole("button", { name: "Edit Image geometry.png", exact: true }).waitFor();
  return source;
}
async function open(p, mode = "Raster") {
  const button = p.getByRole("button", { name: `Open in ${mode} Studio`, exact: true });
  await button.scrollIntoViewIfNeeded();
  assert.ok(await button.isVisible());
  assert.ok(await button.isEnabled());
  await button.click();
  await p.getByRole("dialog", { name: `Inkstrip ${mode} Studio`, exact: true }).waitFor();
}
async function pixels(p, x, y) {
  return p.evaluate(
    ({ x, y }) => [
      ...document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        .getContext("2d")
        .getImageData(x, y, 1, 1).data,
    ],
    { x, y },
  );
}
async function pixel(p, x, y, expected) {
  await p
    .waitForFunction(
      ({ x, y, expected }) => {
        const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
        return (
          c?.width === 128 &&
          [...c.getContext("2d").getImageData(x, y, 1, 1).data].every(
            (n, i) => Math.abs(n - expected[i]) <= 1,
          )
        );
      },
      { x, y, expected },
    )
    .catch(async (error) => {
      console.error("Transform pixel mismatch", {
        x,
        y,
        expected,
        actual: await pixels(p, x, y),
        alerts: await p.getByRole("alert").allTextContents(),
      });
      await p.screenshot({ path: "/workspace/screenshots/transform-failure.png" });
      throw error;
    });
}
async function point(p, x, y) {
  const r = await p.locator(".pro-artboard").boundingBox();
  return { x: r.x + (x / 128) * r.width, y: r.y + (y / 96) * r.height };
}
async function click(p, x, y) {
  const q = await point(p, x, y);
  await p.mouse.click(q.x, q.y);
}
async function drag(p, a, b) {
  const x = await point(p, ...a),
    y = await point(p, ...b);
  await p.mouse.move(x.x, x.y);
  await p.mouse.down();
  await p.mouse.move(y.x, y.y, { steps: 12 });
  await p.mouse.up();
}
async function load(p, d, source) {
  await tab(p, "History");
  const count = await p.locator(".pro-history-list li").count();
  await tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "transform.inkstrip",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "inkstrip-pro",
          version: 1,
          document: d,
          assets: { source: { mime: "image/png", data: source } },
        }),
      ),
    },
  ]);
  await tab(p, "History");
  await p.waitForFunction(
    (n) => document.querySelectorAll(".pro-history-list li").length === n + 1,
    count,
  );
}
async function native(p) {
  await tab(p, "Export");
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
  const bytes = await readFile(await (await ev).path());
  return { bytes, value: JSON.parse(bytes.toString()) };
}
async function raster(p, mime = "image/png") {
  await tab(p, "Export");
  await p.getByLabel("Pro export format", { exact: true }).selectOption(mime);
  const ev = p.waitForEvent("download");
  await p.getByRole("button", { name: /^Export composite ·/ }).click();
  const bytes = await readFile(await (await ev).path());
  return p.evaluate(
    async ({ data, mime }) => {
      const b = await createImageBitmap(new Blob([Uint8Array.from(data)], { type: mime })),
        c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      const x = c.getContext("2d");
      x.drawImage(b, 0, 0);
      b.close();
      return {
        width: c.width,
        height: c.height,
        pixels: [...x.getImageData(0, 0, c.width, c.height).data],
      };
    },
    { data: [...bytes], mime },
  );
}
function fixture() {
  return fromPanel({ id: "transform-fixture", name: "Transform fixture", width: 128, height: 96 });
}
const apply = (p) =>
  p.locator(".pro-context-bar").getByRole("button", { name: "Apply transform", exact: true });
const cancel = (p) =>
  p.locator(".pro-context-bar").getByRole("button", { name: "Cancel transform", exact: true });
const begin = async (p) => {
  await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
  await p.getByLabel("Transform mode", { exact: true }).waitFor();
};
function at(image, x, y) {
  return image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
}
function same(a, b, tolerance = 1) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  for (let i = 0; i < a.pixels.length; i++)
    assert.ok(
      Math.abs(a.pixels[i] - b.pixels[i]) <= tolerance,
      `channel ${i}: ${a.pixels[i]} ≠ ${b.pixels[i]}`,
    );
}
async function reference(p, source, t) {
  return p.evaluate(
    async ({ source, t }) => {
      const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(atob(source), (c) => c.charCodeAt(0))], { type: "image/png" }),
        ),
        c = document.createElement("canvas");
      c.width = 128;
      c.height = 96;
      const x = c.getContext("2d"),
        pivot = t.pivot ?? { x: 0, y: 0 };
      x.translate(t.x + pivot.x, t.y + pivot.y);
      x.rotate((t.rotation * Math.PI) / 180);
      x.transform(1, Math.tan(((t.shearY ?? 0) * Math.PI) / 180), 0, 1, 0, 0);
      x.transform(1, 0, Math.tan(((t.shearX ?? 0) * Math.PI) / 180), 1, 0, 0);
      x.scale(t.scaleX * (t.flipX ? -1 : 1), t.scaleY * (t.flipY ? -1 : 1));
      x.translate(-pivot.x, -pivot.y);
      x.drawImage(bitmap, 0, 0);
      bitmap.close();
      return { width: 128, height: 96, pixels: [...x.getImageData(0, 0, 128, 96).data] };
    },
    { source, t },
  );
}
async function handleDrag(p, id, dx, dy) {
  const box = await p.locator(`[data-transform-handle="${id}"]`).boundingBox();
  assert.ok(box);
  const a = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(a.x + dx, a.y + dy, { steps: 8 });
  await p.mouse.up();
}
async function imported(p, bytes) {
  await tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({ name: "transform.inkstrip", mimeType: "application/json", buffer: bytes });
  await p
    .getByText("Native document imported into this Pro draft. Chapter unchanged.", { exact: true })
    .waitFor();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage(),
    source = await start(p);
  const chapter = (await records(p))[0];
  await open(p);
  await pixel(p, 64, 48, [128, 96, 80, 255]);
  const original = await raster(p);
  await begin(p);
  await p.getByLabel("Transform width", { exact: true }).fill("64");
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        .getContext("2d")
        .getImageData(64, 10, 1, 1).data[3] === 0,
  );
  assert.equal((await records(p))[0].blobId, chapter.blobId);
  assert.equal(await p.getByLabel("Transform height", { exact: true }).inputValue(), "48");
  await p.getByLabel("Transform rotation", { exact: true }).fill("15");
  await p.getByLabel("Horizontal shear", { exact: true }).fill("20");
  await p.getByLabel("Vertical shear", { exact: true }).fill("-12");
  await p.getByRole("button", { name: "Flip horizontal", exact: true }).click();
  await p.getByRole("button", { name: "Flip vertical", exact: true }).click();
  await apply(p).click();
  let saved = await native(p),
    t = saved.value.document.layers[0].transform;
  assert.equal(t.scaleX, 0.5);
  assert.equal(t.scaleY, 0.5);
  assert.equal(t.rotation, 15);
  assert.equal(t.shearX, 20);
  assert.equal(t.shearY, -12);
  assert.equal(t.flipX, true);
  assert.equal(t.flipY, true);
  const affineImage = await raster(p);
  same(affineImage, await reference(p, source, t), 2);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), original);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), affineImage);
  await begin(p);
  await p.getByLabel("Transform X", { exact: true }).fill("99");
  await cancel(p).click();
  same(await raster(p), affineImage);
  await begin(p);
  await p.getByLabel("Transform X", { exact: true }).fill("12");
  await p.getByRole("button", { name: "Vector", exact: true }).click();
  assert.ok(
    await p.getByRole("dialog", { name: "Inkstrip Vector Studio", exact: true }).isVisible(),
  );
  same(await raster(p), affineImage);
  await p.getByRole("button", { name: "Raster", exact: true }).click();
  console.log(
    "Affine numeric scale/rotate/shear/flips, independent Canvas reference, Apply/Cancel, history and mode-switch safety passed.",
  );
  // Real mouse corner, edge, rotation and pivot gestures.
  await load(p, fixture(), source);
  await begin(p);
  await drag(p, [128, 96], [96, 72]);
  assert.equal(await p.getByLabel("Transform width", { exact: true }).inputValue(), "96");
  assert.equal(await p.getByLabel("Transform height", { exact: true }).inputValue(), "72");
  await p.getByLabel("Transform aspect lock", { exact: true }).uncheck();
  await handleDrag(p, "e", 20, 0);
  assert.equal(await p.getByLabel("Transform height", { exact: true }).inputValue(), "72");
  await handleDrag(p, "rotate", 35, 5);
  assert.ok(
    Math.abs(Number(await p.getByLabel("Transform rotation", { exact: true }).inputValue())) > 1,
  );
  await apply(p).click();
  const beforePivot = await raster(p);
  await begin(p);
  await handleDrag(p, "pivot", -20, 10);
  await apply(p).click();
  same(await raster(p), beforePivot, 2);
  await begin(p);
  await p.getByLabel("Transform X", { exact: true }).fill("17");
  await p.keyboard.press("Escape");
  same(await raster(p), beforePivot, 2);
  console.log(
    "Mouse corners/edges, nonuniform scale, rotation handle, pivot relocation and Escape passed.",
  );
  // Four independent projective corners with an analytic trapezoid reference.
  await load(p, fixture(), source);
  await begin(p);
  await p.getByLabel("Transform mode", { exact: true }).selectOption("perspective");
  await drag(p, [0, 0], [16, 0]);
  await drag(p, [128, 0], [112, 0]);
  await apply(p).click();
  saved = await native(p);
  t = saved.value.document.layers[0].transform;
  assert.equal(t.deform.kind, "perspective");
  assert.ok(Math.abs(t.deform.points[0].x - 0.125) < 0.001);
  assert.ok(Math.abs(t.deform.points[1].x - 0.875) < 0.001);
  const perspectiveImage = await raster(p);
  assert.equal(at(perspectiveImage, 0, 0)[3], 0);
  const X = 64.5 / 128,
    Y = 48.5 / 96,
    v = Y / (0.75 + 0.25 * Y),
    u = (X * (1 - 0.25 * v) + 0.125 * v - 0.125) / 0.75,
    center = at(perspectiveImage, 64, 48);
  assert.ok(Math.abs(center[0] - (u * 128 - 0.5) * 2) <= 2);
  assert.ok(Math.abs(center[1] - (v * 96 - 0.5) * 2) <= 2);
  assert.equal(center[3], 255);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), original);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), perspectiveImage);
  const perspectiveFile = await native(p);
  await imported(p, perspectiveFile.bytes);
  same(await raster(p), perspectiveImage);
  // Smooth mesh edits change actual source pixels, retain editable metadata, undo and reopen exactly.
  await begin(p);
  await p.getByLabel("Transform mode", { exact: true }).selectOption("warp");
  await drag(p, [64, 48], [76, 57]);
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        .getContext("2d")
        .getImageData(64, 48, 1, 1).data[0] < 125,
  );
  await p.screenshot({ path: "/workspace/screenshots/transform-warp-desktop.png" });
  await apply(p).click();
  saved = await native(p);
  t = saved.value.document.layers[0].transform;
  assert.equal(t.deform.kind, "warp");
  assert.ok(t.deform.points[4].x > 0.59);
  assert.ok(t.deform.points[4].y > 0.59);
  const warpImage = await raster(p);
  assert.ok(at(warpImage, 64, 48)[0] < at(original, 64, 48)[0] - 3);
  assert.ok(at(warpImage, 64, 48)[1] < at(original, 64, 48)[1] - 2);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), perspectiveImage);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), warpImage);
  await imported(p, saved.bytes);
  same(await raster(p), warpImage);
  assert.equal(saved.value.assets[saved.value.document.source.assetId].data, source);
  for (const mime of ["image/jpeg", "image/webp"]) {
    const image = await raster(p, mime);
    assert.equal(image.width, 128);
    assert.equal(image.height, 96);
  }
  console.log(
    "True homography pixels, corner drags, analytic perspective, smooth mesh deformation, history/native and PNG/JPEG/WebP passed.",
  );
  // Transformed mask alignment and clipping: clips retain every base alpha channel.
  const d = fixture(),
    baseLayer = d.layers[0];
  baseLayer.transform = {
    ...TRANSFORM,
    deform: {
      kind: "perspective",
      width: 128,
      height: 96,
      points: [
        { x: 0.125, y: 0 },
        { x: 0.875, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    },
  };
  baseLayer.mask = {
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
            { x: 80, y: 96 },
          ],
        },
      ],
    },
  };
  await load(p, d, source);
  const maskImage = await raster(p);
  assert.equal(at(maskImage, 5, 48)[3], 0);
  assert.ok(at(maskImage, 64, 48)[3] > 250);
  const clip = layer("shape", 128, 96);
  clip.clipped = true;
  clip.fill = "#0000ff";
  clip.strokeWidth = 0;
  d.layers.push(clip);
  await load(p, d, source);
  const clipped = await raster(p);
  for (let i = 0; i < clipped.pixels.length; i += 4) {
    assert.equal(clipped.pixels[i + 3], maskImage.pixels[i + 3]);
    if (clipped.pixels[i + 3]) {
      assert.ok(clipped.pixels[i] <= 1);
      assert.ok(clipped.pixels[i + 1] <= 1);
      assert.equal(clipped.pixels[i + 2], 255);
    }
  }
  // Non-affine selections, painting, hit testing, clone snapshots and repair share inverse mapping.
  const paintDoc = fixture(),
    paint = layer("paint", 128, 96);
  paint.transform = structuredClone(baseLayer.transform);
  paintDoc.layers.push(paint);
  paintDoc.selection = {
    inverted: false,
    feather: 0,
    regions: [
      {
        kind: "rectangle",
        operation: "add",
        points: [
          { x: 40, y: 20 },
          { x: 80, y: 70 },
        ],
      },
    ],
  };
  await load(p, paintDoc, source);
  await p.getByRole("button", { name: "Brush tool", exact: true }).click();
  await tab(p, "Properties");
  await p.getByLabel("Brush size", { exact: true }).fill("20");
  await p.getByLabel("Brush hardness", { exact: true }).fill("100");
  await p.getByLabel("Brush color", { exact: true }).fill("#00ff00");
  await click(p, 40, 48);
  const painted = await raster(p);
  assert.ok(at(painted, 42, 48)[1] > 200);
  assert.deepEqual(at(painted, 35, 48), at(original, 35, 48));
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), original);
  await p.getByRole("button", { name: "Clone Stamp tool", exact: true }).click();
  await p.keyboard.down("Alt");
  await click(p, 100, 48);
  await p.keyboard.up("Alt");
  await p
    .getByText("Clone source captured from the visible composite at full document resolution.", {
      exact: true,
    })
    .waitFor();
  await p.waitForFunction(
    () => !document.querySelector('button[aria-label="Clone Stamp tool"]').disabled,
  );
  await click(p, 50, 48);
  const clone = await raster(p);
  for (let i = 0; i < 4; i++)
    assert.ok(Math.abs(at(clone, 50, 48)[i] - at(original, 100, 48)[i]) <= 3);
  const cloneFile = await native(p);
  assert.equal(
    cloneFile.value.document.layers.at(-1).strokes[0].clone.targetTransform.deform.kind,
    "perspective",
  );
  await imported(p, cloneFile.bytes);
  same(await raster(p), clone);
  console.log(
    "Non-affine mask/clipping alpha, selection-aware painting, inverse hit coordinates and clone snapshot/native fidelity passed.",
  );
  // Shape and text remain native editable objects while their pixels are deformed.
  const vector = fixture(),
    shape = layer("shape", 128, 96),
    text = layer("text", 128, 96);
  shape.fill = "#ff0000";
  shape.strokeWidth = 0;
  shape.transform = baseLayer.transform;
  text.text = "INK";
  text.fill = "#000000";
  text.strokeWidth = 0;
  text.fontSize = 28;
  text.transform = {
    ...TRANSFORM,
    deform: {
      kind: "warp",
      width: 128,
      height: 96,
      points: MESH.map((p, i) => ({ ...p, y: p.y + (i === 4 ? 0.1 : 0) })),
    },
  };
  vector.layers = [shape, text];
  await load(p, vector, source);
  const vectorImage = await raster(p);
  assert.ok(at(vectorImage, 64, 70)[0] > 240);
  const vectorFile = await native(p);
  assert.deepEqual(
    vectorFile.value.document.layers.map((l) => l.kind),
    ["shape", "text"],
  );
  assert.equal(vectorFile.value.document.layers[1].text, "INK");
  // Non-affine repair is sampled at document resolution and stored in the local editable paint layer.
  const repairSource = await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 96;
      const x = c.getContext("2d");
      x.fillStyle = "#708090";
      x.fillRect(0, 0, 128, 96);
      x.fillStyle = "#000000";
      x.fillRect(60, 44, 8, 8);
      return c.toDataURL().split(",")[1];
    }),
    repairDoc = fixture(),
    repairLayer = layer("paint", 128, 96);
  repairLayer.transform = baseLayer.transform;
  repairDoc.layers.push(repairLayer);
  await load(p, repairDoc, repairSource);
  await p.getByRole("button", { name: "Spot Healing Brush tool", exact: true }).click();
  await tab(p, "Properties");
  await p.getByLabel("Brush size", { exact: true }).fill("16");
  await p.getByLabel("Brush hardness", { exact: true }).fill("100");
  await click(p, 64, 48);
  await p
    .getByText("Repair complete at native resolution. Undo restores the previous artwork.", {
      exact: true,
    })
    .waitFor();
  const healed = await raster(p);
  assert.ok(at(healed, 64, 48)[0] > 80);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  assert.equal(at(await raster(p), 64, 48)[0], 0);
  console.log("Editable shape/text deformation and perspective-aware Spot Healing passed.");
  // Projected exports read native source pixels beyond the bounded 1400px preview.
  const wideSource = await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2000;
      c.height = 128;
      const x = c.getContext("2d");
      x.fillStyle = "#ab1234";
      x.fillRect(0, 0, 2000, 128);
      x.fillStyle = "#234567";
      x.fillRect(1800, 0, 200, 128);
      return c.toDataURL().split(",")[1];
    }),
    wide = fromPanel({ id: "wide", name: "Native transform resolution", width: 2000, height: 128 });
  wide.layers[0].transform = {
    ...TRANSFORM,
    deform: {
      kind: "warp",
      width: 2000,
      height: 128,
      points: MESH.map((p, i) => ({ ...p, x: p.x + (i === 4 ? 0.08 : 0) })),
    },
  };
  wide.crop = { x: 1850, y: 32, width: 128, height: 64, rotation: 0 };
  wide.imageSize = { width: 64, height: 32, resampling: "nearest" };
  await load(p, wide, wideSource);
  await p.waitForFunction(
    () => document.querySelector('canvas[aria-label="Pro composite preview"]').width === 1400,
  );
  const nativeWide = await raster(p);
  assert.equal(nativeWide.width, 64);
  assert.equal(nativeWide.height, 32);
  assert.deepEqual(at(nativeWide, 32, 16), [35, 69, 103, 255]);
  console.log("Warp plus crop/resampling reads 2000px native source data beyond the preview cap.");
  // Local save/reopen and explicit Chapter application preserve original accepted bytes.
  await load(p, fixture(), source);
  await begin(p);
  await p.getByLabel("Transform mode", { exact: true }).selectOption("warp");
  await p.getByLabel("Control 5 X", { exact: true }).fill("72");
  await apply(p).click();
  const finalImage = await raster(p);
  await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
  await p
    .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
      exact: true,
    })
    .waitFor();
  const accepted = (await records(p))[0];
  assert.equal(accepted.original.blobId, chapter.blobId);
  const originalBytes = await p.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const b = await new Promise((resolve) => {
      const r = db.transaction("blobs").objectStore("blobs").get(id);
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return [...new Uint8Array(await b.arrayBuffer())];
  }, accepted.original.blobId);
  assert.equal(Buffer.from(originalBytes).toString("base64"), source);
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p.getByRole("button", { name: "Open in Vector Studio", exact: true }).waitFor();
  await open(p, "Vector");
  same(await raster(p), finalImage);
  await context.close();
  console.log(
    "Local reopen, Raster/Vector switching and original-preserving Chapter application passed.",
  );
  for (const width of [320, 390]) {
    const c = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      }),
      p = await c.newPage();
    await start(p);
    await open(p);
    await pixel(p, 64, 48, [128, 96, 80, 255]);
    await begin(p);
    await p.getByLabel("Transform aspect lock", { exact: true }).uncheck();
    const touch = await c.newCDPSession(p),
      dragTouch = async (id, dx, dy) => {
        const b = await p.locator(`[data-transform-handle="${id}"]`).boundingBox(),
          x = b.x + b.width / 2,
          y = b.y + b.height / 2;
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 1 }],
        });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + dx, y: y + dy, id: 1 }],
        });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
    await dragTouch("se", -12, -8);
    assert.ok(Number(await p.getByLabel("Transform width", { exact: true }).inputValue()) < 128);
    assert.ok(Number(await p.getByLabel("Transform height", { exact: true }).inputValue()) < 96);
    const firstWidth = await p.getByLabel("Transform width", { exact: true }).inputValue(),
      r = await p.getByLabel("Pro editing viewport", { exact: true }).boundingBox(),
      cx = r.x + r.width / 2,
      cy = r.y + r.height / 2,
      scroll = await p.evaluate(() => scrollY);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: cx - 20, y: cy, id: 2 },
        { x: cx + 20, y: cy, id: 3 },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: cx - 30 + 3, y: cy + 4, id: 2 },
        { x: cx + 30 + 3, y: cy + 4, id: 3 },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(await p.getByLabel("Transform width", { exact: true }).inputValue(), firstWidth);
    assert.equal(await p.getByLabel("Pro zoom", { exact: true }).textContent(), "150%");
    assert.equal(await p.evaluate(() => scrollY), scroll);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `/workspace/screenshots/transform-mobile-${width}.png` });
    await apply(p).click();
    const scaled = await raster(p);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.notDeepEqual((await raster(p)).pixels, scaled.pixels);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    same(await raster(p), scaled);
    await p.getByRole("button", { name: "Fit Pro canvas", exact: true }).click();
    await begin(p);
    await p.getByLabel("Transform mode", { exact: true }).selectOption("perspective");
    await dragTouch("point-0", 8, 3);
    await apply(p).click();
    assert.equal((await native(p)).value.document.layers[0].transform.deform.kind, "perspective");
    await begin(p);
    await p.getByLabel("Transform mode", { exact: true }).selectOption("warp");
    await dragTouch("point-4", 5, 2);
    await apply(p).click();
    const warpFile = await native(p);
    assert.equal(warpFile.value.document.layers[0].transform.deform.kind, "warp");
    assert.ok(warpFile.value.document.layers[0].transform.deform.points[4].x > 0.5);
    await c.close();
    console.log(
      `Chromium ${width}px: touch scale/perspective/warp, pinch/pan, Apply/Cancel visibility, history/export and no scroll/overflow passed.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "affine matrices and independent Canvas reference",
        "numeric controls and pointer handles",
        "pivot and aspect modifiers",
        "homography raster output",
        "smooth Bézier warp pixels",
        "masks/clipping/selections/clone/repair",
        "editable shape/text",
        "native/history/Chapter fidelity",
        "320/390px native touch",
      ],
      physicalAndroid: false,
    }),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
}
