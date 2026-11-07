/**
 * Freeform fade editor: real canvas gestures, inspector controls, persistence,
 * undo/redo, extension into spacing, overlapping fades, export parity and an
 * Android-sized touch viewport.
 *
 *   node scripts/fade-editor-browser-check.mjs [http://127.0.0.1:8080]
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const out = "docs/fade-editor";
await mkdir(`${out}/screenshots`, { recursive: true });
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  external = [],
  results = [];
const step = (name, data = {}) => {
  results.push({ step: name, ...data });
  console.log(`✓ ${name}`, Object.keys(data).length ? JSON.stringify(data) : "");
};
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => {
    if (!["localhost", "127.0.0.1"].includes(new URL(r.url()).hostname))
      external.push(`${r.url()} ${r.failure()?.errorText}`);
    else if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? ""))
      errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location()?.url ?? "";
    if (/^Failed to load resource/.test(m.text()) && url && !/127\.0\.0\.1|localhost/.test(url))
      return;
    errors.push(m.text());
  });
};
const image = (name) => readFile(`public/gallery/${name}`);
async function create(page, title, names) {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByRole("button", { name: "Add images", exact: true }).waitFor();
  await page
    .locator("input[type=file][multiple]")
    .first()
    .setInputFiles(
      await Promise.all(
        names.map(async (n, i) => ({
          name: `0${i + 1}-${n}`,
          mimeType: "image/webp",
          buffer: await image(n),
        })),
      ),
    );
  await page
    .getByRole("button", { name: `Display ${names.length}`, exact: true })
    .waitFor({ timeout: 90000 });
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor({ timeout: 60000 });
  await attach(page);
}
/** Resolve the app's own module instances (dev URLs can carry HMR/version queries). */
async function attach(page) {
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((x) => new URL(x.name).pathname === "/src/lib/studio/store.ts"),
  );
  await page.evaluate(async () => {
    const find = (path) =>
      performance
        .getEntriesByType("resource")
        .map((x) => x.name)
        .find((x) => new URL(x).pathname === path) ?? path;
    const state = (await import(find("/src/lib/studio/store.ts"))).useStudio;
    const chapter = state.getState().chapters.find((c) => location.pathname.endsWith(c.id)),
      panels = state.getState().panels.filter((p) => p.chapterId === chapter.id);
    const module = await import(find("/src/lib/studio/composition/controller.ts"));
    window.__f = { store: state, controller: module.getController(chapter, panels), chapter };
  });
}
const doc = (page) => page.evaluate(() => window.__f.controller.getState().history.present);
const fades = async (page, index = 1) => {
  const f = await doc(page);
  return f.document.panels[f.order[index]].fades;
};
const ready = (page) =>
  page.waitForFunction(
    () => {
      const t = [...document.querySelectorAll(".composition-tile")];
      return t.length > 0 && t.every((c) => c.dataset.renderStatus === "ready");
    },
    null,
    { timeout: 60000 },
  );
const saved = (page) =>
  page.waitForFunction(
    () => document.querySelector("[data-composition=studio]")?.dataset.saveStatus === "saved",
    null,
    { timeout: 30000 },
  );
const center = async (locator) => {
  const b = await locator.boundingBox();
  assert.ok(b, "element is laid out");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};
async function drag(page, from, to, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
/** Average RGBA difference of a chapter region rendered with vs. without the given layers. */
const regionDiff = (page, region, excluded) =>
  page.evaluate(
    async ({ region, excluded }) => {
      const s = window.__f,
        frame = s.controller.getState().history.present,
        all = s.store.getState().panels,
        panels = frame.order.map((id) => all.find((p) => p.id === id));
      const { renderRegion, RenderResources } =
        await import("/src/lib/studio/composition/render.ts");
      const { layout } = await import("/src/lib/studio/composition/model.ts");
      const scene = layout(frame.document, panels),
        f = scene.frames[region.panel];
      const y =
        region.from === "imageTop"
          ? f.imageY + region.dy
          : region.from === "frameTop"
            ? f.top
            : f.bottomY + region.dy;
      const r = new RenderResources();
      const a = await renderRegion(frame.document, panels, { y, height: region.height }, 400, r);
      const b = await renderRegion(frame.document, panels, { y, height: region.height }, 400, r, {
        excluded: new Set(excluded),
      });
      const da = a.getContext("2d").getImageData(0, 0, a.width, a.height).data,
        db = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
      let sum = 0,
        max = 0;
      for (let i = 0; i < da.length; i++) {
        const d = Math.abs(da[i] - db[i]);
        sum += d;
        max = Math.max(max, d);
      }
      r.clear();
      return { mean: sum / da.length, max };
    },
    { region, excluded },
  );

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watch(page);
  await create(page, "Fade QA", ["horror-720.webp", "fantasy-720.webp"]);
  await ready(page);
  // Select panel 2 and give it a 300 px top extension (chapter spacing above its art).
  await page.locator(".composition-panel-select").nth(1).click();
  await page.getByLabel("Top extension (px)", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Fades & Transitions", exact: true }).click();
  await page
    .getByRole("button", { name: "Wave Editable mask · instant preview", exact: true })
    .click();
  let [wave] = await fades(page);
  assert.equal(wave.name, "Wave fade");
  assert.equal(wave.extend, true);
  await page.getByLabel("Fade target color", { exact: true }).fill("#000000");
  await page.getByLabel("Fade placement", { exact: true }).selectOption("Top");
  wave = (await fades(page))[0];
  await page.getByRole("button", { name: "Fit screen", exact: true }).click();
  await ready(page);
  await page.locator(`[data-fade-editor="${wave.id}"]`).waitFor();
  step("1. create a shaped fade (named, editor visible)", { name: wave.name });

  // 2. Move far below and above the original position by dragging the grip.
  const grip = () => center(page.locator('[data-fade-handle="move"]').first());
  let g = await grip();
  await drag(page, g, { x: g.x, y: g.y + 220 });
  const down = (await fades(page))[0];
  assert.ok(down.start > wave.start + 150, `moved down: ${down.start}`);
  g = await grip();
  await drag(page, g, { x: g.x, y: g.y - 420 });
  const up = (await fades(page))[0];
  assert.ok(up.start < -150, `moved above the image: ${up.start}`);
  step("2. free vertical movement far down and above the image", {
    down: down.start,
    up: up.start,
  });

  // 3. The band now paints into the 300 px top extension (spacing), black over white.
  const spacing = await regionDiff(page, { panel: 1, from: "frameTop", height: 300 }, [wave.id]);
  assert.ok(spacing.max > 40, `fade paints into the 300 px spacing: ${JSON.stringify(spacing)}`);
  const band = await regionDiff(
    page,
    { panel: 1, from: "imageTop", dy: Math.round(up.start), height: 450 },
    [wave.id],
  );
  assert.ok(band.mean > 5, `fade band visible above the image: ${JSON.stringify(band)}`);
  await page.screenshot({ path: `${out}/screenshots/extended-into-spacing.png` });
  step("3. fade extends into chapter spacing", { spacingMax: spacing.max, bandMean: band.mean });

  // 4. Resize freely: depth handle and side handles.
  const before = (await fades(page))[0];
  const depth = await center(page.locator('[data-fade-handle="depth"]').first());
  await drag(page, depth, { x: depth.x, y: depth.y + 90 });
  const deeper = (await fades(page))[0];
  assert.ok(deeper.length > before.length + 50, `depth ${before.length} → ${deeper.length}`);
  assert.equal(deeper.start, before.start, "depth does not move the fade");
  const right = await center(page.locator('[data-fade-handle="right"]').first());
  await drag(page, right, { x: right.x - 120, y: right.y });
  const narrow = (await fades(page))[0];
  assert.ok(narrow.width < 800, `width ${narrow.width}`);
  const left = await center(page.locator('[data-fade-handle="left"]').first());
  await drag(page, left, { x: left.x + 60, y: left.y });
  const resized = (await fades(page))[0];
  assert.ok(resized.x > 0);
  // A narrowed fade also moves horizontally.
  g = await grip();
  await drag(page, g, { x: g.x + 40, y: g.y });
  assert.ok((await fades(page))[0].x > resized.x, "horizontal move");
  step("4. depth and horizontal resizing", {
    length: deeper.length,
    x: resized.x,
    width: resized.width,
  });

  // 5. Density 0 → invisible; 100 → full strength.
  const at = Math.round((await fades(page))[0].start);
  console.log(
    "DBG",
    JSON.stringify((await fades(page))[0]),
    await page.evaluate(async () => {
      const s = window.__f.controller.getState().history.present;
      const { layout } = await import("/src/lib/studio/composition/model.ts");
      const { fadeExtension, fadeBand } = await import("/src/lib/studio/composition/fade-edit.ts");
      const all = window.__f.store.getState().panels;
      const fr = layout(
        s.document,
        s.order.map((i) => all.find((p) => p.id === i)),
      ).frames[1];
      const f = s.document.panels[s.order[1]].fades[0];
      const { renderRegion, RenderResources } =
        await import("/src/lib/studio/composition/render.ts");
      const r = new RenderResources(),
        panels = s.order.map((i) => all.find((p) => p.id === i));
      const samples = [];
      for (const wy of [-250, -150, -60]) {
        const c = await renderRegion(s.document, panels, { y: fr.imageY + wy, height: 4 }, 800, r);
        const c2 = await renderRegion(
          {
            ...s.document,
            panels: {
              ...s.document.panels,
              [s.order[1]]: { ...s.document.panels[s.order[1]], fades: [] },
            },
          },
          panels,
          { y: fr.imageY + wy, height: 4 },
          800,
          r,
        );
        samples.push([
          wy,
          [...c.getContext("2d").getImageData(430, 1, 1, 1).data].join(","),
          [...c2.getContext("2d").getImageData(430, 1, 1, 1).data].join(","),
        ]);
      }
      return JSON.stringify({
        imageY: fr.imageY,
        h: fr.imageHeight,
        ext: fadeExtension(f, fr.imageHeight),
        band: fadeBand(f, fr.imageHeight),
        samples,
      });
    }),
  );
  await page.getByLabel("Density", { exact: true }).fill("0");
  assert.equal((await fades(page))[0].opacity, 0);
  const zero = await regionDiff(page, { panel: 1, from: "imageTop", dy: at, height: 600 }, [
    wave.id,
  ]);
  assert.ok(zero.max <= 2, `density 0 is invisible: ${JSON.stringify(zero)}`);
  await page.getByLabel("Density", { exact: true }).fill("100");
  assert.equal((await fades(page))[0].opacity, 1);
  const full = await regionDiff(page, { panel: 1, from: "imageTop", dy: at, height: 600 }, [
    wave.id,
  ]);
  assert.ok(full.mean > 5, `density 100 restores: ${JSON.stringify(full)}`);
  step("5. density 0% hides, 100% restores", { zero: zero.max, full: full.mean });

  // 6. Depth independent of softness.
  const pre = (await fades(page))[0];
  await page.getByLabel("Softness (px)", { exact: true }).fill("60");
  const soft = (await fades(page))[0];
  assert.equal(soft.softness, 60);
  assert.equal(soft.length, pre.length, "softness keeps depth");
  assert.equal(soft.start, pre.start);
  await page.getByLabel("Fade depth (px)", { exact: true }).fill("500");
  const deep = (await fades(page))[0];
  assert.equal(deep.length, 500);
  assert.equal(deep.softness, 60, "depth keeps softness");
  step("6. depth and softness are independent", { length: deep.length, softness: deep.softness });

  // 7. Freehand: draw, then edit points without redrawing; add a point; smooth.
  await page.getByRole("button", { name: "Draw boundary on canvas", exact: true }).click();
  const svg = page.locator("[data-boundary-editor]").first(),
    box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++)
    await page.mouse.move(
      box.x + box.width * (0.05 + i * 0.045),
      box.y + box.height * (0.2 + 0.05 * Math.sin(i / 2)),
    );
  await page.mouse.up();
  let free = (await fades(page))[0];
  assert.equal(free.boundary.shape, "Freehand");
  const count = free.boundary.points.length;
  assert.ok(count >= 4);
  const handle = page.locator('[data-boundary-handle="2"]').first();
  const h0 = await center(handle);
  await drag(page, h0, { x: h0.x, y: h0.y + 70 });
  const edited = (await fades(page))[0];
  assert.equal(edited.boundary.shape, "Freehand");
  assert.equal(edited.boundary.points.length, count, "editing keeps the drawn path");
  assert.notDeepEqual(edited.boundary.points, free.boundary.points);
  // Double-click the mint line at 33% of the fade's width to add a point.
  const target = await page.evaluate(async () => {
    const s = window.__f.controller.getState().history.present,
      f = s.document.panels[s.order[1]].fades[0];
    const { lineY } = await import("/src/lib/studio/composition/fade-edit.ts");
    const { layout } = await import("/src/lib/studio/composition/model.ts");
    const all = window.__f.store.getState().panels,
      frame = layout(
        s.document,
        s.order.map((i) => all.find((p) => p.id === i)),
      ).frames[1];
    const sx = f.x ?? 0,
      sw = f.width ?? s.document.width;
    // Middle of the widest gap between control points, away from point handles.
    const xs = f.boundary.points.map((p) => p.x);
    let u = 0.5,
      gap = 0;
    for (let i = 1; i < xs.length; i++)
      if (xs[i] - xs[i - 1] > gap) {
        gap = xs[i] - xs[i - 1];
        u = (xs[i] + xs[i - 1]) / 2;
      }
    return {
      x: (sx + u * sw) / s.document.width,
      y: lineY(f, "top", u, 0.5, frame.imageHeight) / frame.imageHeight,
    };
  });
  const sb = await svg.boundingBox();
  await page.mouse.dblclick(sb.x + target.x * sb.width, sb.y + target.y * sb.height);
  const added = (await fades(page))[0];
  assert.equal(added.boundary.points.length, count + 1, "double-click adds a point");
  await page.getByRole("button", { name: "Smooth path", exact: true }).click();
  const smoothed = (await fades(page))[0];
  assert.notDeepEqual(smoothed.boundary.points, added.boundary.points);
  await page.screenshot({ path: `${out}/screenshots/freehand-editing.png` });
  step("7. freehand drawn, reshaped point-by-point, point added, smoothed", {
    points: smoothed.boundary.points.length,
  });

  // 10. Undo/redo of a canvas move.
  const beforeMove = (await fades(page))[0].start;
  g = await grip();
  await drag(page, g, { x: g.x, y: g.y + 60 });
  const afterMove = (await fades(page))[0].start;
  assert.notEqual(afterMove, beforeMove);
  await page.getByRole("button", { name: "Undo composition", exact: true }).click();
  assert.equal((await fades(page))[0].start, beforeMove, "undo move");
  await page.getByRole("button", { name: "Redo composition", exact: true }).click();
  assert.equal((await fades(page))[0].start, afterMove, "redo move");
  await page.getByRole("button", { name: "Undo composition", exact: true }).click();
  await page.getByRole("button", { name: "Redo composition", exact: true }).click();
  step("10. undo/redo of canvas gestures");

  // 13. Overlapping fades: names, chips, list selection, visibility.
  await page
    .getByRole("button", { name: "Straight Editable mask · instant preview", exact: true })
    .click();
  const two = await fades(page);
  assert.deepEqual(
    two.map((f) => f.name),
    ["Wave fade", "Straight fade"],
  );
  await page.getByRole("button", { name: "Select fade Wave fade", exact: true }).first().click();
  assert.equal(
    (await doc(page)).document &&
      (await page.evaluate(() => window.__f.controller.getState().selection.id)),
    wave.id,
  );
  await page
    .locator(".composition-fade-list")
    .first()
    .getByRole("button", { name: "Hide fade Straight fade", exact: true })
    .click();
  assert.equal((await fades(page))[1].visible, false);
  const hidden = await regionDiff(page, { panel: 1, from: "imageTop", dy: 0, height: 300 }, [
    two[1].id,
  ]);
  assert.ok(hidden.max <= 2, "hidden fade does not render");
  await page
    .locator(".composition-fade-list")
    .first()
    .getByRole("button", { name: "Show fade Straight fade", exact: true })
    .click();
  // Canvas click on the Straight band (panel selected) selects it, then cycles.
  await page.evaluate(() => {
    const s = window.__f.controller.getState();
    window.__f.controller.setState({
      selection: { kind: "panel", id: s.history.present.order[1] },
    });
  });
  const outline = page.locator(".composition-fade-outline").first(),
    ob = await outline.boundingBox();
  // A point inside the Straight fade's band (90% across, on its mint line).
  const straightY = await page.evaluate(async () => {
    const s = window.__f.controller.getState().history.present;
    const { layout } = await import("/src/lib/studio/composition/model.ts");
    const { lineY, parts } = await import("/src/lib/studio/composition/fade-edit.ts");
    const all = window.__f.store.getState().panels;
    const fr = layout(
        s.document,
        s.order.map((i) => all.find((p) => p.id === i)),
      ).frames[1],
      f = s.document.panels[s.order[1]].fades[1];
    return lineY(f, parts(f)[0], 0.9, 0.5, fr.imageHeight) / fr.imageHeight;
  });
  await page.mouse.click(ob.x + ob.width * 0.9, ob.y + straightY * ob.height);
  const picked = await page.evaluate(() => window.__f.controller.getState().selection);
  assert.equal(picked.kind, "fade", "canvas click selects a fade on the selected panel");
  await page.screenshot({ path: `${out}/screenshots/overlapping-fades.png` });
  step("13. overlapping fades: names, chips, list visibility, canvas selection", {
    picked: picked.id === two[1].id ? "Straight fade" : "Wave fade",
  });

  // 8. Switch panels and return: nothing changes.
  const snapshot = await fades(page);
  await page.getByRole("button", { name: "Panels", exact: true }).click();
  await page.locator(".composition-panel-select").nth(0).click();
  await page.getByRole("button", { name: "Focus panel 1", exact: true }).click();
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await page.locator(".composition-panel-select").nth(1).click();
  await page.getByRole("button", { name: "Select fade Wave fade", exact: true }).first().click();
  assert.deepEqual(await fades(page), snapshot);
  await page.locator(`[data-fade-editor="${wave.id}"]`).waitFor();
  step("8. switching panels and focus keeps fades and reselects");

  // 9. Reload: everything persists.
  await saved(page);
  await page.reload();
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor({ timeout: 60000 });
  await attach(page);
  assert.deepEqual(await fades(page), snapshot);
  step("9. reload persists every fade property", { fades: snapshot.length });

  // 11. Export matches the preview renderer (softness + extension + freehand).
  await ready(page);
  const parity = await page.evaluate(async () => {
    const s = window.__f,
      frame = s.controller.getState().history.present,
      all = s.store.getState().panels,
      panels = frame.order.map((id) => all.find((p) => p.id === id));
    const { renderRegion, RenderResources } = await import("/src/lib/studio/composition/render.ts");
    const { exportComposition } = await import("/src/lib/studio/composition/export.ts");
    const { layout } = await import("/src/lib/studio/composition/model.ts");
    const r = new RenderResources(),
      scene = layout(frame.document, panels);
    const full = await renderRegion(frame.document, panels, { y: 0, height: scene.height }, 640, r);
    const fd = full.getContext("2d").getImageData(0, 0, full.width, full.height).data;
    const segments = await exportComposition(frame.document, panels, {
      format: "image/png",
      width: 640,
      quality: 1,
      segmentHeight: 331,
      background: "transparent",
    });
    let row = 0,
      mismatch = 0,
      max = 0;
    for (const e of segments) {
      const bm = await createImageBitmap(e.blob),
        c = document.createElement("canvas");
      c.width = bm.width;
      c.height = bm.height;
      c.getContext("2d").drawImage(bm, 0, 0);
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i++) {
        const d = Math.abs(data[i] - fd[row * 640 * 4 + i]);
        if (d > 2) mismatch++;
        max = Math.max(max, d);
      }
      row += c.height;
      bm.close();
    }
    r.clear();
    return { rows: row, total: full.height, segments: segments.length, mismatch, max };
  });
  assert.equal(parity.rows, parity.total);
  assert.equal(parity.mismatch, 0, `export parity: ${JSON.stringify(parity)}`);
  await writeFile(`${out}/export-parity.json`, JSON.stringify(parity, null, 2));
  step("11. segmented export matches the full preview render", parity);

  // 14. Existing (legacy-format) fades still open and render clipped to their image.
  const legacy = await page.evaluate(async () => {
    const c = window.__f.controller,
      order = c.getState().history.present.order;
    c.change((d) => ({
      ...d,
      panels: {
        ...d.panels,
        [order[0]]: {
          ...d.panels[order[0]],
          bottom: { ...d.panels[order[0]].bottom, height: 200 },
          fades: [
            {
              id: "legacy-fade",
              name: "Legacy wave",
              type: "Bottom Fade",
              edges: ["bottom"],
              length: 2400,
              start: 0,
              opacity: 1,
              color: "#000000",
              curve: 1,
              feather: 0,
              blur: 0,
              angle: 90,
              visible: true,
              locked: false,
              blend: "source-over",
              stops: [
                { position: 0, opacity: 0 },
                { position: 1, opacity: 1 },
              ],
              boundary: {
                shape: "Wave",
                amplitude: 100,
                frequency: 2,
                direction: 1,
                placement: "Bottom",
                points: [
                  { x: 0, y: 0.5 },
                  { x: 0.3, y: 0 },
                  { x: 0.7, y: 1 },
                  { x: 1, y: 0.5 },
                ],
              },
            },
          ],
        },
      },
    }));
    await c.flush();
    return "ok";
  });
  assert.equal(legacy, "ok");
  await page.reload();
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor({ timeout: 60000 });
  await attach(page);
  assert.equal(await page.evaluate(() => window.__f.controller.getState().blocked), false);
  const legacyFade = (await fades(page, 0))[0];
  assert.equal(legacyFade.extend, undefined, "legacy fade is not migrated");
  const below = await regionDiff(page, { panel: 0, from: "imageBottom", dy: 2, height: 190 }, [
    "legacy-fade",
  ]);
  assert.ok(below.max <= 2, `legacy fade stays clipped to its image: ${JSON.stringify(below)}`);
  const inside = await regionDiff(page, { panel: 0, from: "imageTop", dy: 200, height: 300 }, [
    "legacy-fade",
  ]);
  assert.ok(inside.mean > 5, "legacy fade still renders on its image");
  step("14. legacy fades open unchanged and stay clipped", {
    below: below.max,
    inside: inside.mean,
  });
  await ready(page);
  await page.screenshot({ path: `${out}/screenshots/desktop.png` });
  await context.close();

  // 12. Android-sized touch viewport: select from the list, drag with real touch input.
  const mobile = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2.625,
  });
  const m = await mobile.newPage();
  watch(m);
  await create(m, "Touch fades", ["fantasy-720.webp"]);
  await ready(m);
  await m.locator(".composition-tools-toggle").tap();
  await m.getByRole("button", { name: "Fades & Transitions", exact: true }).tap();
  await m
    .getByRole("button", { name: "Curved Editable mask · instant preview", exact: true })
    .tap();
  const touchFade = (await fades(m, 0))[0];
  const closeProps = m.getByRole("button", { name: "Close properties", exact: true });
  if (await closeProps.isVisible()) await closeProps.tap();
  const closeTools = m.getByRole("button", { name: "Close tools", exact: true });
  if (await closeTools.isVisible()) await closeTools.tap();
  await m
    .getByRole("button", { name: "Fit screen", exact: true })
    .tap()
    .catch(() => {});
  await ready(m);
  const tg = await center(m.locator('[data-fade-handle="move"]').first());
  assert.ok(tg.box.width >= 30, `touch-sized grip (${tg.box.width}px)`);
  const cdp = await mobile.newCDPSession(m);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: tg.x, y: tg.y, id: 1 }],
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: tg.x, y: tg.y + i * 15, id: 1 }],
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const touched = (await fades(m, 0))[0];
  // Bottom placement measures from the image bottom: dragging down lowers the start.
  const sign = touchFade.boundary.placement === "Top" ? 1 : -1;
  assert.ok(
    (touched.start - touchFade.start) * sign > 20,
    `touch drag moved the fade down: ${touchFade.start} → ${touched.start}`,
  );
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `no horizontal overflow (${overflow})`);
  // Re-open the properties sheet with a normal tap (the raw CDP touch stream above can
  // swallow the first synthetic tap in headless Chromium, so retry once).
  for (let i = 0; i < 2 && !(await m.getByLabel("Density", { exact: true }).isVisible()); i++) {
    await m.getByRole("button", { name: "Properties", exact: true }).tap();
    await m.waitForTimeout(300);
  }
  await m.getByLabel("Density", { exact: true }).waitFor();
  await m.getByLabel("Density", { exact: true }).fill("55");
  assert.equal((await fades(m, 0))[0].opacity, 0.55);
  await m.screenshot({ path: `${out}/screenshots/android-412.png` });
  step("12. Android 412px: touch drag, touch-sized handles, properties sheet", {
    start: touched.start,
    grip: Math.round(tg.box.width),
  });
  await mobile.close();
  assert.deepEqual(errors, [], "no uncaught page or console errors");
  await writeFile(
    `${out}/browser-results.json`,
    JSON.stringify({ results, errors, external: [...new Set(external)] }, null, 2),
  );
  console.log(`PASS ${results.length} steps`);
} catch (error) {
  for (const [i, ctx] of browser.contexts().entries())
    for (const [j, pg] of ctx.pages().entries())
      await pg
        .screenshot({ path: `/workspace/screenshots/fade-failure-${i}-${j}.png` })
        .catch(() => {});
  console.error(JSON.stringify({ results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
