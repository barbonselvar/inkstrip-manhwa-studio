/** R2 real canvas/UI/worker/native/export checks. No mocked rendering or document hooks. */
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  results = [];
async function panel(p, visible = true) {
  const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if (((await b.getAttribute("aria-expanded")) === "true") !== visible) await b.click();
}
async function native(p, fx) {
  await panel(p);
  return (await fx.native(p)).value;
}
async function point(p, x, y) {
  return p.locator(".pro-artboard").evaluate(
    (el, { x, y }) => {
      const v = el.parentElement.getBoundingClientRect(),
        s = getComputedStyle(el),
        w = parseFloat(s.width),
        h = parseFloat(s.height);
      const q = new DOMPoint((x / 128 - 0.5) * w, (y / 96 - 0.5) * h).matrixTransform(
        new DOMMatrix(s.transform),
      );
      return { x: v.left + v.width / 2 + w / 2 + q.x, y: v.top + v.height / 2 + h / 2 + q.y };
    },
    { x, y },
  );
}
async function drag(p, fx, from, to, touch, cancel = false) {
  await panel(p, false);
  await fx.artboardBounds(p);
  const a = await point(p, ...from),
    b = await point(p, ...to);
  if (touch) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
    for (let i = 1; i <= 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps: 8 });
    if (cancel) await p.keyboard.press("Escape");
    await p.mouse.up();
  }
  await fx.preview(p);
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.75, `${a} is not near ${b}`);
try {
  for (const width of [1440, 320, 360, 390, 768]) {
    const touch = width < 800,
      context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 1000 },
        hasTouch: touch,
        isMobile: width < 500,
      });
    const p = await context.newPage(),
      fx = proBrowserFixtures(base, errors);
    const source = await fx.start(p);
    await fx.open(p);
    const before = await native(p, fx),
      original = await fx.preview(p);
    await p.evaluate(() => {
      const post = Worker.prototype.postMessage;
      window.__viewPreviewRequests = 0;
      Worker.prototype.postMessage = function (data, ...rest) {
        if (data.type === "preview") window.__viewPreviewRequests++;
        return post.call(this, data, ...rest);
      };
    });
    for (const [name, angle] of [
      ["Rotate canvas view right", "90°"],
      ["Rotate canvas view right", "-180°"],
      ["Rotate canvas view left", "90°"],
      ["Reset canvas view rotation", "0°"],
    ]) {
      await p.getByRole("button", { name, exact: true }).click();
      assert.equal(await p.getByLabel("Canvas view angle", { exact: true }).textContent(), angle);
    }
    await p.keyboard.press("Alt+BracketLeft");
    assert.equal(await p.getByLabel("Canvas view angle", { exact: true }).textContent(), "-90°");
    await p.keyboard.press("Alt+Backslash");
    assert.equal(await p.getByLabel("Canvas view angle", { exact: true }).textContent(), "0°");
    assert.equal(
      await p.evaluate(() => window.__viewPreviewRequests),
      0,
      "view rotation must not request recomposition",
    );
    assert.deepEqual(
      await native(p, fx),
      before,
      "view controls cannot change native geometry/assets",
    );
    await p.getByRole("button", { name: "Rotate canvas view right", exact: true }).click();
    await panel(p);
    await p.screenshot({ path: `/workspace/screenshots/r2-rotated-${width}.png` });
    fx.same(await fx.raster(p), original, 0);
    const d = fromPanel({ id: "r2", name: "R2", width: 128, height: 96 }),
      paint = layer("paint", 128, 96, "paint");
    paint.name = "R2 Paint";
    d.layers = [paint];
    await fx.load(p, d, source);
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    await fx.tab(p, "Properties");
    await p.getByLabel("Stroke smoothing", { exact: true }).fill("0");
    await p.getByLabel("Stroke smoothing", { exact: true }).press("Tab");
    await p.getByLabel("Brush size", { exact: true }).fill("6");
    await p.getByLabel("Brush size", { exact: true }).press("Tab");
    await p.getByRole("button", { name: "Pro zoom in", exact: true }).click();
    await p.getByRole("button", { name: "Hand tool", exact: true }).click();
    await drag(p, fx, [64, 48], [68, 52], touch);
    if (touch) {
      const center = await point(p, 64, 48),
        cdp = await context.newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: center.x - 20, y: center.y },
          { x: center.x + 20, y: center.y },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: center.x - 23, y: center.y + 4 },
          { x: center.x + 23, y: center.y + 4 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    }
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    await drag(p, fx, [32, 30], [80, 30], touch);
    let saved = await native(p, fx),
      s = saved.document.layers.find((l) => l.name === "R2 Paint").strokes.at(-1);
    assert.ok(s);
    near(s.points[0].x, 32);
    near(s.points[0].y, 30);
    near(s.points.at(-1).x, 80);
    near(s.points.at(-1).y, 30);
    const strokeId = saved.document.layers.find((l) => l.name === "R2 Paint").id;
    const painted = await fx.raster(p);
    assert.ok(
      painted.pixels[(30 * 128 + 50) * 4 + 3] > 0,
      "rotated stroke paints the intended source pixels",
    );
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    let undone = await native(p, fx);
    assert.equal(undone.document.layers.find((l) => l.id === strokeId).strokes.length, 0);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    saved = await native(p, fx);
    assert.equal(saved.document.layers.find((l) => l.id === strokeId).strokes.length, 1);
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    await drag(p, fx, [40, 50], [70, 55], touch, true);
    assert.deepEqual(
      await native(p, fx),
      saved,
      "cancelled rotated stroke must not record a partial change",
    );
    await p.getByRole("button", { name: "Rectangle selection tool", exact: true }).click();
    await drag(p, fx, [20, 20], [60, 55], touch);
    const selection = (await native(p, fx)).document.selection.regions.at(-1);
    near(selection.points[0].x, 20);
    near(selection.points[0].y, 20);
    near(selection.points[1].x, 60);
    near(selection.points[1].y, 55);
    // Selection clear through the existing shortcut/control; transforms remain editable.
    await fx.tab(p, "Properties");
    await p.getByRole("button", { name: "Deselect", exact: true }).click();
    // Navigator centering must honor the rotated view, not the unrotated axes.
    await panel(p, false);
    await p.getByRole("button", { name: "Pro zoom in", exact: true }).click();
    const nav = await p.locator(".pro-navigator").boundingBox(),
      scale = Math.min(nav.width / 128, nav.height / 96),
      target = {
        x: nav.x + (nav.width - 128 * scale) / 2 + 100 * scale,
        y: nav.y + (nav.height - 96 * scale) / 2 + 20 * scale,
      };
    if (touch) await p.touchscreen.tap(target.x, target.y);
    else await p.mouse.click(target.x, target.y);
    const centered = await point(p, 100, 20),
      viewportBox = await p.locator(".pro-viewport").boundingBox();
    assert.ok(
      Math.hypot(
        centered.x - viewportBox.x - viewportBox.width / 2,
        centered.y - viewportBox.y - viewportBox.height / 2,
      ) < 3,
      "rotated navigator click centers the chosen source point",
    );
    await p.getByRole("button", { name: "Fit Pro canvas", exact: true }).click();
    assert.equal(await p.getByLabel("Canvas view angle", { exact: true }).textContent(), "90°");
    await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
    const initialWidth = await p.getByLabel("Transform width", { exact: true }).inputValue();
    await panel(p, false);
    await fx.artboardBounds(p);
    const handle = p.locator('[data-transform-handle="se"]');
    assert.ok(await handle.isVisible());
    const box = await handle.boundingBox();
    if (touch) {
      const cdp = await context.newCDPSession(p);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: box.x + box.width / 2 - 10, y: box.y + box.height / 2 + 10 }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down();
      await p.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2 + 10, { steps: 6 });
      await p.mouse.up();
    }
    await panel(p);
    assert.notEqual(
      await p.getByLabel("Transform width", { exact: true }).inputValue(),
      initialWidth,
      "rotated handle must actually change the transform preview",
    );
    await p
      .locator(".pro-context-bar")
      .getByRole("button", { name: "Cancel transform", exact: true })
      .click();
    const noTransform = await native(p, fx);
    assert.deepEqual(
      noTransform.document.layers.find((l) => l.id === strokeId).transform,
      saved.document.layers.find((l) => l.id === strokeId).transform,
    );
    // Numeric Enter/Escape keep the existing transform contract; Alt rotation
    // shortcuts cannot steal input from a focused property field.
    await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
    await p.getByLabel("Transform rotation", { exact: true }).fill("15");
    await p.getByLabel("Transform rotation", { exact: true }).press("Alt+BracketRight");
    assert.equal(await p.getByLabel("Canvas view angle", { exact: true }).textContent(), "90°");
    await p.getByLabel("Transform rotation", { exact: true }).press("Enter");
    assert.equal(
      (await native(p, fx)).document.layers.find((l) => l.id === strokeId).transform.rotation,
      15,
    );
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.deepEqual(
      (await native(p, fx)).document.layers.find((l) => l.id === strokeId).transform,
      noTransform.document.layers.find((l) => l.id === strokeId).transform,
    );
    await p.getByRole("button", { name: "Free Transform tool", exact: true }).click();
    await p.getByLabel("Transform rotation", { exact: true }).fill("25");
    await p.getByLabel("Transform rotation", { exact: true }).press("Escape");
    assert.deepEqual(
      (await native(p, fx)).document.layers.find((l) => l.id === strokeId).transform,
      noTransform.document.layers.find((l) => l.id === strokeId).transform,
    );
    // Active-vs-selected feedback, native panel opacity/blend and inline rename.
    await fx.tab(p, "Layers");
    assert.equal(await p.locator('[data-current="true"]').count(), 1);
    await p.getByLabel("Layer panel opacity", { exact: true }).fill("65");
    await p.getByLabel("Layer panel opacity", { exact: true }).press("Tab");
    await p.getByLabel("Layer panel blend", { exact: true }).selectOption("screen");
    await p.getByRole("button", { name: "Layer actions R2 Paint", exact: true }).click();
    await p.getByRole("menuitem", { name: "Rename layer…", exact: true }).click();
    await p.getByLabel("Rename layer", { exact: true }).fill("Renamed paint");
    await p.getByLabel("Rename layer", { exact: true }).press("Enter");
    saved = await native(p, fx);
    const renamed = saved.document.layers.find((l) => l.id === strokeId);
    assert.equal(renamed.name, "Renamed paint");
    assert.equal(renamed.opacity, 0.65);
    assert.equal(renamed.blend, "screen");
    // Actual existing mask creation; the new row target selects the same mask.
    await fx.tab(p, "Properties");
    const maskSection = p.locator("summary").filter({ hasText: /^Layer mask$/ });
    if (!(await maskSection.locator("..").evaluate((e) => e.open))) await maskSection.click();
    await p.getByRole("button", { name: "Mask from selection", exact: true }).click();
    await fx.preview(p);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    await fx.tab(p, "Layers");
    assert.equal(
      await p.getByRole("button", { name: "Edit mask Renamed paint", exact: true }).count(),
      0,
    );
    assert.equal(
      (await p.getByLabel("Active layer Renamed paint", { exact: true }).textContent()).includes(
        "mask",
      ),
      false,
      "undoing mask creation must disarm mask-edit mode",
    );
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    await p.getByRole("button", { name: "Edit mask Renamed paint", exact: true }).click();
    assert.equal(
      await p
        .getByRole("button", { name: "Edit mask Renamed paint", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(
      await p
        .getByLabel("Active layer Renamed paint", { exact: true })
        .textContent()
        .then((x) => x.includes("mask")),
    );
    await p.getByRole("button", { name: "Eraser tool", exact: true }).click();
    await drag(p, fx, [40, 30], [65, 30], touch);
    saved = await native(p, fx);
    assert.equal(saved.document.layers.find((l) => l.id === strokeId).mask.strokes.length, 1);
    assert.equal(saved.document.layers.find((l) => l.id === strokeId).strokes.length, 1);
    const pixelsBeforeReopen = await fx.raster(p);
    assert.equal(
      pixelsBeforeReopen.pixels[(30 * 128 + 50) * 4 + 3],
      0,
      "mask erasing must remove coverage without changing the paint stroke",
    );
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await p
      .getByText("Editable Pro draft saved on this device. Chapter unchanged.", { exact: true })
      .waitFor();
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await fx.open(p);
    const reopened = await native(p, fx);
    assert.deepEqual(reopened.document, saved.document);
    assert.equal(await p.getByLabel("Canvas view angle", { exact: true }).textContent(), "0°");
    fx.same(await fx.raster(p), pixelsBeforeReopen, 0);
    await fx.tab(p, "Layers");
    await p.getByRole("button", { name: "Empty group", exact: true }).click();
    const withGroup = await native(p, fx);
    assert.equal(withGroup.document.layers.filter((l) => l.kind === "group").length, 1);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.deepEqual((await native(p, fx)).document, reopened.document);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await fx.tab(p, "Layers");
    await p.locator("img.pro-layer-thumb").first().waitFor();
    const viewport = await p.locator(".pro-viewport").boundingBox();
    assert.ok(viewport.height >= 64, "phone canvas remains usable with its panel open");
    await p.screenshot({ path: `/workspace/screenshots/r2-layers-${width}.png` });
    if (width === 1440) {
      const tiny = layer("shape", 1, 1, "tiny-mask");
      tiny.name = "Tiny mask";
      tiny.mask = {
        enabled: true,
        width: 4096,
        height: 4096,
        strokes: [],
        selection: { regions: [], inverted: true, feather: 0 },
      };
      const bounded = fromPanel({
        id: "tiny",
        name: "Bounded mask thumbnail",
        width: 128,
        height: 96,
      });
      bounded.layers = [tiny];
      await fx.load(p, bounded, source);
      await fx.preview(p);
      await p.evaluate(() => {
        const Native = OffscreenCanvas;
        window.__maskAllocations = [];
        window.OffscreenCanvas = new Proxy(Native, {
          construct(target, args) {
            window.__maskAllocations.push(args[0] * args[1]);
            return Reflect.construct(target, args);
          },
        });
      });
      await fx.tab(p, "Layers");
      await p.waitForFunction(() => {
        const c = document.querySelector(".pro-layer-mask-target canvas");
        return c && c.width <= 96 && c.height <= 72;
      });
      const allocations = await p.evaluate(() => window.__maskAllocations);
      assert.ok(allocations.length > 0);
      assert.ok(
        Math.max(...allocations) <= 20000,
        "large independent mask must not allocate a native-size main-window thumbnail surface",
      );
      const fault = fromPanel({ id: "fault", name: "Thumbnail failure", width: 128, height: 96 });
      fault.layers = [layer("shape", 20, 20, "one"), layer("shape", 20, 20, "two")];
      await fx.load(p, fault, source);
      await fx.preview(p);
      await p.evaluate(() => {
        const create = URL.createObjectURL,
          revoke = URL.revokeObjectURL;
        window.__urls = {
          calls: 0,
          made: [],
          revoked: [],
          restore: () => {
            URL.createObjectURL = create;
            URL.revokeObjectURL = revoke;
          },
        };
        URL.createObjectURL = (b) => {
          if (b.type === "image/png" && ++window.__urls.calls === 2)
            throw new DOMException("Injected thumbnail allocation failure", "QuotaExceededError");
          const u = create.call(URL, b);
          window.__urls.made.push(u);
          return u;
        };
        URL.revokeObjectURL = (u) => {
          window.__urls.revoked.push(u);
          return revoke.call(URL, u);
        };
      });
      await fx.tab(p, "Layers");
      await p.waitForFunction(() => window.__urls.calls >= 2 && window.__urls.revoked.length > 0);
      const cleanup = await p.evaluate(() => {
        const r = { made: window.__urls.made, revoked: window.__urls.revoked };
        window.__urls.restore();
        return r;
      });
      assert.ok(cleanup.made.length > 0);
      assert.ok(
        cleanup.made.every((u) => cleanup.revoked.includes(u)),
        "failed thumbnail batch releases staged URLs",
      );
      assert.deepEqual(
        (await native(p, fx)).document.layers.map((l) => l.id),
        ["one", "two"],
      );
    }
    results.push({
      width,
      touchEmulation: touch,
      viewOnly: true,
      inverseDrawing: true,
      cancellation: true,
      selection: true,
      transformHandleCancel: true,
      nativePanelProperties: true,
      maskTarget: true,
      saveReopen: true,
      exportOrientation: true,
      overflow: false,
    });
    console.log(JSON.stringify({ width, pass: true }));
    await context.close();
  }
  assert.deepEqual(errors, []);
  await mkdir("/workspace/screenshots", { recursive: true });
  await writeFile(
    "/workspace/screenshots/r2-document-results.json",
    JSON.stringify({ results, errors, physicalAndroid: false }, null, 2),
  );
  console.log(JSON.stringify({ results, errors, physicalAndroid: false }, null, 2));
} finally {
  await browser.close();
}
