/** Original fixtures in isolated browser profiles. Source hooks require the local dev server. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { encode } from "fast-png";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
await mkdir("/workspace/advanced-evidence", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [];
const ready = async (p) =>
  p.waitForFunction(
    () => document.querySelector(".composition-tile")?.dataset.renderStatus === "ready",
    null,
    { timeout: 90000 },
  );
const saved = async (p) =>
  p.waitForFunction(
    () => document.querySelector("[data-composition=studio]")?.dataset.saveStatus === "saved",
    null,
    { timeout: 30000 },
  );
async function attach(p) {
  await p.evaluate(async () => {
    const find = (path) =>
      performance
        .getEntriesByType("resource")
        .map((x) => x.name)
        .find((x) => new URL(x).pathname === path) ?? path;
    const { useStudio } = await import(find("/src/lib/studio/store.ts")),
      state = useStudio.getState(),
      chapter = state.chapters.find((c) => location.pathname.endsWith(c.id)),
      panels = state.panels
        .filter((p) => p.chapterId === chapter.id)
        .sort((a, b) => a.order - b.order);
    const { getController } = await import(find("/src/lib/studio/composition/controller.ts"));
    window.advanced = {
      store: useStudio,
      chapter,
      panels,
      controller: getController(chapter, panels),
    };
  });
}
async function create(p) {
  await p.addInitScript(() => performance.setResourceTimingBufferSize(10000));
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByLabel("Project title").fill("Organic fades QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByRole("button", { name: "Add images", exact: true }).waitFor();
  await p
    .locator("input[type=file][multiple]")
    .first()
    .setInputFiles([
      {
        name: "murim.webp",
        mimeType: "image/webp",
        buffer: await readFile("public/gallery/murim-720.webp"),
      },
      {
        name: "forest.webp",
        mimeType: "image/webp",
        buffer: await readFile("public/gallery/horror-720.webp"),
      },
    ]);
  await p.getByRole("button", { name: "Display 2", exact: true }).waitFor();
  await p.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await p.locator("[data-composition=studio]").waitFor();
  await attach(p);
}
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    p = await context.newPage();
  await create(p);
  await p.getByRole("button", { name: "Focus panel 1", exact: true }).click();
  await p.getByLabel("Top extension (px)", { exact: true }).fill("300");
  await p.getByRole("button", { name: "Fades & Transitions", exact: true }).click();
  assert.equal(await p.locator(".composition-shape-card").count(), 9);
  await p
    .getByRole("button", { name: "Wave Editable mask · instant preview", exact: true })
    .click();
  await p.getByLabel("Shape height (px)", { exact: true }).fill("140");
  await p.getByRole("button", { name: "Fit screen", exact: true }).click();
  await ready(p);
  const beforePosition = await p.locator(".composition-tile").evaluate((c) => {
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 64) hash = (Math.imul(hash, 31) + data[i]) >>> 0;
    return hash;
  });
  await p.getByLabel("Fade position (px)", { exact: true }).fill("60");
  await p.waitForFunction(
    (before) => {
      const c = document.querySelector(".composition-tile");
      if (c?.dataset.renderStatus !== "ready") return false;
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 64) hash = (Math.imul(hash, 31) + data[i]) >>> 0;
      return hash !== before;
    },
    beforePosition,
    { timeout: 90000 },
  );
  await p.screenshot({ path: "/workspace/screenshots/advanced-fade-gallery.png" });
  await p.getByLabel("Boundary shape", { exact: true }).selectOption("Bezier");
  await ready(p);
  const handle = p.locator('[data-boundary-handle="1"]'),
    r = await handle.boundingBox();
  assert.ok(r);
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await p.mouse.down();
  await p.mouse.move(r.x + r.width / 2 + 20, r.y + r.height / 2 - 15, { steps: 6 });
  await p.mouse.up();
  let points = await p.evaluate(() => {
    const s = window.advanced;
    return s.controller.getState().history.present.document.panels[s.panels[0].id].fades[0].boundary
      .points;
  });
  assert.notEqual(points[1].x, 0.3);
  await p.getByLabel("Boundary shape", { exact: true }).selectOption("Freehand");
  await p.getByRole("button", { name: "Draw boundary on canvas", exact: true }).click();
  const svg = p.locator('[data-boundary-editor="Freehand"]'),
    rect = await svg.boundingBox();
  await p.mouse.move(rect.x + rect.width * 0.05, rect.y + rect.height * 0.77);
  await p.mouse.down();
  for (let i = 1; i < 16; i++)
    await p.mouse.move(
      rect.x + rect.width * (0.05 + i * 0.06),
      rect.y + rect.height * (0.77 + Math.sin(i) * 0.025),
    );
  await p.mouse.up();
  await saved(p);
  const drawn = await p.evaluate(() => {
    const s = window.advanced;
    return s.controller.getState().history.present.document.panels[s.panels[0].id].fades[0].boundary
      .points.length;
  });
  assert.ok(drawn > 8);
  await p.getByRole("button", { name: "Undo composition", exact: true }).click();
  assert.equal(
    await p.evaluate(() => {
      const a = window.advanced;
      return a.controller.getState().history.present.document.panels[a.panels[0].id].fades[0]
        .boundary.points.length;
    }),
    4,
  );
  await p.getByRole("button", { name: "Redo composition", exact: true }).click();

  await p.screenshot({ path: "/workspace/screenshots/advanced-freehand.png" });
  // Save a shaped fade using the existing reusable preset workflow.
  await p.getByText("Advanced fade settings", { exact: true }).click();
  await p.getByRole("button", { name: "Save fade preset", exact: true }).click();
  await p.getByLabel("Preset name", { exact: true }).fill("Organic forest");
  await p.getByRole("button", { name: "Save preset", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Save composition preset", exact: true })
    .waitFor({ state: "hidden" });
  await p.getByRole("button", { name: "Manhwa SFX", exact: true }).click();
  assert.equal(await p.locator(".composition-shape-card").count(), 23);
  await p.getByRole("button", { name: "Sword Swing 슉 · SWISH", exact: true }).click();
  await p.getByLabel("Y position", { exact: true }).fill("-80");
  await p.getByLabel("rotation", { exact: true }).fill("-18");
  await saved(p);
  await ready(p);
  await p.screenshot({ path: "/workspace/screenshots/advanced-manhwa-gallery.png" });
  // SVG contains executable and external content which must never survive sanitation.
  await p.getByRole("tab", { name: "My Assets", exact: true }).click();
  await p.getByRole("button", { name: "Import SFX artwork", exact: true }).click();
  const unsafe =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 100" onload="alert(1)"><script>alert(1)</script><image href="https://example.invalid/tracker.png"/><path d="M10 20 L220 10 L160 50 L220 80 L10 90 L70 50 Z" fill="#111" stroke="#fff" stroke-width="6"/></svg>';
  await p.getByLabel("SFX file", { exact: true }).setInputFiles({
    name: "original-slash.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(unsafe),
  });
  await p.getByLabel("Asset category name", { exact: true }).fill("Sword Swing");
  await p.getByRole("img", { name: "SFX transparency preview", exact: true }).waitFor();
  await p.getByRole("button", { name: "Save asset and insert", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Import SFX artwork", exact: true })
    .waitFor({ state: "hidden" });
  await saved(p);
  assert.ok(
    await p
      .getByRole("button", { name: "original-slash Sword Swing · reusable artwork", exact: true })
      .count(),
  );

  const pixels = new Uint8Array(120 * 60 * 4);
  for (let y = 10; y < 50; y++)
    for (let x = 20; x < 100; x++) {
      const n = (y * 120 + x) * 4;
      pixels[n] = 15;
      pixels[n + 1] = 15;
      pixels[n + 2] = 15;
      pixels[n + 3] = 255;
    }
  const png = Buffer.from(encode({ width: 120, height: 60, data: pixels, channels: 4 }));
  const webp = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 60;
    const x = c.getContext("2d");
    x.fillStyle = "white";
    x.fillRect(0, 0, 120, 60);
    x.fillStyle = "black";
    x.fillRect(20, 10, 80, 40);
    return c.toDataURL("image/webp");
  });
  for (const [mime, name, buffer] of [
    ["image/png", "transparent.png", png],
    ["image/webp", "matte.webp", Buffer.from(webp.split(",")[1], "base64")],
  ]) {
    await p.getByRole("button", { name: "Import SFX artwork", exact: true }).click();
    await p.getByLabel("SFX file", { exact: true }).setInputFiles({ name, mimeType: mime, buffer });
    if (mime === "image/webp")
      await p.getByLabel("Remove corner-connected background", { exact: true }).check();
    await p.getByRole("img", { name: "SFX transparency preview", exact: true }).waitFor();
    await p.getByRole("button", { name: "Save asset and insert", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Import SFX artwork", exact: true })
      .waitFor({ state: "hidden" });
    await saved(p);
  }
  await p.getByRole("button", { name: "Preview", exact: true }).click();
  await ready(p);
  assert.equal(await p.locator("[data-boundary-editor]").count(), 0);
  await p.screenshot({ path: "/workspace/screenshots/advanced-reading.png" });
  await p.getByRole("button", { name: "Exit reading preview", exact: true }).click();

  const accuracy = await p.evaluate(async () => {
    const s = window.advanced,
      { renderRegion, RenderResources } = await import("/src/lib/studio/composition/render.ts"),
      { layout } = await import("/src/lib/studio/composition/model.ts"),
      { exportComposition, recoveryPackage } =
        await import("/src/lib/studio/composition/export.ts"),
      { decodeBackup } = await import("/src/lib/studio/backup.ts"),
      { getBlob } = await import("/src/lib/studio/db.ts"),
      { sanitizeSfxSvg } = await import("/src/lib/studio/composition/assets.ts");
    const clean = sanitizeSfxSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><script>bad()</script><path onclick="bad()" fill="url(https://bad.invalid)" d="M0 0L50 30Z"/></svg>',
    );
    if (/script|onclick|https:\/\/bad/.test(clean)) throw Error("Unsafe SVG retained");
    const doc = s.controller.getState().history.present.document,
      resources = new RenderResources(),
      asset = s.store
        .getState()
        .projects.find((p) => p.id === s.chapter.projectId)
        .compositionPreferences.presets.find((p) => p.category === "asset"),
      bitmap = await createImageBitmap(await getBlob(asset.value.blobId)),
      c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext("2d").drawImage(bitmap, 0, 0);
    if (c.getContext("2d").getImageData(0, 0, 1, 1).data[3] !== 0) throw Error("Transparency lost");
    bitmap.close();
    // Rotated Hangul and English at fractional output scale reproduce the
    // browser's region-dependent polygon antialiasing regression.
    const { inkObject } = await import("/src/lib/studio/composition/ink-presets.ts");
    const outputs = [];
    for (const shape of ["Wave", "Bezier", "Freehand"]) {
      const d = structuredClone(doc),
        f = d.panels[s.panels[0].id].fades[0];
      f.boundary.shape = shape;
      d.objects = d.objects.map((o) =>
        o.kind === "sfx" && o.ink ? { ...o, y: -100, rotation: -18 } : o,
      );
      d.objects.push({
        ...inkObject("SWISH", "Sharp Black & White"),
        id: "segmented-ink-regression",
        owner: s.panels[0].id,
        x: 280,
        y: -90,
      });
      if (shape === "Bezier")
        f.boundary.points = [
          { x: 0, y: 0.1 },
          { x: 0.3, y: 1 },
          { x: 0.7, y: 0 },
          { x: 1, y: 0.8 },
        ];
      const whole = await renderRegion(
          d,
          s.panels,
          { y: 0, height: layout(d, s.panels).height },
          640,
          resources,
        ),
        pixels = whole.getContext("2d").getImageData(0, 0, whole.width, whole.height).data;
      const entries = await exportComposition(d, s.panels, {
        format: "image/png",
        width: 640,
        segmentHeight: 257,
        quality: 1,
        background: "transparent",
      });
      let rows = 0,
        max = 0,
        mismatch = 0;
      for (const entry of entries) {
        const b = await createImageBitmap(entry.blob),
          c = document.createElement("canvas");
        c.width = b.width;
        c.height = b.height;
        c.getContext("2d").drawImage(b, 0, 0);
        const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < data.length; i++) {
          const diff = Math.abs(data[i] - pixels[rows * 640 * 4 + i]);
          max = Math.max(max, diff);
          if (diff > 2) mismatch++;
        }
        rows += c.height;
        b.close();
        c.width = c.height = 0;
      }
      if (rows !== whole.height || mismatch)
        throw Error(shape + " segmented mismatch " + JSON.stringify({ rows, max, mismatch }));
      outputs.push({ shape, rows, max, mismatch });
      whole.width = whole.height = 0;
    }
    for (const format of ["image/jpeg", "image/webp"]) {
      const entries = await exportComposition(doc, s.panels, {
        format,
        width: 400,
        quality: 0.9,
        segmentHeight: 257,
        background: "#ffffff",
      });
      const b = await createImageBitmap(entries[0].blob);
      if (b.width !== 400) throw Error("Codec error");
      b.close();
    }
    const backup = await decodeBackup(
      await recoveryPackage(s.chapter.projectId, s.chapter.id, doc),
    );
    if (!backup.blobs.has(asset.value.blobId)) throw Error("Preset asset missing from package");
    resources.clear();
    return { outputs, transparentAsset: true, svgSanitized: true, assetPackaged: true };
  });
  results.push(accuracy);
  // Freehand drawing places the fade where it is drawn, so record the position to persist.
  const positionBeforeReload = await p.evaluate(() => {
    const s = window.advanced;
    return s.controller.getState().history.present.document.panels[s.panels[0].id].fades[0].start;
  });
  await saved(p);
  await p.reload();
  await p.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await p.locator("[data-composition=studio]").waitFor();
  await attach(p);
  const restored = await p.evaluate(() => {
    const s = window.advanced,
      d = s.controller.getState().history.present.document;
    return {
      points: d.panels[s.panels[0].id].fades[0].boundary.points.length,
      position: d.panels[s.panels[0].id].fades[0].start,
      ink: d.objects.filter((o) => o.ink).length,
      assets: s.store
        .getState()
        .projects.find((p) => p.id === s.chapter.projectId)
        .compositionPreferences.presets.filter((p) => p.category === "asset").length,
    };
  });
  assert.ok(restored.points > 8);
  assert.equal(restored.position, positionBeforeReload);
  assert.equal(restored.ink, 1);
  assert.equal(restored.assets, 3);
  results.push({ restore: restored });
  await context.close();
  for (const width of [360, 390, 430]) {
    const ctx = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true,
      }),
      p = await ctx.newPage();
    await create(p);
    await p.getByRole("button", { name: "Tools", exact: true }).click();
    await p.getByRole("button", { name: "Focus panel 1", exact: true }).click();
    await p.getByRole("button", { name: "Close properties", exact: true }).click();
    await p.getByRole("button", { name: "Tools", exact: true }).click();
    await p.getByRole("button", { name: "Fades & Transitions", exact: true }).click();
    await p
      .getByRole("button", {
        name: "Freehand Boundary Editable mask · instant preview",
        exact: true,
      })
      .click();
    await p.getByRole("button", { name: "Close tools", exact: true }).waitFor({ state: "hidden" });
    await p.getByRole("button", { name: "Draw boundary on canvas", exact: true }).click();
    await p.getByRole("button", { name: "Fit screen", exact: true }).click();
    const rect = await p.locator('[data-boundary-editor="Freehand"]').boundingBox(),
      cdp = await ctx.newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: rect.x + rect.width * 0.1, y: rect.y + rect.height * 0.77, id: 1 }],
    });
    for (let i = 1; i < 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: rect.x + rect.width * (0.1 + i * 0.1),
            y: rect.y + rect.height * (0.77 + 0.02 * Math.sin(i)),
            id: 1,
          },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await saved(p);
    await ready(p);
    assert.equal(await p.locator(".composition-boundary-editor.is-drawing").count(), 0);
    assert.ok(
      await p.evaluate(() => {
        const a = window.advanced;
        return (
          a.controller.getState().history.present.document.panels[a.panels[0].id].fades[0].boundary
            .points.length > 4
        );
      }),
    );
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.screenshot({ path: `/workspace/screenshots/advanced-mobile-${width}.png` });
    results.push({ width, touchBoundary: true });
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "/workspace/advanced-evidence/results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (e) {
  await writeFile(
    "/workspace/advanced-evidence/failure.json",
    JSON.stringify({ error: String(e), stack: e.stack, errors, results }, null, 2),
  );
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      await p.screenshot({ path: "/workspace/screenshots/advanced-failure.png" }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
