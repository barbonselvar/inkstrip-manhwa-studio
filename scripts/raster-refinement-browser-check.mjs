import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { appearanceItem } from "../src/lib/studio/pro/vector-appearance.ts";
import { maskFromSelection } from "../src/lib/studio/pro/masks.ts";
import { DAB_DEFAULTS } from "../src/lib/studio/pro/brush-dynamics.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [];
const { start, open, tab, load, native, raster, preview, same, artboardBounds } =
  proBrowserFixtures(base, errors);
const selection = (x = 32, y = 16, w = 32, h = 32) => ({
  regions: [
    {
      kind: "rectangle",
      operation: "add",
      points: [
        { x, y },
        { x: x + w, y: y + h },
      ],
    },
  ],
  inverted: false,
  feather: 0,
});
const solid = (id, color = "#ff0000") => {
  const l = layer("shape", 128, 96, id);
  l.fill = color;
  l.strokeWidth = 0;
  return l;
};
const alpha = (image, x, y) => image.pixels[(y * image.width + x) * 4 + 3];
async function props(p) {
  await tab(p, "Properties");
  const summary = p.locator("summary").filter({ hasText: /^Layer mask$/ });
  if ((await summary.count()) && !(await summary.locator("..").getAttribute("open")))
    await summary.click();
}
async function undo(p) {
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  await preview(p);
}
async function redo(p) {
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  await preview(p);
}
async function touch(p, from, to, cancel = false) {
  const r = await artboardBounds(p),
    q = (v) => ({ x: r.x + (v.x / 128) * r.width, y: r.y + (v.y / 96) * r.height });
  const cdp = await p.context().newCDPSession(p),
    a = q(from),
    b = q(to);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...a, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...b, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", {
    type: cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}
try {
  for (const width of [1440, 320, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 1440 ? 1000 : 844 },
        hasTouch: width !== 1440,
        isMobile: width !== 1440,
      }),
      p = await context.newPage();
    const source = await start(p);
    await open(p);
    if (
      (await p.getByRole("button", { name: "Toggle Pro panels" }).getAttribute("aria-expanded")) ===
      "false"
    )
      await p.getByRole("button", { name: "Toggle Pro panels" }).click();
    let d = fromPanel({ id: "p", name: "Raster refinement fixture", width: 128, height: 96 });
    d.layers = [];
    d.selection = selection();
    const l = solid("shape");
    d.layers.push(l);
    await load(p, d, source);
    await preview(p);
    await tab(p, "Refine");
    await p.getByLabel("Edge-aware color refinement", { exact: true }).uncheck();
    await p.getByLabel("Expand / contract pixels", { exact: true }).fill("3");
    await p.getByRole("button", { name: "Preview refinement", exact: true }).click();
    await p
      .getByRole("button", { name: "Apply refinement", exact: true })
      .waitFor({ state: "visible" });
    await p.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find(
          (e) => e.textContent === "Apply refinement",
        )?.disabled,
    );
    // Preview has no history/document mutation; Cancel restores exact selection.
    await p.getByRole("button", { name: "Cancel refinement", exact: true }).click();
    let saved = await native(p);
    assert.deepEqual(saved.value.document.selection, d.selection);
    await tab(p, "Refine");
    await p.getByLabel("Edge-aware color refinement", { exact: true }).uncheck();
    await p.getByLabel("Expand / contract pixels", { exact: true }).fill("3");
    await p.getByRole("button", { name: "Preview refinement", exact: true }).click();
    await p.getByRole("button", { name: "Apply refinement", exact: true }).click();
    await p.getByLabel("Selection name", { exact: true }).fill("Hair boundary");
    await p.getByRole("button", { name: "Save selection", exact: true }).click();
    saved = await native(p);
    assert.equal(saved.value.version, 5);
    assert.equal(saved.value.document.savedSelections[0].name, "Hair boundary");
    const r = saved.value.document.selection.regions[0];
    assert.equal(r.kind, "pixels");
    const coverage = new Uint8Array(128 * 96);
    for (let i = 0; i < r.pixels.runs.length; i += 3)
      coverage.fill(
        r.pixels.runs[i + 2],
        r.pixels.runs[i],
        r.pixels.runs[i] + r.pixels.runs[i + 1],
      );
    assert.equal(coverage[16 * 128 + 29], 255);
    assert.equal(coverage[16 * 128 + 28], 0);
    // On-canvas samples use the worker's native-resolution composite.
    await tab(p, "Refine");
    await p.getByRole("button", { name: "Sample foreground from canvas", exact: true }).click();
    const sampleBounds = await artboardBounds(p);
    await p.mouse.click(
      sampleBounds.x + (60 / 128) * sampleBounds.width,
      sampleBounds.y + (40 / 96) * sampleBounds.height,
    );
    await p.getByText("Reference color sampled at native resolution.", { exact: true }).waitFor();
    assert.equal(
      await p.getByLabel("foreground reference color", { exact: true }).inputValue(),
      "#ff0000",
    );
    // Masking a small editing frame must preserve its outside vector stroke.
    d = fromPanel({ id: "p", name: "Mask overflow", width: 128, height: 96 });
    const vector = layer("shape", 20, 20, "outside");
    vector.transform.x = 40;
    vector.transform.y = 30;
    const fill = appearanceItem("fill", vector, "fill"),
      stroke = appearanceItem("stroke", vector, "stroke");
    fill.paint = { color: "#ff0000" };
    stroke.paint = { color: "#0000ff" };
    stroke.width = 10;
    stroke.alignment = "outside";
    vector.appearance = [fill, stroke];
    vector.mask = maskFromSelection({ regions: [], inverted: true, feather: 0 }, vector, d);
    d.layers = [vector];
    await load(p, d, source);
    const outside = await raster(p);
    assert.equal(alpha(outside, 35, 40), 255);
    assert.equal(outside.pixels[(40 * 128 + 35) * 4 + 2], 255);
    await props(p);
    await p.getByLabel("Enable layer mask", { exact: true }).uncheck();
    same(await raster(p), outside);
    await tab(p, "Refine");
    await p.getByLabel("Selection preview", { exact: true }).selectOption("mask");
    const maskView = await p
      .locator('canvas[aria-label="Selected coverage preview"]')
      .evaluate((c) => [...c.getContext("2d").getImageData(0, 0, 1, 1).data]);
    assert.deepEqual(maskView, [0, 0, 0, 255]);
    await p.getByLabel("Selection preview", { exact: true }).selectOption("overlay");
    // Strong non-uniform rotation needs an exact inverse, not a bounded QR skew.
    d = fromPanel({ id: "p", name: "Affine mask", width: 128, height: 96 });
    const affineShape = layer("shape", 20, 20, "affine-mask");
    affineShape.fill = "#ff0000";
    affineShape.strokeWidth = 0;
    affineShape.transform = { x: 40, y: 0, scaleX: 10, scaleY: 1, rotation: 45 };
    d.layers = [affineShape];
    await load(p, d, source);
    const affineBefore = await raster(p);
    await p.getByRole("button", { name: "Select all", exact: true }).click();
    await props(p);
    await p.getByRole("button", { name: "Mask from selection", exact: true }).click();
    same(await raster(p), affineBefore);
    const affineNative = await native(p);
    assert.ok(Array.isArray(affineNative.value.document.layers[0].mask.placement));
    // Painting a linked perspective mask must clip in document coordinates.
    d = fromPanel({ id: "p", name: "Perspective mask clip", width: 128, height: 96 });
    const warped = layer("paint", 128, 96, "warped-mask");
    warped.strokes = [
      {
        points: [{ x: 64, y: 48 }],
        size: 80,
        hardness: 1,
        opacity: 1,
        flow: 1,
        color: "#ff0000",
        erase: false,
      },
    ];
    warped.mask = maskFromSelection({ regions: [], inverted: true, feather: 0 }, warped, d);
    warped.transform.deform = {
      kind: "perspective",
      width: 128,
      height: 96,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.6, y: 1 },
        { x: 0, y: 1 },
      ],
    };
    d.layers = [warped];
    d.selection = selection(54, 0, 20, 96);
    await load(p, d, source);
    const warpedBefore = await raster(p);
    await props(p);
    await p.getByLabel("Brush preset", { exact: true }).selectOption("Hard Round Brush");
    await p.getByLabel("Paint layer mask", { exact: true }).check();
    await p.getByRole("button", { name: "Eraser tool", exact: true }).click();
    const warpBounds = await artboardBounds(p);
    if (width === 1440) {
      await p.mouse.move(
        warpBounds.x + (20 / 128) * warpBounds.width,
        warpBounds.y + (48 / 96) * warpBounds.height,
      );
      await p.mouse.down();
      await p.mouse.move(
        warpBounds.x + (100 / 128) * warpBounds.width,
        warpBounds.y + (48 / 96) * warpBounds.height,
        { steps: 12 },
      );
      await p.mouse.up();
    } else await touch(p, { x: 20, y: 48 }, { x: 100, y: 48 });
    const warpedAfter = await raster(p);
    assert.notDeepEqual(warpedAfter.pixels, warpedBefore.pixels);
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 128; x++)
        if (x < 50 || x > 78)
          assert.ok(
            Math.abs(alpha(warpedBefore, x, y) - alpha(warpedAfter, x, y)) <= 1,
            `Perspective mask edit escaped selection at ${x},${y}`,
          );
    const warpNative = await native(p),
      clipFrame = warpNative.value.document.layers[0].mask.strokes[0].clip.frame;
    assert.ok(clipFrame.matrix);
    assert.equal(clipFrame.transform.deform.kind, "perspective");
    // Mask density, feather, inversion, placement and native/export fidelity.
    d = fromPanel({ id: "p", name: "Masks", width: 128, height: 96 });
    d.layers = [];
    const masked = solid("masked");
    masked.mask = {
      enabled: true,
      density: 0.5,
      feather: 0,
      selection: selection(32, 0, 32, 96),
      strokes: [],
    };
    d.layers = [masked];
    await load(p, d, source);
    let image = await raster(p);
    assert.equal(alpha(image, 10, 40), 128);
    assert.equal(alpha(image, 40, 40), 255);
    await props(p);
    await p.getByLabel("Mask feather", { exact: true }).fill("2");
    image = await raster(p);
    assert.ok(alpha(image, 31, 40) > 128 && alpha(image, 31, 40) < 255);
    saved = await native(p);
    assert.equal(saved.value.document.layers[0].mask.feather, 2);
    await tab(p, "Assets");
    await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
      name: "reopen.inkstrip",
      mimeType: "application/json",
      buffer: saved.bytes,
    });
    await p
      .getByText("Native document imported into this Pro draft. Chapter unchanged.", {
        exact: true,
      })
      .waitFor();
    same(await raster(p), image);
    await props(p);
    await p.getByRole("button", { name: "Unlink mask from layer", exact: true }).click();
    await p.getByLabel("Object x", { exact: true }).fill("10");
    image = await raster(p);
    assert.ok(alpha(image, 40, 40) > 240);
    assert.ok(alpha(image, 72, 40) < 140);
    await props(p);
    await p.getByRole("button", { name: "Link mask to layer", exact: true }).click();
    same(await raster(p), image);
    // Group masks composite once before group opacity, including full native export.
    d = fromPanel({ id: "p", name: "Group mask", width: 128, height: 96 });
    const g = layer("group", 128, 96, "group"),
      a = solid("a"),
      b = solid("b", "#0000ff");
    a.parentId = b.parentId = g.id;
    g.opacity = 0.5;
    g.mask = { enabled: true, selection: selection(32, 0, 32, 96), strokes: [] };
    d.layers = [g, a, b];
    await load(p, d, source);
    image = await raster(p);
    assert.equal(alpha(image, 10, 40), 0);
    assert.equal(alpha(image, 40, 40), 128);
    assert.equal(image.pixels[(40 * 128 + 40) * 4 + 2], 255);
    // Recorded dynamics are identical through actual native reopen and raster export.
    d = fromPanel({ id: "p", name: "Dabs", width: 128, height: 96 });
    d.layers = [];
    const paint = layer("paint", 128, 96, "paint");
    paint.strokes = [
      {
        points: [
          { x: 20, y: 45, pressure: 0.3, time: 10 },
          { x: 100, y: 45, pressure: 1, time: 100 },
        ],
        size: 18,
        hardness: 0.7,
        opacity: 0.8,
        flow: 0.4,
        color: "#ff0000",
        erase: false,
        sizePressure: true,
        dynamics: {
          ...DAB_DEFAULTS,
          scatter: 0.5,
          sizeJitter: 0.4,
          opacityJitter: 0.2,
          roundness: 0.5,
          angle: 30,
          opacityPressure: true,
        },
        seed: 123,
      },
    ];
    d.layers = [paint];
    await load(p, d, source);
    image = await raster(p);
    assert.ok(image.pixels.some((v, i) => i % 4 === 3 && v > 0));
    assert.ok(
      image.pixels.every((v, i) => i % 4 !== 3 || v <= 205),
      "Stroke opacity caps accumulated flow",
    );
    saved = await native(p);
    assert.equal(saved.value.version, 5);
    await tab(p, "Assets");
    await p
      .getByLabel("Import Pro asset", { exact: true })
      .setInputFiles({ name: "dabs.inkstrip", mimeType: "application/json", buffer: saved.bytes });
    await p
      .getByText("Native document imported into this Pro draft. Chapter unchanged.", {
        exact: true,
      })
      .waitFor();
    same(await raster(p), image);
    // Bake a paint mask; Undo must restore the editable strokes and source texture.
    d.layers[0].mask = {
      enabled: true,
      density: 0.6,
      feather: 1,
      selection: selection(40, 0, 30, 96),
      strokes: [],
    };
    await load(p, d, source);
    const beforeBake = await raster(p);
    await props(p);
    await p.getByRole("button", { name: "Bake layer and mask (destructive)", exact: true }).click();
    await p
      .getByText("Layer and mask baked. Undo and the retained original artwork are available.", {
        exact: true,
      })
      .waitFor();
    same(await raster(p), beforeBake);
    saved = await native(p);
    assert.equal(saved.value.document.layers[0].mask, undefined);
    assert.equal(saved.value.document.layers[0].kind, "raster");
    assert.ok(saved.value.document.source);
    await undo(p);
    same(await raster(p), beforeBake);
    saved = await native(p);
    assert.ok(saved.value.document.layers[0].mask);
    await redo(p);
    same(await raster(p), beforeBake);
    const webp = await raster(p, "image/webp"),
      jpeg = await raster(p, "image/jpeg");
    assert.equal(webp.width, 128);
    assert.equal(jpeg.height, 96);
    assert.equal(alpha(jpeg, 0, 0), 255);
    // Real touch drawing and cancellation in the same engine, on both small viewports.
    if (width !== 1440) {
      d = fromPanel({ id: "p", name: "Touch dabs", width: 128, height: 96 });
      d.layers = [layer("paint", 128, 96, "touch")];
      await load(p, d, source);
      await props(p);
      await p.getByLabel("Brush preset", { exact: true }).selectOption("Hard Round Brush");
      await p.getByRole("button", { name: "Brush tool", exact: true }).click();
      const beforeTouch = await native(p);
      await touch(p, { x: 30, y: 30 }, { x: 80, y: 35 }, true);
      saved = await native(p);
      assert.deepEqual(saved.value.document.layers, beforeTouch.value.document.layers);
      await touch(p, { x: 30, y: 30 }, { x: 80, y: 35 });
      image = await raster(p);
      assert.ok(alpha(image, 50, 32) > 0);
      await undo(p);
      image = await raster(p);
      assert.equal(alpha(image, 50, 32), 0);
    }
    if (width !== 1440) {
      await props(p);
      await p.getByRole("button", { name: "Mask from selection", exact: true }).click();
      const beforeMaskTouch = await native(p);
      await touch(p, { x: 30, y: 30 }, { x: 80, y: 35 }, true);
      const cancelled = await native(p);
      assert.deepEqual(cancelled.value.document.layers, beforeMaskTouch.value.document.layers);
      await touch(p, { x: 30, y: 30 }, { x: 80, y: 35 });
      const painted = await native(p);
      assert.equal(painted.value.document.layers[0].mask.strokes.length, 1);
      await undo(p);
      const unpainted = await native(p);
      assert.equal(unpainted.value.document.layers[0].mask.strokes.length, 0);
    }
    await props(p);
    await p.getByLabel("Brush preset", { exact: true }).selectOption("Eraser");
    await p.getByLabel("Brush preset", { exact: true }).selectOption("Pencil");
    await p.getByLabel("Brush preset", { exact: true }).selectOption("Hard Round Brush");
    const roundPreset = await native(p);
    assert.equal(roundPreset.value.document.brushSettings.tip, "round");
    await props(p);
    await p.getByLabel("Brush preset", { exact: true }).selectOption("Eraser");
    p.once("dialog", (dialog) => dialog.accept("Saved eraser"));
    await p.getByRole("button", { name: "Save current preset", exact: true }).click();
    await p.getByLabel("Brush preset", { exact: true }).selectOption("Hard Round Brush");
    await p.getByLabel("Brush preset", { exact: true }).selectOption("Saved eraser");
    assert.equal(
      await p
        .getByRole("button", { name: "Eraser tool", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await tab(p, "Refine");
    await p.screenshot({ path: `/workspace/screenshots/ee-raster-${width}.png` });
    results.push({
      width,
      refinement: "staged and committed",
      maskDensityFeather: "pixel verified",
      maskLinkage: "world-stable",
      groupMask: "isolated alpha",
      native: "v5 round trip",
      brush: "deterministic",
      bake: "same pixels and undo/redo",
      exports: "PNG/JPEG/WebP",
      touch: width === 1440 ? "not requested" : "cancel/draw/undo",
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
