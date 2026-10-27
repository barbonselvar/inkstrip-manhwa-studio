import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { encode, decode } from "fast-png";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { processSmart } from "../src/lib/studio/pro/smart-filters.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  fx = proBrowserFixtures(base, errors),
  results = [];
let activePage;
const readyPreview = (p) =>
  p.waitForFunction(() => {
    const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
    return c?.width > 0 && c.height > 0 && c.getAttribute("aria-busy") === "false";
  });
const digest = (data) => createHash("sha256").update(data).digest("hex");
const rgba = (bytes) => {
  const p = decode(bytes);
  if (p.channels === 4) return p;
  assert.equal(p.channels, 3);
  const data = new Uint8ClampedArray(p.width * p.height * 4);
  for (let i = 0; i < p.width * p.height; i++) {
    data.set(p.data.subarray(i * 3, i * 3 + 3), i * 4);
    data[i * 4 + 3] = 255;
  }
  return { ...p, data };
};
async function exported(p) {
  await fx.tab(p, "Export");
  await p.getByLabel("Pro export format", { exact: true }).selectOption("image/png");
  const ev = p.waitForEvent("download"),
    start = performance.now();
  await p.getByRole("button", { name: /^Export composite ·/ }).click();
  const bytes = await readFile(await (await ev).path()),
    pixels = rgba(bytes);
  return {
    ...pixels,
    hash: digest(pixels.data),
    milliseconds: performance.now() - start,
    bytes: bytes.length,
  };
}
async function memory(p) {
  const session = await p.context().newCDPSession(p);
  await session.send("Performance.enable");
  const metrics = (await session.send("Performance.getMetrics")).metrics;
  await session.detach();
  return Object.fromEntries(
    metrics
      .filter((m) => ["JSHeapUsedSize", "JSHeapTotalSize", "Nodes"].includes(m.name))
      .map((m) => [m.name, m.value]),
  );
}
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  for (const view of process.argv.includes("--quick")
    ? [{ width: 1440, touch: false }]
    : [
        { width: 1440, touch: false },
        { width: 390, touch: true },
      ])
    for (const height of process.argv.includes("--quick") ? [1920] : [1920, 5000, 10000, 20000]) {
      const context = await browser.newContext({
          viewport: { width: view.width, height: 1000 },
          hasTouch: view.touch,
          isMobile: view.touch,
        }),
        p = await context.newPage();
      activePage = p;
      console.log(`Long page ${view.width}px / ${height}: start`);
      p.setDefaultTimeout(60000);
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      const data = new Uint8ClampedArray(1080 * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < 1080; x++) data.set([x % 251, y % 251, 75, 255], (y * 1080 + x) * 4);
      const bytes = Buffer.from(encode({ width: 1080, height, data })),
        originalHash = digest(data),
        name = `long-${height}.png`;
      await p.goto(base);
      await p.getByRole("button", { name: "New project", exact: true }).click();
      await p.getByPlaceholder("Night Market").fill("R10 long pages");
      await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
      await p.getByText("Chapter workspace", { exact: true }).waitFor();
      await p.getByText("Image limits on this device", { exact: true }).click();
      const cap = await p.locator(".image-capability-notice").innerText();
      assert.ok(cap.includes(view.touch ? "4MP" : "16.8MP"));
      const start = performance.now();
      await p
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name, mimeType: "image/png", buffer: bytes });
      await p.getByRole("button", { name: `Edit Image ${name}`, exact: true }).waitFor();
      const importMs = performance.now() - start;
      console.log(`Long page ${view.width}px / ${height}: imported`);
      await p.getByRole("button", { name: `Image options for ${name}`, exact: true }).click();
      await p
        .getByRole("dialog", { name: "Image tools", exact: true })
        .getByRole("button", { name: "Open in Raster Studio", exact: true })
        .click();
      const studio = p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }),
        supported = height <= 10000 && (!view.touch || height === 1920),
        openStart = performance.now();
      if (!supported) {
        await studio.locator(".pro-load-failed").waitFor();
        assert.equal(await studio.locator(".pro-artboard").count(), 0);
        assert.equal(await studio.locator(".pro-save-state").innerText(), "Not opened");
        const accepted = await fx.records(p);
        assert.equal(accepted.find((r) => r.name === name).height, height);
        await p.screenshot({
          path: `/workspace/screenshots/r10-long-${view.width}-${height}-refused.png`,
        });
        results.push({
          viewport: view.width,
          height,
          chapterImport: true,
          raster: "safely refused",
          sourceDimensionsRetained: true,
          importMs,
          openMs: performance.now() - openStart,
          memory: await memory(p),
        });
        await context.close();
        continue;
      }
      await readyPreview(p);
      const openMs = performance.now() - openStart;
      const initial = await exported(p);
      console.log(`Long page ${view.width}px / ${height}: initial export`);
      assert.equal(initial.width, 1080);
      assert.equal(initial.height, height);
      assert.equal(initial.hash, originalHash, "opening/export retains full original pixels");
      let painted = initial;
      await fx.tab(p, "Properties");
      await p.getByRole("button", { name: "Layer styles and Smart Filters", exact: true }).click();
      const lab = p.getByRole("dialog", { name: "Layer styles and Smart Filters", exact: true });
      await lab.getByRole("tab", { name: "Smart Filters", exact: true }).click();
      let tiledFilter = false;
      if (height === 1920) {
        await lab.getByLabel("Add Smart Filter", { exact: true }).selectOption("gaussian");
        await lab.getByLabel("Gaussian sigma", { exact: true }).fill("1");
        await lab.getByLabel("Gaussian sigma", { exact: true }).blur();
        await lab.getByRole("button", { name: "Apply layer properties", exact: true }).click();
        await lab.waitFor({ state: "hidden" });
        const filtered = await exported(p),
          expected = processSmart(new Uint8ClampedArray(painted.data), 1080, height, {
            kind: "gaussian",
            radius: 1,
          });
        const filteredNative = (await fx.native(p)).value;
        await writeFile(
          "/workspace/r10-evidence/d3-filter-target.json",
          JSON.stringify(
            filteredNative.document.layers.map((l) => ({
              kind: l.kind,
              strokes: l.strokes.length,
              filters: l.smartFilters,
            })),
          ),
        );
        assert.equal(
          filtered.hash,
          digest(expected),
          "tiled native renderer equals original whole-plane algorithm exactly",
        );
        painted = filtered;
        tiledFilter = true;
      } else {
        await lab
          .getByText(
            "Smart Filters support native source layers up to4MP. This layer was not resized.",
            { exact: true },
          )
          .waitFor();
        assert.equal(await lab.getByLabel("Add Smart Filter", { exact: true }).count(), 0);
        await lab.getByRole("button", { name: "Cancel layer properties", exact: true }).click();
      }
      const beforeZoom = await p.getByLabel("Pro zoom", { exact: true }).innerText();
      await p.getByRole("button", { name: "Pro zoom in", exact: true }).click();
      assert.notEqual(await p.getByLabel("Pro zoom", { exact: true }).innerText(), beforeZoom);
      await p.getByRole("button", { name: "Hand tool", exact: true }).click();
      const panBounds = await fx.artboardBounds(p),
        panBefore = await p.locator(".pro-artboard").evaluate((e) => e.style.transform),
        a = { x: panBounds.x + panBounds.width / 2, y: panBounds.y + panBounds.height / 2 },
        z = { x: a.x + 25, y: a.y + 20 };
      if (view.touch) {
        const cdp = await context.newCDPSession(p);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...a, id: 1 }],
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...z, id: 1 }],
        });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      } else {
        await p.mouse.move(a.x, a.y);
        await p.mouse.down();
        await p.mouse.move(z.x, z.y, { steps: 4 });
        await p.mouse.up();
      }
      assert.notEqual(
        await p.locator(".pro-artboard").evaluate((e) => e.style.transform),
        panBefore,
        "Hand tool pans long artwork without changing its pixels",
      );
      await p.getByRole("button", { name: "Fit Pro canvas", exact: true }).click();
      await p.getByRole("button", { name: "Brush tool", exact: true }).click();
      await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).click();
      const bounds = await fx.artboardBounds(p),
        point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        strokeStart = performance.now();
      if (view.touch) {
        const cdp = await context.newCDPSession(p);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ ...point, id: 1 }],
        });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      } else await p.mouse.click(point.x, point.y);
      await readyPreview(p);
      const brushMs = performance.now() - strokeStart;
      await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).click();
      const beforePaint = painted;
      painted = await exported(p);
      assert.notEqual(painted.hash, beforePaint.hash, "brush changes full-resolution artwork");
      console.log(`Long page ${view.width}px / ${height}: brush exported`);
      const native = (await fx.native(p)).value;
      console.log(
        "Brush layers:",
        native.document.layers.map((l) => ({
          kind: l.kind,
          name: l.name,
          strokes: l.strokes.length,
        })),
      );
      assert.equal(native.assets[native.document.source.assetId].data, bytes.toString("base64"));
      const saved = (await fx.native(p)).value;
      await p.getByText("Draft saved", { exact: true }).first().waitFor();
      await p.reload();
      await p.getByText("Chapter workspace", { exact: true }).waitFor();
      await p.getByRole("button", { name: `Image options for ${name}`, exact: true }).click();
      await p
        .getByRole("dialog", { name: "Image tools", exact: true })
        .getByRole("button", { name: "Open in Raster Studio", exact: true })
        .click();
      await readyPreview(p);
      assert.equal(
        (await exported(p)).hash,
        painted.hash,
        "save/reopen native full-resolution composite stays pixel exact",
      );
      assert.deepEqual((await fx.native(p)).value.document.layers, saved.document.layers);
      await p.screenshot({ path: `/workspace/screenshots/r10-long-${view.width}-${height}.png` });
      results.push({
        viewport: view.width,
        height,
        chapterImport: true,
        raster: true,
        zoomFit: true,
        pan: true,
        brush: true,
        tiledFilter,
        filterOver4MPRefused: height > 1920,
        saveReopen: true,
        sourceBytes: true,
        exportTolerance: 0,
        importMs,
        openMs,
        brushMs,
        exportMs: painted.milliseconds,
        encodedBytes: bytes.length,
        nativeRgbaBytes: 1080 * height * 4,
        memory: await memory(p),
      });
      await context.close();
    }
  assert.deepEqual(errors, []);
  const report = {
    results,
    errors,
    pixelTolerance: 0,
    physicalAndroid: false,
    timingScope:
      "Playwright-observed UI readiness, import and export; no full-preview pixel-array transport included",
    memoryMeasurement: "sampled Chromium JS heap, not GPU/process peak",
  };
  await writeFile(
    "/workspace/r10-evidence/long-page-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (activePage)
    await activePage
      .screenshot({ path: "/workspace/screenshots/r10-long-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
