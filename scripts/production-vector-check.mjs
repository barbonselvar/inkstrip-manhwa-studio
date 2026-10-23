/** Isolated browser release verification: all projects/artwork stay in this fresh browser's IndexedDB. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
const base = process.argv[2],
  expected = process.argv[3];
assert.ok(
  base &&
    ["inkstrip-manhwa-studio.vercel.app", "localhost", "127.0.0.1"].includes(
      new URL(base).hostname,
    ),
  "Explicit existing production or local QA domain only",
);
assert.match(expected ?? "", /^[a-f0-9]{40}$/i, "Supply the exact intended release SHA");
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
      : {}),
  }),
  errors = [],
  assets = [],
  results = [];
const {
  tab: rawTab,
  start,
  open,
  load: rawLoad,
  native: rawNative,
  raster: rawRaster,
  same,
  records,
  artboardBounds,
} = proBrowserFixtures(base, errors);
async function panels(p) {
  const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
}
async function tab(p, t) {
  await panels(p);
  return rawTab(p, t);
}
async function native(p) {
  await panels(p);
  return rawNative(p);
}
async function raster(p, mime) {
  await panels(p);
  return rawRaster(p, mime);
}
async function load(p, ...a) {
  await panels(p);
  return rawLoad(p, ...a);
}
const at = (im, x, y) => im.pixels.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4);
async function rasterRelease(p, width) {
  await panels(p);
  const gesture = async (cancel = false) => {
    const r = await artboardBounds(p),
      point = (x, y) => ({ x: r.x + (x / 128) * r.width, y: r.y + (y / 96) * r.height });
    const a = point(24, 24),
      b = point(76, 52);
    if (width === 1440) {
      await p.mouse.move(a.x, a.y);
      await p.mouse.down();
      await p.mouse.move(b.x, b.y, { steps: 8 });
      if (cancel) await p.keyboard.press("Escape");
      await p.mouse.up();
    } else {
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...a, id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...b, id: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: cancel ? "touchCancel" : "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    }
  };
  await p.getByRole("button", { name: "Rectangle selection tool", exact: true }).click();
  await gesture();
  await tab(p, "Refine");
  await p.getByLabel("Edge-aware color refinement", { exact: true }).uncheck();
  await p.getByLabel("Expand / contract pixels", { exact: true }).fill("2");
  await p.getByLabel("Refine feather", { exact: true }).fill("1");
  await p.getByRole("button", { name: "Preview refinement", exact: true }).click();
  await p.getByRole("button", { name: "Apply refinement", exact: true }).click();
  await p.getByLabel("Selection name", { exact: true }).fill("Release selection");
  await p.getByRole("button", { name: "Save selection", exact: true }).click();
  let n = await native(p);
  assert.equal(n.value.version, 5);
  assert.ok(n.value.document.selection.regions[0].pixels);
  assert.equal(n.value.document.savedSelections[0].name, "Release selection");
  await tab(p, "Properties");
  await p.getByLabel("Brush preset", { exact: true }).selectOption("Ink Pen");
  await p.getByLabel("Brush color", { exact: true }).fill("#d14b75");
  const beforeStroke = await raster(p);
  await gesture();
  const stroke = await raster(p);
  assert.notDeepEqual(stroke.pixels, beforeStroke.pixels);
  await p.getByRole("button", { name: "Pro undo", exact: true }).click();
  same(await raster(p), beforeStroke);
  await p.getByRole("button", { name: "Pro redo", exact: true }).click();
  same(await raster(p), stroke);
  await tab(p, "Properties");
  const maskSummary = p.locator("summary").filter({ hasText: /^Layer mask$/ });
  if (!(await maskSummary.locator("..").getAttribute("open"))) await maskSummary.click();
  await p.getByRole("button", { name: "Mask from selection", exact: true }).click();
  await p.getByLabel("Mask density", { exact: true }).fill("80");
  await p.getByLabel("Mask feather", { exact: true }).fill("1");
  const masked = await raster(p);
  n = await native(p);
  const painted = n.value.document.layers.find((l) => l.kind === "paint");
  assert.ok(painted?.strokes[0].dynamics);
  assert.equal(painted.mask.density, 0.8);
  assert.equal(painted.mask.feather, 1);
  await gesture(true);
  const cancelled = await native(p);
  assert.deepEqual(cancelled.value.document.layers, n.value.document.layers);
  await tab(p, "Assets");
  await p
    .getByLabel("Import Pro asset", { exact: true })
    .setInputFiles({
      name: "raster-release.inkstrip",
      mimeType: "application/json",
      buffer: n.bytes,
    });
  await p
    .getByText("Native document imported into this Pro draft. Chapter unchanged.", { exact: true })
    .waitFor();
  same(await raster(p), masked);
  for (const mime of ["image/jpeg", "image/webp"]) {
    const image = await raster(p, mime);
    assert.equal(image.width, 128);
    assert.equal(image.height, 96);
  }
  results.push({
    width,
    rasterRefinement: true,
    nativeV5: true,
    selectionSaved: true,
    realBrushStroke: true,
    maskProperties: true,
    historyPixels: true,
    strokeCancellation: true,
    pngJpegWebp: true,
  });
}
function watch(p) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("response", (r) => {
    const u = new URL(r.url());
    if (
      u.origin === new URL(base).origin &&
      r.status() >= 400 &&
      /\.(js|css|woff2?|wasm|png|svg)(?:\?|$)/.test(u.pathname)
    )
      assets.push({ url: u.pathname, status: r.status() });
  });
  p.on("requestfailed", (r) => {
    if (r.url().startsWith(base) && !r.failure()?.errorText.includes("ERR_ABORTED"))
      assets.push({ url: new URL(r.url()).pathname, error: r.failure()?.errorText });
  });
}
try {
  for (const width of [1440, 320, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: width < 500,
      isMobile: width < 500,
      acceptDownloads: true,
    });
    await context.addInitScript(() => {
      const stats = { draws: 0 };
      window.__inkstripReleaseQA = stats;
      for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"])
        if (window[name])
          for (const method of ["drawArrays", "drawElements"]) {
            const fn = window[name].prototype[method];
            window[name].prototype[method] = function (...a) {
              stats.draws++;
              return fn.apply(this, a);
            };
          }
    });
    const p = await context.newPage();
    p.setDefaultTimeout(30000);
    watch(p);
    const response = await p.goto(base);
    assert.equal(response.status(), 200);
    await p.getByRole("button", { name: "New project", exact: true }).waitFor();
    assert.equal(
      await p.locator('meta[name="inkstrip-release"]').getAttribute("content"),
      expected,
      "Live build matches merged main",
    );
    await p.locator("canvas.robot-companion-canvas").waitFor();
    await p.waitForFunction(() => window.__inkstripReleaseQA.draws > 0);
    const before = await p.evaluate(() => window.__inkstripReleaseQA.draws);
    await p.waitForFunction((n) => window.__inkstripReleaseQA.draws > n, before);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `/workspace/screenshots/ee-release-home-${width}.png` });
    const source = await start(p),
      original = (await records(p))[0];
    await open(p, "Vector");
    const d = fromPanel({ id: "release-qa", name: "Release QA", width: 128, height: 96 });
    d.layers[0].visible = false;
    const a = layer("shape", 32, 32, "back"),
      b = layer("shape", 32, 32, "front");
    for (const [i, l] of [a, b].entries()) {
      l.name = i ? "Front" : "Back";
      l.fill = "#ff0000";
      l.strokeWidth = 0;
      l.transform.x = 16 + i * 16;
      l.transform.y = 20;
      d.layers.push(l);
    }
    await load(p, d, source);
    await tab(p, "Layers");
    await p.getByLabel("Select layer Back", { exact: true }).check();
    await p.getByLabel("Select layer Front", { exact: true }).check();
    await tab(p, "Pathfinder");
    await p.getByRole("button", { name: "Pathfinder Unite", exact: true }).click();
    await p.getByText(/^Pathfinder unite: 1 editable object/).waitFor();
    let n = await native(p);
    assert.equal(n.value.document.layers.filter((l) => l.kind === "shape").length, 1);
    const union = await raster(p);
    assert.deepEqual(at(union, 24, 24), [255, 0, 0, 255]);
    assert.deepEqual(at(union, 60, 24), [255, 0, 0, 255]);
    assert.equal(at(union, 8, 24)[3], 0);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.equal(
      (await native(p)).value.document.layers.filter((l) => l.kind === "shape").length,
      2,
    );
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    await tab(p, "Artboards");
    await p.getByRole("button", { name: "New artboard", exact: true }).click();
    await p.getByLabel("Artboard name", { exact: true }).fill("Release board");
    await p.getByLabel("Artboard width", { exact: true }).fill("96");
    await p.getByLabel("Artboard height", { exact: true }).fill("64");
    await p.getByLabel("Artboard x", { exact: true }).fill("0");
    await p.getByLabel("Artboard y", { exact: true }).fill("0");
    await p.getByLabel("Artboard export format", { exact: true }).selectOption("image/png");
    let ev = p.waitForEvent("download");
    await p.getByRole("button", { name: "Export selected artboard", exact: true }).click();
    const board = await readFile(await (await ev).path());
    const dimensions = await p.evaluate(
      async (a) => {
        const b = await createImageBitmap(new Blob([Uint8Array.from(a)], { type: "image/png" }));
        const d = [b.width, b.height];
        b.close();
        return d;
      },
      [...board],
    );
    assert.deepEqual(dimensions, [96, 64]);
    await tab(p, "Appearance");
    await p.getByRole("button", { name: "Add fill", exact: true }).click();
    await p.getByLabel("Vector paint type", { exact: true }).selectOption("linear");
    const gradient = await raster(p);
    assert.notDeepEqual(gradient.pixels, union.pixels);
    await tab(p, "Typography");
    await p.getByRole("button", { name: "Create text on selected contour", exact: true }).click();
    await p.getByLabel("Path text content", { exact: true }).fill("Release");
    await p.getByLabel("Path text font size", { exact: true }).fill("12");
    n = await native(p);
    assert.equal(n.value.version, 4);
    assert.ok(n.value.document.layers.some((l) => l.textPath));
    assert.ok(n.value.document.layers.some((l) => l.appearance?.some((a) => a.paint.gradient)));
    assert.equal(n.value.document.artboards[0].name, "Release board");
    assert.equal(n.value.assets[n.value.document.source.assetId].data, source);
    await tab(p, "Export");
    ev = p.waitForEvent("download");
    await p.getByRole("button", { name: "Export SVG · vectors only", exact: true }).click();
    const svg = (await readFile(await (await ev).path())).toString();
    assert.match(svg, /<textPath/);
    assert.match(svg, /<linearGradient/);
    const composite = await raster(p);
    await tab(p, "Assets");
    await p
      .getByLabel("Import Pro asset", { exact: true })
      .setInputFiles({ name: "release.inkstrip", mimeType: "application/json", buffer: n.bytes });
    await p
      .getByText("Native document imported into this Pro draft. Chapter unchanged.", {
        exact: true,
      })
      .waitFor();
    same(composite, await raster(p));
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await p
      .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
      .waitFor();
    await p.reload();
    await open(p, "Vector");
    same(composite, await raster(p));
    assert.deepEqual((await records(p))[0], original);
    await p.getByRole("button", { name: "Raster", exact: true }).click();
    same(composite, await raster(p));
    if (process.argv.includes("--raster")) await rasterRelease(p, width);
    await tab(p, "AI tools");
    assert.ok(
      await p.getByRole("button", { name: "Apply + Swin2SR Enhance", exact: true }).isVisible(),
    );
    await p.getByRole("button", { name: "Vector", exact: true }).click();
    await p.getByRole("button", { name: "Apply to chapter", exact: true }).click();
    await p
      .getByText("Applied composite to chapter. Layers and original artwork remain recoverable.", {
        exact: true,
      })
      .waitFor();
    assert.equal((await records(p))[0].original.blobId, original.blobId);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `/workspace/screenshots/ee-release-editor-${width}.png` });
    results.push({
      width,
      release: expected,
      homepage3D: true,
      chapter: true,
      pathfinder: true,
      artboardExport: true,
      gradient: true,
      textPath: true,
      svg: true,
      nativeReopen: true,
      raster: true,
      aiControls: true,
      sourcePreserved: true,
    });
    await context.close();
  }
  if (process.argv.includes("--ai")) {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        acceptDownloads: true,
      }),
      p = await context.newPage();
    p.setDefaultTimeout(30000);
    watch(p);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    await p.getByRole("button", { name: "New project", exact: true }).click();
    await p.getByPlaceholder("Night Market").fill("Release AI QA");
    await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
    const data = await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 24;
      const x = c.getContext("2d");
      x.fillStyle = "#c95880";
      x.fillRect(0, 0, 16, 24);
      x.fillStyle = "#213654";
      x.fillRect(4, 4, 8, 16);
      return c.toDataURL().split(",")[1];
    });
    await p
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "release-ai.png",
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      });
    await p.getByRole("button", { name: "AI Enhance release-ai.png", exact: true }).click();
    await p.getByRole("button", { name: "Enhance image", exact: true }).click();
    await p.locator(".ai-message").waitFor({ state: "visible", timeout: 240000 });
    assert.match(await p.locator(".ai-message").innerText(), /Ready to compare/);
    const size = await p
      .getByAltText("AI enhanced artwork", { exact: true })
      .evaluate(async (i) => {
        await i.decode();
        return [i.naturalWidth, i.naturalHeight];
      });
    assert.deepEqual(size, [32, 48]);
    results.push({ realSwin2SRInference: true, input: [16, 24], output: size });
    await p.screenshot({ path: "/workspace/screenshots/ee-release-ai.png" });
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(assets, []);
  console.log(
    JSON.stringify(
      {
        base,
        expected,
        chromium: browser.version(),
        results,
        errors,
        failedCriticalAssets: assets,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
