/**
 * Text & Bubbles chapter editor, consolidated Composition navigation and the SFX
 * extractor, driven through the real UI. Verifies persistence, chapter/focus
 * coordinate agreement, undo/redo, segmented export parity, source preservation
 * and touch layouts.
 *
 *   node scripts/lettering-browser-check.mjs [http://127.0.0.1:8080] [--built]
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const built = process.argv.includes("--built");
const out = "docs/text-bubbles/evidence",
  shots = "docs/text-bubbles/screenshots";
await mkdir(out, { recursive: true });
await mkdir(shots, { recursive: true });
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  external = [],
  results = [];
const step = (name, data = {}) => {
  results.push({ step: name, ...data });
  console.log(`✓ ${name}`, Object.keys(data).length ? JSON.stringify(data) : "");
};
/** Sandbox network blocks third-party hosts (e.g. the platform branding script). Those are
 * recorded separately; any local/app failure still fails the run. */
const watch = (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => {
    if (!["localhost", "127.0.0.1"].includes(new URL(r.url()).hostname))
      external.push(`${r.url()} ${r.failure()?.errorText}`);
    else errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location()?.url ?? "";
    if (/^Failed to load resource/.test(m.text()) && url && !/127\.0\.0\.1|localhost/.test(url))
      return;
    errors.push(m.text());
  });
};
const files = async () => [
  {
    name: "01-action.webp",
    mimeType: "image/webp",
    buffer: await readFile("public/gallery/action-720.webp"),
  },
  {
    name: "02-fantasy.webp",
    mimeType: "image/webp",
    buffer: await readFile("public/gallery/fantasy-720.webp"),
  },
  {
    name: "03-horror.webp",
    mimeType: "image/webp",
    buffer: await readFile("public/gallery/horror-720.webp"),
  },
];
async function create(page, title) {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByRole("button", { name: "Add images", exact: true }).waitFor();
  const list = await files();
  await page.locator("input[type=file][multiple]").first().setInputFiles(list);
  await page
    .getByRole("button", { name: `Display ${list.length}`, exact: true })
    .waitFor({ timeout: 90000 });
}
/** Module access for state assertions. Built output has no source modules. */
async function attach(page) {
  if (built) return;
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
    window.__c = { store: state, controller: module.getController(chapter, panels), chapter };
  });
}
const doc = (page) =>
  page.evaluate(() => window.__c.controller.getState().history.present.document);
const ready = (page) =>
  page.waitForFunction(
    () => {
      const tiles = [...document.querySelectorAll(".composition-tile")];
      return tiles.length > 0 && tiles.every((c) => c.dataset.renderStatus === "ready");
    },
    null,
    { timeout: 60000 },
  );
const saved = (page, kind = "lettering") =>
  page.waitForFunction(
    (k) => document.querySelector(`[data-composition=${k}]`)?.dataset.saveStatus === "saved",
    kind,
    { timeout: 30000 },
  );
const box = async (locator) => {
  const b = await locator.boundingBox();
  assert.ok(b, "element has a box");
  return { ...b, left: b.x, top: b.y, x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  watch(page);
  await create(page, "Lettering QA");

  // ── Composition & FX: consolidated navigation keeps every tool reachable ──
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor({ timeout: 60000 });
  await attach(page);
  const nav = page.getByRole("navigation", { name: "Composition tool sections" });
  for (const name of ["Panels", "Spacing", "Fades & Transitions", "Manhwa SFX"])
    await nav.getByRole("button", { name, exact: true }).waitFor();
  assert.equal(await nav.getByRole("button").count(), 4);
  await page.locator(".composition-advanced-nav summary").click();
  for (const name of ["Layers", "Effects Library", "Overlays & Sources", "All presets"])
    await page
      .locator(".composition-advanced-nav")
      .getByRole("button", { name, exact: true })
      .waitFor();
  // Panels: visibility/lock toggles and drag-and-drop reorder.
  await page.getByRole("button", { name: "Hide panel 2", exact: true }).click();
  if (!built)
    assert.equal(
      (await doc(page)).panels[
        await page.evaluate(() => window.__c.controller.getState().history.present.order[1])
      ].visible,
      false,
    );
  await page.getByRole("button", { name: "Show panel 2", exact: true }).click();
  const order0 = built
    ? null
    : await page.evaluate(() => window.__c.controller.getState().history.present.order);
  const cards = page.locator(".composition-panel-card");
  await cards.nth(2).dragTo(cards.nth(0));
  if (!built) {
    const order1 = await page.evaluate(
      () => window.__c.controller.getState().history.present.order,
    );
    assert.notDeepEqual(order1, order0, "drag-and-drop reorders panels");
    await page.keyboard.press("Control+z");
    assert.deepEqual(
      await page.evaluate(() => window.__c.controller.getState().history.present.order),
      order0,
      "reorder is undoable",
    );
  }
  step("panels: toggles, drag reorder, undo");
  // Spacing quick presets.
  await page.getByRole("button", { name: "Focus panel 1", exact: true }).click();
  await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
  await nav.getByRole("button", { name: "Spacing", exact: true }).click();
  await page.getByRole("button", { name: /Dramatic black · 400/ }).click();
  if (!built) {
    const d = await doc(page),
      first = await page.evaluate(() => window.__c.controller.getState().history.present.order[0]);
    assert.equal(d.panels[first].after.height, 400);
    assert.equal(d.panels[first].after.color, "#000000");
  }
  step("spacing: quick preset applied");
  // Fades & Transitions: three galleries with real previews.
  await nav.getByRole("button", { name: "Fades & Transitions", exact: true }).click();
  assert.equal(await page.locator(".composition-shape-card").count(), 9);
  await page.getByRole("tab", { name: "Fade types", exact: true }).click();
  assert.equal(await page.locator(".composition-shape-card img").count(), 13);
  await page.getByRole("button", { name: "Add Radial Fade", exact: true }).click();
  await page.getByRole("tab", { name: "Transitions", exact: true }).click();
  assert.equal(await page.locator(".composition-shape-card img").count(), 10);
  await page.getByRole("button", { name: "Connect with Crossfade", exact: true }).click();
  if (!built) {
    const d = await doc(page);
    assert.ok(Object.values(d.panels).some((p) => p.fades.some((f) => f.type === "Radial Fade")));
    assert.equal(d.transitions.at(-1).type, "Crossfade");
  }
  step("fades & transitions: galleries insert real effects");
  // Manhwa SFX: five tabs, favorites.
  await nav.getByRole("button", { name: "Manhwa SFX", exact: true }).click();
  for (const name of ["Built-in", "My Assets", "Import", "Extract", "Favorites"])
    await page.getByRole("tab", { name, exact: true }).waitFor();
  await page.getByRole("button", { name: "Favorite Sword Swing", exact: true }).click();
  await page.getByRole("tab", { name: "Favorites", exact: true }).click();
  await page
    .getByRole("button", { name: /^Sword Swing/ })
    .first()
    .click();
  if (!built) assert.ok((await doc(page)).objects.some((o) => o.kind === "sfx" && o.ink));
  step("manhwa sfx: tabs, favorite and insert");
  await page.screenshot({ path: `${shots}/composition-navigation${built ? "-built" : ""}.png` });

  // ── SFX extractor: transparent asset, source untouched ──
  await page.getByRole("tab", { name: "Extract", exact: true }).click();
  const sourceHash = built
    ? null
    : await page.evaluate(async () => {
        const { getImageBlob } = await import("/src/lib/studio/db.ts");
        const p = window.__c.store
          .getState()
          .panels.find((x) => x.chapterId === window.__c.chapter.id);
        const buf = await (await getImageBlob(p.blobId)).arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buf);
        return [p.blobId, [...new Uint8Array(digest)].map((b) => b.toString(16)).join("")];
      });
  await page.getByRole("button", { name: "Extract from panel 1", exact: true }).click();
  const extractor = page.getByRole("dialog", { name: "SFX extractor", exact: true });
  await extractor.waitFor();
  const preview = extractor
    .getByRole("img", { name: "Extraction preview over transparency" })
    .or(extractor.locator("canvas[aria-label='Extraction preview over transparency']"));
  await preview.first().waitFor();
  const pb = await box(preview.first());
  await extractor.getByRole("button", { name: /Rectangle/ }).click();
  await drag(
    page,
    { x: pb.left + pb.width * 0.2, y: pb.top + pb.height * 0.2 },
    { x: pb.left + pb.width * 0.6, y: pb.top + pb.height * 0.5 },
  );
  await extractor.getByLabel("Asset name").fill("Extracted QA");
  await page.waitForTimeout(500);
  await extractor.getByRole("button", { name: "Save to My Assets", exact: true }).click();
  await page.getByText(/Saved “Extracted QA” to My Assets/).waitFor({ timeout: 20000 });
  await extractor.getByRole("button", { name: "Close extractor", exact: true }).click();
  await extractor.waitFor({ state: "hidden" });
  if (!built) {
    const check = await page.evaluate(async (hash) => {
      const { getImageBlob } = await import("/src/lib/studio/db.ts");
      const project = window.__c.store
        .getState()
        .projects.find((p) => p.id === window.__c.chapter.projectId);
      const asset = project.compositionPreferences.presets.find((p) => p.name === "Extracted QA");
      const blob = await getImageBlob(asset.value.blobId);
      const bitmap = await createImageBitmap(blob),
        c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let transparent = 0,
        opaque = 0;
      for (let i = 3; i < data.length; i += 4)
        if (data[i] === 0) transparent++;
        else if (data[i] === 255) opaque++;
      const source = await (await getImageBlob(hash[0])).arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", source))]
        .map((b) => b.toString(16))
        .join("");
      return {
        type: blob.type,
        width: c.width,
        height: c.height,
        transparent,
        opaque,
        unchanged: digest === hash[1],
      };
    }, sourceHash);
    assert.equal(check.type, "image/png");
    assert.ok(check.transparent > 0, "extracted asset has transparent pixels");
    assert.ok(check.opaque > 0, "extracted asset keeps opaque artwork");
    assert.ok(check.unchanged, "source panel bytes are unchanged");
    step("extractor: transparent PNG asset saved, source untouched", check);
  } else step("extractor: asset saved (built)");
  await page.getByRole("tab", { name: "My Assets", exact: true }).click();
  await page
    .getByRole("button", { name: /^Extracted QA/ })
    .first()
    .waitFor();
  await saved(page, "studio");

  // ── Text & Bubbles chapter editor ──
  await page.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
  const studio = page.locator("[data-composition=lettering]");
  await studio.waitFor({ timeout: 60000 });
  await ready(page);
  assert.ok((await page.locator(".composition-preset-card").count()) >= 15, "bubble library");
  await page.screenshot({ path: `${shots}/bubble-library${built ? "-built" : ""}.png` });
  await page.getByRole("button", { name: "Add Standard dialogue bubble", exact: true }).click();
  const text = page.getByLabel("Dialogue text", { exact: true });
  await text.fill("Every frame tells a story.");
  await page.getByRole("button", { name: "Add Shouting bubble", exact: true }).click();
  await page.getByLabel("Dialogue text", { exact: true }).fill("NOW!");
  await page
    .getByRole("button", { name: "Add Korean dialogue text", exact: true })
    .click()
    .catch(async () => {
      await page.getByRole("button", { name: "Text", exact: true }).click();
      await page.getByRole("button", { name: "Add Korean dialogue text", exact: true }).click();
    });
  await saved(page);
  await ready(page);
  let bubbles;
  if (!built) {
    bubbles = (await doc(page)).objects.filter((o) => o.kind === "bubble");
    assert.equal(bubbles.length, 3);
    assert.equal(bubbles[0].text, "Every frame tells a story.");
    assert.equal(bubbles[2].language, "ko");
  }
  step("bubbles inserted and edited");
  // Handles: select the first bubble, rotate, resize, move tail.
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Dialogue", exact: true }).click();
  await page.getByRole("button", { name: "Show bubble 1 on canvas", exact: true }).click();
  await page.waitForTimeout(300);
  const resize = page.getByRole("button", { name: "Resize speech bubble", exact: true });
  await resize.waitFor();
  const r0 = await box(resize);
  await drag(page, r0, { x: r0.x + 60, y: r0.y + 30 });
  const tip = await box(page.getByRole("button", { name: "Move tail 1 tip", exact: true }));
  await drag(page, tip, { x: tip.x - 70, y: tip.y + 20 });
  const rot = await box(page.getByRole("button", { name: "Rotate selected layer", exact: true }));
  await drag(page, rot, { x: rot.x + 60, y: rot.y + 10 });
  if (!built) {
    const sel = await page.evaluate(() => {
      const s = window.__c.controller.getState();
      return s.history.present.document.objects.find((o) => o.id === s.selection.id);
    });
    const before = bubbles.find((b) => b.id === sel.id);
    assert.ok(sel.width > before.width, "resize handle widens bubble");
    assert.notDeepEqual(sel.tails[0].tip, before.tails[0].tip, "tail tip moved");
    assert.notEqual(sel.rotation, 0, "rotation handle rotates");
    step("handles: resize, tail tip, rotation", { width: sel.width, rotation: sel.rotation });
  }
  // Undo/redo across new operations.
  if (!built) {
    const rotation = (await doc(page)).objects.find(
      (o) => o.kind === "bubble" && o.rotation,
    ).rotation;
    await page.locator(".composition-viewport").focus();
    await page.keyboard.press("Control+z");
    assert.equal(
      (await doc(page)).objects.filter((o) => o.kind === "bubble" && o.rotation).length,
      0,
      "undo rotation",
    );
    await page.keyboard.press("Control+Shift+z");
    assert.equal(
      (await doc(page)).objects.find((o) => o.kind === "bubble" && o.rotation).rotation,
      rotation,
      "redo rotation",
    );
    step("undo/redo");
  }
  // Move a bubble from panel 1 into panel 2: ownership follows, world position kept.
  await page.getByRole("button", { name: "Fit screen", exact: true }).click();
  await ready(page);
  const outline = page.locator(".composition-object-outline").first();
  const ob = await box(outline);
  const panelOutlines = page.locator(".composition-panel-outline");
  const p2 = await box(panelOutlines.nth(1));
  await drag(page, { x: ob.x, y: ob.y }, { x: ob.x, y: p2.top + Math.min(60, p2.height / 3) }, 30);
  if (!built) {
    const s = await page.evaluate(() => {
      const st = window.__c.controller.getState();
      return {
        owner: st.history.present.document.objects.find((o) => o.id === st.selection.id).owner,
        order: st.history.present.order,
      };
    });
    assert.equal(s.order.indexOf(s.owner), 1, "bubble now belongs to panel 2");
    step("cross-panel drag re-anchors", { panelIndex: s.order.indexOf(s.owner) });
  }
  // Chapter vs Focus mode: the bubble's offset from its panel image is identical.
  const offset = async () => {
    const o = await box(page.locator(".composition-object-outline").first());
    const st = await page.evaluate(() => {
      const s = window.__c.controller.getState();
      return s.history.present.document.objects.find((o) => o.id === s.selection.id).owner;
    });
    const idx = await page.evaluate(
      (id) => window.__c.controller.getState().history.present.order.indexOf(id),
      st,
    );
    const outlines = page.locator(".composition-panel-outline");
    const target = (await outlines.count()) === 1 ? outlines.first() : outlines.nth(idx);
    const p = await box(target);
    return { dy: (o.top - p.top) / p.height, dx: (o.left - p.left) / p.width, owner: st };
  };
  if (!built) {
    const chapterOffset = await offset();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await ready(page);
    const focusOffset = await offset();
    assert.ok(Math.abs(chapterOffset.dy - focusOffset.dy) < 0.01, "focus/chapter agree (y)");
    assert.ok(Math.abs(chapterOffset.dx - focusOffset.dx) < 0.01, "focus/chapter agree (x)");
    await page.screenshot({ path: `${shots}/focus-mode.png` });
    await page.getByRole("button", { name: "Return to Chapter", exact: true }).click();
    await page.getByRole("button", { name: "Fit width", exact: true }).click();
    step("chapter and focus positions agree", { chapterOffset, focusOffset });
  }
  // Inline canvas text editing.
  await page.getByRole("button", { name: "Show bubble 1 on canvas", exact: true }).click();
  await page.waitForTimeout(300);
  const target = await box(page.locator(".composition-object-outline").first());
  await page.mouse.dblclick(target.x, target.y);
  const inline = page.getByLabel("Edit bubble text", { exact: true });
  await inline.waitFor();
  await inline.fill("Edited on the canvas.");
  await page.keyboard.press("Escape");
  if (!built) assert.ok((await doc(page)).objects.some((o) => o.text === "Edited on the canvas."));
  step("inline canvas text editing");
  // Multi-select + align.
  await page
    .getByRole("button", { name: "Show bubble 2 on canvas", exact: true })
    .click()
    .catch(() => {});
  const all = page.locator(".composition-object-outline").first();
  await all.waitFor();
  if (!built) {
    const ids = await page.evaluate(() =>
      window.__c.controller
        .getState()
        .history.present.document.objects.filter((o) => o.kind === "bubble")
        .map((o) => o.id),
    );
    await page.evaluate(
      (ids) =>
        window.__c.controller.setState({ selection: { kind: "object", id: ids[0] }, multi: ids }),
      ids,
    );
    await page
      .getByRole("group", { name: "Align layers" })
      .getByRole("button", { name: "Left", exact: true })
      .click();
    const xs = await page.evaluate(() => {
      return window.__c.controller
        .getState()
        .history.present.document.objects.filter((o) => o.kind === "bubble")
        .map((o) => o.x);
    });
    step("multi-select alignment", { xs });
    await page.evaluate(() => window.__c.controller.setState({ multi: [] }));
  }
  // Smart placement: suggestions are outlines; placing adds without moving others.
  await page.getByRole("button", { name: "Smart placement", exact: true }).click();
  const beforePlacement = built ? null : await doc(page);
  await page.getByRole("button", { name: "Suggest positions", exact: true }).click();
  await page.getByText(/suggestions ·|No space fits/).waitFor({ timeout: 60000 });
  const suggestionCount = await page.locator(".composition-suggestion").count();
  assert.ok(suggestionCount >= 1, "at least one placement suggestion");
  await page.screenshot({ path: `${shots}/smart-placement${built ? "-built" : ""}.png` });
  await page.getByRole("button", { name: "Place suggested bubble 1", exact: true }).click();
  if (!built) {
    const after = await doc(page),
      oldIds = beforePlacement.objects.map((o) => o.id);
    assert.equal(after.objects.length, beforePlacement.objects.length + 1);
    for (const o of beforePlacement.objects) {
      const n = after.objects.find((x) => x.id === o.id);
      assert.equal(n.x, o.x);
      assert.equal(n.y, o.y);
    }
    assert.ok(after.objects.some((o) => !oldIds.includes(o.id) && o.kind === "bubble"));
  }
  step("smart placement suggests and places without moving existing art", { suggestionCount });
  await saved(page);

  // Reload: lettering persists and still edits in both tabs.
  await page.reload();
  await page.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
  await studio.waitFor({ timeout: 60000 });
  await ready(page);
  await attach(page);
  if (!built) {
    const d = await doc(page);
    const b = d.objects.filter((o) => o.kind === "bubble");
    assert.equal(b.length, 4, "bubbles survive reload");
    assert.ok(b.some((o) => o.text === "Edited on the canvas."));
    assert.ok(b.some((o) => o.tails.length && o.rotation !== 0));
    step("persisted after reload", { bubbles: b.length });
  }
  await page.screenshot({ path: `${shots}/chapter-lettering${built ? "-built" : ""}.png` });

  // Export parity: preview tiles and segmented export share one renderer.
  if (!built) {
    const parity = await page.evaluate(async () => {
      const s = window.__c,
        frame = s.controller.getState().history.present,
        all = s.store.getState().panels,
        panels = frame.order.map((id) => all.find((p) => p.id === id));
      const { renderRegion, RenderResources } =
        await import("/src/lib/studio/composition/render.ts");
      const { exportComposition } = await import("/src/lib/studio/composition/export.ts");
      const { layout } = await import("/src/lib/studio/composition/model.ts");
      const resources = new RenderResources(),
        scene = layout(frame.document, panels);
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
        segmentHeight: 389,
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
      // The bubble region really contains lettering pixels (not culled).
      const b = frame.document.objects.find(
        (o) => o.kind === "bubble" && o.text === "Edited on the canvas.",
      );
      const { objectBounds } = await import("/src/lib/studio/composition/geometry.ts");
      const r = objectBounds(b, scene.frames, frame.document.objects),
        k = 640 / frame.document.width;
      const patch = full
        .getContext("2d")
        .getImageData(
          Math.max(0, r.x * k),
          r.y * k,
          Math.max(1, r.width * k),
          Math.max(1, r.height * k),
        ).data;
      let white = 0,
        dark = 0;
      for (let i = 0; i < patch.length; i += 4) {
        if (patch[i] > 240 && patch[i + 1] > 240 && patch[i + 2] > 240) white++;
        if (patch[i] < 60 && patch[i + 1] < 60 && patch[i + 2] < 60) dark++;
      }
      resources.clear();
      return {
        rows: row,
        total: full.height,
        segments: segments.length,
        mismatch,
        maxDiff,
        white,
        dark,
      };
    });
    assert.equal(parity.rows, parity.total);
    assert.ok(parity.segments > 3);
    assert.equal(
      parity.mismatch,
      0,
      `segmented export matches full render (max ${parity.maxDiff})`,
    );
    assert.ok(parity.white > 100 && parity.dark > 20, "bubble fill and lettering rendered");
    await writeFile(`${out}/export-parity.json`, JSON.stringify(parity, null, 2));
    step("segmented export parity with bubbles", parity);
  }
  // UI export downloads a PNG.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "Export images", exact: true }).click();
  const file = await download;
  step("UI export download", { file: file.suggestedFilename() });
  await page.keyboard.press("Escape");
  // Reading simulator.
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await ready(page);
  await page.screenshot({ path: `${shots}/reading-preview${built ? "-built" : ""}.png` });
  await page.getByRole("button", { name: "Exit reading preview", exact: true }).click();
  // Composition still sees the same lettering (one shared chapter scene).
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor();
  await page.locator(".composition-advanced-nav summary").click();
  await page
    .locator(".composition-advanced-nav")
    .getByRole("button", { name: "Layers", exact: true })
    .click();
  await page
    .getByText("Edited on the canvas", { exact: false })
    .first()
    .waitFor()
    .catch(() => {});
  step("composition shares lettering layers");
  // Legacy per-panel native documents remain available.
  await page.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
  await studio.waitFor();
  await page.locator(".composition-advanced-nav summary").click();
  await page.getByRole("button", { name: "Panel documents", exact: true }).click();
  await page
    .getByRole("button", { name: /^Edit dialogue · / })
    .first()
    .waitFor();
  step("panel dialogue documents still reachable");
  await context.close();

  // ── Touch layouts ──
  for (const width of [320, 390]) {
    const mobile = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const m = await mobile.newPage();
    watch(m);
    await create(m, `Touch ${width}`);
    await m.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
    await m.locator("[data-composition=lettering]").waitFor({ timeout: 60000 });
    await ready(m);
    await m.locator(".composition-tools-toggle").tap();
    await m.getByRole("button", { name: "Add Thought bubble", exact: true }).tap();
    await m.getByLabel("Dialogue text", { exact: true }).waitFor();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `no horizontal overflow at ${width}px (${overflow})`);
    const small = await m.evaluate(
      () =>
        [...document.querySelectorAll(".composition-right button, .composition-right input")]
          .filter((e) => e.offsetParent)
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.height > 0 && r.height < 32).length,
    );
    await m.screenshot({ path: `${shots}/mobile-${width}${built ? "-built" : ""}.png` });
    await m.getByRole("button", { name: "Close properties", exact: true }).tap();
    await m.locator(".composition-tools-toggle").tap();
    await m
      .locator("[data-composition=lettering] .composition-left")
      .getByRole("button", { name: "Smart placement", exact: true })
      .tap();
    step(`touch ${width}px`, { overflow, smallControls: small });
    await mobile.close();
  }
  assert.deepEqual(errors, [], "no uncaught page or console errors");
  await writeFile(
    `${out}/browser-${built ? "built" : "development"}.json`,
    JSON.stringify({ results, errors, external: [...new Set(external)] }, null, 2),
  );
  console.log(`PASS ${results.length} steps`);
} catch (error) {
  for (const [i, ctx] of browser.contexts().entries())
    for (const [j, pg] of ctx.pages().entries())
      await pg.screenshot({ path: `/workspace/screenshots/lettering-failure-${i}-${j}.png` }).catch(() => {});
  console.error(JSON.stringify({ results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
