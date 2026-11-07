/** Actual UI, IndexedDB, source preservation, render pixels and export parity. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { encode } from "fast-png";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const built = process.argv.includes("--built"),
  useWebkit = process.argv.includes("--webkit");
await mkdir("/workspace/screenshots", { recursive: true });
await mkdir("/workspace/composition-evidence", { recursive: true });
const browser = await (useWebkit ? webkit : chromium).launch({
  headless: true,
  args: useWebkit ? [] : ["--no-sandbox"],
});
const errors = [],
  results = [];
function solid(name, color = [0, 0, 0], width = 800, height = 600) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) data.set(color, i);
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(encode({ width, height, data, channels: 3 })),
  };
}
async function create(page, files, title) {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByRole("button", { name: "Add images", exact: true }).waitFor();
  await page.locator("input[type=file][multiple]").first().setInputFiles(files);
  await page
    .getByRole("button", { name: `Display ${files.length}`, exact: true })
    .waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor({ timeout: 60000 });
}
async function attach(page) {
  await page.evaluate(async () => {
    const find = (path) =>
      performance
        .getEntriesByType("resource")
        .map((x) => x.name)
        .find((x) => new URL(x).pathname === path) ?? path;
    const state = (await import(find("/src/lib/studio/store.ts"))).useStudio;
    const chapter = state.getState().chapters.find((c) => location.pathname.endsWith(c.id)),
      panels = state.getState().panels.filter((p) => p.chapterId === chapter.id);
    const controllerUrl = find("/src/lib/studio/composition/controller.ts");
    const module = await import(controllerUrl);
    window.__composition = {
      controllerUrl,
      store: state,
      controller: module.getController(chapter, panels),
      chapterId: chapter.id,
      projectId: chapter.projectId,
    };
  });
}
const doc = (page) =>
  page.evaluate(() => window.__composition.controller.getState().history.present.document);
const ready = async (page) => {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".composition-tile")].length > 0 &&
      [...document.querySelectorAll(".composition-tile")].every(
        (c) => c.dataset.renderStatus === "ready",
      ),
    null,
    { timeout: 60000 },
  );
};
const saved = async (page) => {
  await page.waitForFunction(
    () => document.querySelector("[data-composition=studio]")?.dataset.saveStatus === "saved",
    null,
    { timeout: 30000 },
  );
};
const inspectErrors = (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  inspectErrors(page);
  const files = [
    {
      name: "01-murim.webp",
      mimeType: "image/webp",
      buffer: await readFile("public/gallery/murim-720.webp"),
    },
    {
      name: "02-night-forest.webp",
      mimeType: "image/webp",
      buffer: await readFile("public/gallery/horror-720.webp"),
    },
    solid("03-fade-calibration.png"),
  ];
  await create(page, files, "INFINITY REGRESSION OF A WARRIOR");
  if (!built) await attach(page);
  await page.getByRole("button", { name: "Focus panel 2", exact: true }).click();
  await page.getByRole("button", { name: "Previous panel", exact: true }).click();
  assert.match(await page.locator(".composition-focus-bar").innerText(), /01-murim/);
  await page.getByRole("button", { name: "Next panel", exact: true }).click();
  assert.match(await page.locator(".composition-focus-bar").innerText(), /02-night-forest/);
  await page.getByLabel("Top extension (px)", { exact: true }).fill("300");
  await page.getByLabel("Bottom extension (px)", { exact: true }).fill("500");
  await page.getByLabel("Bottom extension (px)", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await saved(page);
  await ready(page);
  await page.screenshot({ path: "/workspace/screenshots/composition-scenario-a.png" });
  if (!built) {
    const d = await doc(page);
    const second = await page.evaluate(
      () => window.__composition.controller.getState().history.present.order[1],
    );
    assert.equal(d.panels[second].top.height, 300);
    assert.equal(d.panels[second].bottom.height, 500);
  }
  await page.getByRole("button", { name: "Focus panel 3", exact: true }).click();
  await page.getByRole("button", { name: "Add bottom fade", exact: true }).click();
  assert.equal(await page.getByLabel("Fade length (px)", { exact: true }).inputValue(), "350");
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await saved(page);
  await ready(page);
  await page.screenshot({ path: "/workspace/screenshots/composition-desktop-spacing.png" });
  await page.getByRole("button", { name: "Manhwa SFX", exact: true }).click();
  await page
    .locator(".composition-preset-card")
    .filter({ has: page.getByText("Sharp Slash", { exact: true }) })
    .locator("button")
    .first()
    .click();
  await page.getByLabel("rotation", { exact: true }).fill("-20");
  await page.getByLabel("Y position", { exact: true }).fill("-150");
  await page.getByLabel("Y position", { exact: true }).press("Tab");
  await saved(page);
  if (!built) {
    // Locking is checked through actual pointer interaction.
    const before = await doc(page);
    const o = before.objects.at(-1);
    await page.getByLabel("Layer locked", { exact: true }).check();
    const box = await page.locator(".composition-object-outline").boundingBox();
    if (box) {
      const viewport = await page.locator(".composition-viewport").boundingBox();
      const x = box.x + box.width / 2,
        y = Math.max(
          viewport.y + 20,
          Math.min(box.y + box.height / 2, viewport.y + viewport.height - 20),
        );
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y + 40);
      await page.mouse.up();
    }
    assert.equal((await doc(page)).objects.at(-1).x, o.x);
    await page.getByRole("button", { name: "Unlock selected layer", exact: true }).click();
    await page.getByRole("button", { name: "Save SFX preset", exact: true }).click();
    await page.getByLabel("Preset name", { exact: true }).fill("Murim blade");
    await page.getByRole("button", { name: "Save preset", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Save composition preset", exact: true })
      .waitFor({ state: "hidden" });
    const rendering = await page.evaluate(async () => {
      const s = window.__composition,
        frame = s.controller.getState().history.present,
        all = s.store.getState().panels,
        panels = frame.order.map((id) => all.find((p) => p.id === id));
      const { renderRegion, RenderResources } =
        await import("/src/lib/studio/composition/render.ts");
      const { layout } = await import("/src/lib/studio/composition/model.ts");
      const { exportComposition } = await import("/src/lib/studio/composition/export.ts");
      const resources = new RenderResources(),
        scene = layout(frame.document, panels),
        calibration = scene.frames[2];
      const c = await renderRegion(
          frame.document,
          panels,
          { y: calibration.imageY, height: calibration.imageHeight },
          800,
          resources,
        ),
        ctx = c.getContext("2d");
      const samples = [0, 250, 425, 599].map((y) => [...ctx.getImageData(750, y, 1, 1).data]);
      const full = await renderRegion(
        frame.document,
        panels,
        { y: 0, height: scene.height },
        640,
        resources,
      );
      const fullData = full.getContext("2d").getImageData(0, 0, full.width, full.height).data;
      const segments = await exportComposition(frame.document, panels, {
        format: "image/png",
        width: 640,
        quality: 1,
        segmentHeight: 512,
        background: "transparent",
      });
      let row = 0,
        mismatch = 0,
        maxDiff = 0;
      for (const entry of segments) {
        const bitmap = await createImageBitmap(entry.blob),
          part = document.createElement("canvas");
        part.width = bitmap.width;
        part.height = bitmap.height;
        part.getContext("2d").drawImage(bitmap, 0, 0);
        const data = part.getContext("2d").getImageData(0, 0, part.width, part.height).data;
        for (let i = 0; i < data.length; i++) {
          const diff = Math.abs(data[i] - fullData[row * 640 * 4 + i]);
          if (diff > 2) mismatch++;
          maxDiff = Math.max(diff, maxDiff);
        }
        row += part.height;
        bitmap.close();
      }
      const gap = await renderRegion(
        frame.document,
        panels,
        { y: calibration.imageY - 150, height: 150 },
        800,
        resources,
      );
      const gapData = gap.getContext("2d").getImageData(0, 0, gap.width, gap.height).data;
      let ink = 0;
      for (let i = 0; i < gapData.length; i += 4)
        if (gapData[i] < 200 || gapData[i + 1] < 200 || gapData[i + 2] < 200) ink++;
      resources.clear();
      return {
        samples,
        mismatch,
        maxDiff,
        rows: row,
        total: full.height,
        segments: segments.length,
        gapInk: ink,
      };
    });
    await writeFile(
      "/workspace/composition-evidence/rendering-parity.json",
      JSON.stringify(rendering, null, 2),
    );
    assert.ok(rendering.samples[0][0] < 3, "source starts black");
    assert.ok(Math.abs(rendering.samples[2][0] - 128) < 4, "350px fade midpoint is gray");
    assert.ok(rendering.samples[3][0] > 252, "edge reaches white");
    assert.ok(rendering.gapInk > 100, "SFX ink remains visible above image bounds");
    assert.equal(rendering.rows, rendering.total);
    assert.ok(rendering.mismatch < 100, "segmented output matches full render");
    results.push({ workflow: "pixel/export parity", ...rendering });
    await page.getByRole("button", { name: "Undo composition", exact: true }).click();
    await page.getByRole("button", { name: "Redo composition", exact: true }).click();
    await saved(page);
  }
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".composition-viewport")?.scrollTop === 0,
  );
  assert.equal(await page.locator(".composition-panel-outline").count(), 0);
  assert.equal(await page.locator(".composition-gap-handle").count(), 0);
  await ready(page);
  assert.ok(
    await page.locator(".composition-tile").evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i + 3] && (pixels[i] < 200 || pixels[i + 1] < 200 || pixels[i + 2] < 200)) ink++;
      return ink > 1000;
    }),
    "reading preview starts with rendered chapter artwork",
  );
  await page.screenshot({ path: "/workspace/screenshots/composition-reading.png" });
  await page.getByRole("button", { name: "Exit reading preview", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Output width", { exact: true }).fill("640");
  await page.getByLabel("Segment height", { exact: true }).fill("512");
  const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
  await page.getByRole("button", { name: "Export images", exact: true }).click();
  const imageDownload = await downloadPromise;
  assert.ok(imageDownload.suggestedFilename().endsWith(".zip"));
  await imageDownload.saveAs("/workspace/composition-evidence/chapter-export.zip");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor();
  if (!built) {
    await attach(page);
    const restored = await doc(page);
    assert.equal(
      Object.values(restored.panels).some((p) => p.top.height === 300 && p.bottom.height === 500),
      true,
    );
    assert.equal(restored.objects.length, 1);
    assert.equal(
      await page.evaluate(
        () =>
          window.__composition.store
            .getState()
            .projects.find((p) => p.id === window.__composition.projectId).compositionPreferences
            .presets[0].name,
      ),
      "Murim blade",
    );
    results.push({ workflow: "A/B/C and refresh", restored: true });
  }
  await ready(page);
  await page.screenshot({ path: "/workspace/screenshots/composition-desktop.png" });
  // Existing navigation is still operational after composition edits.
  await page.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
  await page.locator("[data-composition=lettering]").waitFor();
  await page.getByRole("button", { name: "Images", exact: true }).click();
  await page.getByRole("button", { name: "Open in Raster Studio", exact: true }).waitFor();
  results.push({ workflow: "existing chapter navigation", passed: true });
  await context.close();
  for (const width of [360, 390, 430]) {
    const mobile = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: width === 430 ? 3 : 1,
    });
    const p = await mobile.newPage();
    inspectErrors(p);
    await create(p, [files[0], files[1]], `Mobile ${width}`);
    await p.getByRole("button", { name: "Tools", exact: true }).click();
    await p.getByRole("button", { name: "Focus panel 2", exact: true }).click();
    await p.getByRole("button", { name: "Close tools", exact: true }).waitFor({ state: "hidden" });
    await p.getByLabel("Bottom extension (px)", { exact: true }).fill("500");
    await p.getByLabel("Bottom extension (px)", { exact: true }).press("Tab");
    await p.getByRole("button", { name: "Add bottom fade", exact: true }).click();
    await p.getByLabel("Fade length (px)", { exact: true }).fill("350");
    await p.getByRole("button", { name: "Close properties", exact: true }).click();
    await p.getByRole("button", { name: "Return to Chapter", exact: true }).click();
    await saved(p);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await ready(p);
    await p.screenshot({ path: `/workspace/screenshots/composition-mobile-${width}.png` });
    if (!useWebkit && width === 390) {
      if (!built) await attach(p);
      const cdp = await mobile.newCDPSession(p),
        viewport = await p.locator(".composition-viewport").boundingBox(),
        handle = await p
          .getByRole("button", { name: "Drag fade length", exact: true })
          .boundingBox();
      assert.ok(handle.height >= 43, "touch fade handle remains 44 CSS px at fit zoom");
      const touch = (type, points) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })),
        });
      await touch("touchStart", [[handle.x + handle.width / 2, handle.y + handle.height / 2]]);
      await touch("touchMove", [[handle.x + handle.width / 2, handle.y + handle.height / 2 - 24]]);
      await touch("touchEnd", []);
      await saved(p);
      if (!built) {
        const changed = await doc(p);
        assert.ok(
          Object.values(changed.panels).some((p) => p.fades.some((f) => f.length !== 350)),
          "real touch drag updates fade length",
        );
      }
      const x = viewport.x + viewport.width / 2,
        y = viewport.y + 100;
      await touch("touchStart", [
        [x - 40, y],
        [x + 40, y],
      ]);
      await touch("touchMove", [
        [x - 60, y],
        [x + 60, y],
      ]);
      await touch("touchEnd", []);
      await p.waitForTimeout(100);
      if (!built)
        assert.ok(
          await p.evaluate(() => window.__composition.controller.getState().zoom > 1.2),
          "pinch gesture changes zoom",
        );
      const before = await p.locator(".composition-viewport").evaluate((el) => el.scrollTop);
      await touch("touchStart", [
        [x - 40, y],
        [x + 40, y],
      ]);
      await touch("touchMove", [
        [x - 40, y + 30],
        [x + 40, y + 30],
      ]);
      await touch("touchEnd", []);
      await p.waitForTimeout(100);
      const after = await p.locator(".composition-viewport").evaluate((el) => el.scrollTop);
      assert.ok(after < before - 5, "two-finger pan scrolls the canvas");
      await p.waitForTimeout(350);
      await touch("touchStart", [[x, y]]);
      await touch("touchEnd", []);
      await p.waitForTimeout(60);
      await touch("touchStart", [[x, y]]);
      await touch("touchEnd", []);
      await p.getByRole("button", { name: "Return to Chapter", exact: true }).waitFor();
      await p.waitForTimeout(350);
      await touch("touchStart", [[x, y]]);
      await p.waitForTimeout(600);
      await touch("touchEnd", []);
      await p.locator(".composition-context").waitFor();
      await p.getByRole("button", { name: "Close panel menu", exact: true }).click();
      results.push({
        workflow: "genuine touch fade drag, pinch zoom, two-finger pan, double-tap and long-press",
        width,
        passed: true,
      });
      await cdp.detach();
    }

    results.push({ workflow: "mobile Focus/spacing/fade", width, passed: true });
    await mobile.close();
  }
  if (!built) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      p = await c.newPage();
    inspectErrors(p);
    const many = Array.from({ length: 40 }, (_, i) =>
      solid(`${String(i + 1).padStart(2, "0")}-panel.png`, [i * 5, 35, 65], 400, 700),
    );
    await create(p, many, "Forty-panel chapter");
    await attach(p);
    await p.getByRole("button", { name: "Focus panel 2", exact: true }).click();
    await p.getByLabel("Top extension (px)", { exact: true }).fill("150");
    await p.getByRole("button", { name: "Return to Chapter", exact: true }).click();
    await p.getByRole("button", { name: "Spacing", exact: true }).click();
    await p.getByLabel("Default gap for new panels", { exact: true }).fill("200");
    await p.getByRole("button", { name: "Between panels · 0 px", exact: true }).click();
    await p.getByLabel("Height (chapter px)", { exact: true }).fill("200");
    await p.getByRole("button", { name: "Apply to all panels", exact: true }).click();
    await p.evaluate(async () => {
      const { fade } = await import("/src/lib/studio/composition/model.ts"),
        { sfx } = await import("/src/lib/studio/composition/library.ts"),
        c = window.__composition.controller,
        ids = c.getState().history.present.order;
      c.change((doc) => ({
        ...doc,
        panels: Object.fromEntries(
          Object.entries(doc.panels).map(([id, p], i) => [
            id,
            [2, 8, 20].includes(i) ? { ...p, fades: [fade()] } : p,
          ]),
        ),
        objects: [2, 10, 25].map((i, j) => ({
          ...sfx(["SWISH", "WHOOSH", "SLASH"][j]),
          owner: ids[i],
          y: -50,
          rotation: -15,
        })),
      }));
    });
    await saved(p);
    await p.locator(".composition-viewport").evaluate((el) => (el.scrollTop = 25000));
    await p.waitForTimeout(250);
    assert.ok((await p.locator(".composition-tile").count()) < 12);
    await p.reload();
    await p.getByRole("button", { name: "Composition & FX", exact: true }).click();
    await p.locator("[data-composition=studio]").waitFor();
    await attach(p);
    assert.equal(
      await p.evaluate(
        () => window.__composition.controller.getState().history.present.order.length,
      ),
      40,
    );
    const restored40 = await doc(p);
    assert.equal(restored40.objects.length, 3);
    assert.equal(Object.values(restored40.panels).filter((p) => p.fades.length === 1).length, 3);
    assert.ok(Object.values(restored40.panels).every((p) => p.after.height === 200));
    results.push({ workflow: "40-panel reload and viewport rendering", passed: true });
    await c.close();
  }
  assert.deepEqual(errors, [], "no uncaught page/console errors");
  await writeFile(
    "/workspace/composition-evidence/browser-results.json",
    JSON.stringify(
      { base, built, engine: useWebkit ? "webkit" : "chromium", results, errors },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  const debugPages = browser.contexts().flatMap((c) => c.pages());
  for (const p of debugPages) {
    try {
      await p.screenshot({ path: "/workspace/screenshots/composition-failure.png" });
      console.error(
        await p.evaluate(() => ({
          url: location.href,
          notices: [...document.querySelectorAll(".composition-notice")].map((x) => x.textContent),
          tiles: [...document.querySelectorAll(".composition-tile")].map((c) => ({
            status: c.dataset.renderStatus,
            width: c.width,
            height: c.height,
            style: c.getAttribute("style"),
          })),
          progress: document.querySelector(".composition-render-progress")?.textContent,
        })),
      );
    } catch {
      /* page closed */
    }
  }
  await writeFile(
    "/workspace/composition-evidence/browser-failure.json",
    JSON.stringify({ error: String(error), stack: error.stack, results, errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
