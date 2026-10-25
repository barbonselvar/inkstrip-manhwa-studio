/** R3 real brush engine checks: actual renderer pixels, real UI pointer input, worker
 * rendering, native save/reopen and PNG export. Pressure uses synthetic CDP pen events
 * (labelled as such); no physical stylus or Android hardware is claimed. */
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  results = [];
const near = (a, b, tolerance = 0.75, message = "") =>
  assert.ok(Math.abs(a - b) <= tolerance, `${message} ${a} is not near ${b}`);
async function panel(p, visible = true) {
  const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if (((await b.getAttribute("aria-expanded")) === "true") !== visible) await b.click();
}
async function native(p, fx) {
  await panel(p);
  return (await fx.native(p)).value;
}
async function exported(p, fx) {
  await panel(p);
  return fx.raster(p);
}
/** Screen position of a 128 × 96 document point through zoom, pan and view rotation. */
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
async function drag(p, fx, from, to, touch, { steps = 8, cancel = false } = {}) {
  await panel(p, false);
  await fx.artboardBounds(p);
  const a = await point(p, ...from),
    b = await point(p, ...to);
  if (touch) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
    for (let i = 1; i <= steps; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps });
    if (cancel) await p.keyboard.press("Escape");
    await p.mouse.up();
  }
  await fx.preview(p);
}
/** Synthetic Chromium pen events: exercise the pressure code path, not stylus hardware. */
async function penDrag(p, fx, from, to, force) {
  await panel(p, false);
  await fx.artboardBounds(p);
  const a = await point(p, ...from),
    b = await point(p, ...to),
    cdp = await p.context().newCDPSession(p),
    pen = { pointerType: "pen", force, button: "left" };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...a, ...pen, buttons: 0 });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...a,
    ...pen,
    buttons: 1,
    clickCount: 1,
  });
  for (let i = 1; i <= 6; i++)
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: a.x + ((b.x - a.x) * i) / 6,
      y: a.y + ((b.y - a.y) * i) / 6,
      ...pen,
      buttons: 1,
    });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...b, ...pen, buttons: 0 });
  await cdp.detach();
  await fx.preview(p);
}
/** Re-import an exact native export (its own envelope version and assets). */
async function reopen(p, fx, envelope, document = envelope.document) {
  await panel(p);
  await fx.tab(p, "History");
  const count = await p.locator(".pro-history-list li").count();
  await fx.tab(p, "Assets");
  await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
    {
      name: "r3.inkstrip",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...envelope, document })),
    },
  ]);
  await p
    .getByText("Native document imported into this Pro draft. Chapter unchanged.", { exact: true })
    .waitFor();
  await fx.tab(p, "History");
  await p.waitForFunction(
    (n) => document.querySelectorAll(".pro-history-list li").length === Math.min(51, n + 1),
    count,
  );
}
async function section(p, title) {
  const summary = p.locator("details.tool-section > summary", {
    hasText: new RegExp(`^${title}$`),
  });
  if (!(await summary.evaluate((el) => el.parentElement.open))) await summary.click();
}
async function setNumber(p, fx, label, value) {
  await panel(p);
  await fx.tab(p, "Properties");
  const field = p.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press("Tab");
}
async function chooseTool(p, name) {
  await p.getByRole("button", { name: `${name} tool`, exact: true }).click();
}
const paintLayer = (d) => d.document.layers.find((l) => l.name === "R3 Paint");
const alpha = (img, x, y) => img.pixels[(y * img.width + x) * 4 + 3];

try {
  // A. Renderer pixels: real stroke() into a Chromium canvas.
  {
    const p = await browser.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base, { waitUntil: "networkidle" });
    // The dev server may reload once while optimizing a first-time module import.
    const evaluate = async (fn) => {
      try {
        return await p.evaluate(fn);
      } catch (e) {
        if (!/context was destroyed/.test(e.message)) throw e;
        await p.waitForLoadState("networkidle");
        return p.evaluate(fn);
      }
    };
    const r = await evaluate(async () => {
      const { stroke } = await import("/src/lib/studio/pro/render.ts");
      const W = 120,
        H = 60;
      const draw = (s, under) => {
        const c = new OffscreenCanvas(W, H),
          x = c.getContext("2d");
        if (under) {
          x.fillStyle = under;
          x.fillRect(0, 0, W, H);
        }
        stroke(x, s);
        return x.getImageData(0, 0, W, H).data;
      };
      const A = (d, x, y) => d[(y * W + x) * 4 + 3];
      const base = { size: 20, hardness: 1, opacity: 1, flow: 1, color: "#000000", erase: false },
        line = [
          { x: 20, y: 30 },
          { x: 100, y: 30 },
        ],
        dyn = {
          spacing: 0.1,
          roundness: 1,
          angle: 0,
          scatter: 0,
          sizeJitter: 0,
          opacityJitter: 0,
          opacityPressure: false,
          velocity: 0,
          followDirection: false,
        };
      const profile = (h) => {
        const d = draw({ ...base, hardness: h, flow: 0.25, dynamics: dyn, points: line });
        return [30, 33, 36, 38, 39].map((y) => A(d, 60, y));
      };
      const crispStroke = draw({ ...base, points: line }),
        crisp = [30, 34, 37, 39, 41].map((y) => A(crispStroke, 60, y));
      const sq = draw({ ...base, tip: "square", size: 6, points: [{ x: 60, y: 30 }] });
      const pencil = [];
      for (let y = 25; y <= 35; y++) for (let x = 55; x <= 65; x++) pencil.push(A(sq, x, y));
      return {
        crisp,
        hard: profile(1),
        medium: profile(0.5),
        soft: profile(0),
        opacityCap: A(
          draw({
            ...base,
            opacity: 0.5,
            points: [...line, { x: 20, y: 30 }, { x: 100, y: 30 }],
          }),
          60,
          30,
        ),
        flowDab: A(draw({ ...base, flow: 0.5, points: [{ x: 60, y: 30 }] }), 60, 30),
        flowStroke: A(draw({ ...base, flow: 0.5, points: line }), 60, 30),
        flowOpacity: A(draw({ ...base, flow: 0.2, opacity: 0.6, points: line }), 60, 30),
        spacingDense: A(
          draw({ ...base, flow: 0.2, dynamics: { ...dyn, spacing: 0.05 }, points: line }),
          60,
          30,
        ),
        spacingSparse: A(
          draw({ ...base, flow: 0.2, dynamics: { ...dyn, spacing: 1 }, points: line }),
          60,
          30,
        ),
        gapAtSparse: A(
          draw({ ...base, size: 4, dynamics: { ...dyn, spacing: 2 }, points: line }),
          24,
          30,
        ),
        pencilValues: [...new Set(pencil)].sort((a, b) => a - b),
        pencilEdge: [A(sq, 56, 30), A(sq, 57, 30), A(sq, 62, 30), A(sq, 63, 30)],
        erase: (() => {
          const d = draw(
            { ...base, erase: true, opacity: 0.5, points: line },
            "rgba(255, 0, 0, 0.6)",
          );
          return { inside: A(d, 60, 30), outside: A(d, 60, 5), red: d[(30 * W + 60) * 4] };
        })(),
        softErase: (() => {
          const d = draw(
            {
              ...base,
              erase: true,
              hardness: 0,
              flow: 0.35,
              size: 30,
              dynamics: dyn,
              points: line,
            },
            "#00ff00",
          );
          return [30, 38, 43].map((y) => A(d, 60, y));
        })(),
      };
    });
    assert.deepEqual(
      r.crisp,
      [255, 255, 255, 250, 0],
      "100% hardness: opaque to the rim, then none",
    );
    for (let i = 1; i < 5; i++)
      assert.ok(r.hard[i] > r.medium[i] && r.medium[i] > r.soft[i], `hardness orders offset ${i}`);
    assert.ok(r.soft[0] > r.soft[2] && r.soft[2] > r.soft[4], "soft brush falls off");
    near(r.opacityCap, 128, 2, "opacity caps overlapping passes within one stroke");
    near(r.flowDab, 128, 2, "one dab deposits flow");
    assert.ok(r.flowStroke > 240, "flow builds up along a stroke");
    assert.ok(
      r.flowOpacity > r.flowDab * 0.6 * 0.4 && r.flowOpacity <= 154,
      "flow builds up to, never past, opacity",
    );
    assert.ok(r.spacingDense > r.spacingSparse, "spacing changes deposition");
    assert.equal(r.gapAtSparse, 0, "spacing is measured in brush diameters");
    assert.deepEqual(r.pencilValues, [0, 255], "pencil has no soft edge");
    assert.deepEqual(r.pencilEdge, [0, 255, 255, 0]);
    near(r.erase.inside, 77, 2, "eraser removes half the alpha");
    near(r.erase.outside, 153, 1);
    assert.equal(r.erase.red, 255, "eraser does not paint a background colour");
    assert.ok(r.softErase[0] < r.softErase[1] && r.softErase[1] < r.softErase[2]);
    results.push({ renderer: r });
    await p.close();
  }

  // B. Real UI workflows at every width.
  for (const width of [1440, 768, 390, 360, 320]) {
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
    const d = fromPanel({ id: "r3", name: "R3", width: 128, height: 96 }),
      paint = layer("paint", 128, 96, "paint");
    paint.name = "R3 Paint";
    d.layers = [paint];
    await fx.load(p, d, source);
    await chooseTool(p, "Brush");
    await setNumber(p, fx, "Brush size", 6);
    await setNumber(p, fx, "Brush hardness", 100);
    await setNumber(p, fx, "Stroke smoothing", 60);
    await setNumber(p, fx, "Brush stabilization", 12);

    // 1. Smoothed + stabilized stroke ends where the pointer lifts.
    await drag(p, fx, [16, 20], [110, 20], touch, { steps: 10 });
    let saved = await native(p, fx),
      s = paintLayer(saved).strokes.at(-1);
    near(s.points[0].x, 16);
    near(s.points.at(-1).x, 110, 0.75, "smoothed stroke end");
    near(s.points.at(-1).y, 20);
    await setNumber(p, fx, "Stroke smoothing", 0);
    await setNumber(p, fx, "Brush stabilization", 0);

    // 2. Brush, pencil and eraser at 0/90/180/270° view rotation.
    const angles = [];
    for (const [i, angle] of ["0°", "90°", "-180°", "-90°"].entries()) {
      if (i) await p.getByRole("button", { name: "Rotate canvas view right", exact: true }).click();
      assert.equal(await p.getByLabel("Canvas view angle", { exact: true }).textContent(), angle);
      const y = 34 + i * 12;
      await chooseTool(p, i % 2 ? "Pencil" : "Brush");
      await drag(p, fx, [20, y], [100, y], touch);
      saved = await native(p, fx);
      s = paintLayer(saved).strokes.at(-1);
      near(s.points[0].x, 20, 0.75, `${angle} start`);
      near(s.points[0].y, y, 0.75, `${angle} start`);
      near(s.points.at(-1).x, 100, 0.75, `${angle} end`);
      near(s.points.at(-1).y, y, 0.75, `${angle} end`);
      if (i % 2) assert.equal(s.tip, "square");
      angles.push(angle);
    }
    const rotated = await exported(p, fx);
    await p.getByRole("button", { name: "Reset canvas view rotation", exact: true }).click();
    const upright = await exported(p, fx);
    fx.same(rotated, upright, 0);
    assert.equal(rotated.width, 128);
    for (const y of [34, 46, 58, 70]) assert.equal(alpha(upright, 60, y), 255, `row ${y} painted`);
    // Eraser at 90°: real alpha removal on the painted rows, other rows untouched.
    await p.getByRole("button", { name: "Rotate canvas view right", exact: true }).click();
    await chooseTool(p, "Eraser");
    await setNumber(p, fx, "Brush size", 30);
    await drag(p, fx, [60, 30], [60, 50], touch);
    saved = await native(p, fx);
    assert.equal(paintLayer(saved).strokes.at(-1).erase, true);
    await p.getByRole("button", { name: "Reset canvas view rotation", exact: true }).click();
    const erased = await exported(p, fx);
    assert.equal(alpha(erased, 60, 34), 0, "eraser removed alpha");
    assert.equal(alpha(erased, 60, 46), 0, "eraser removed alpha");
    assert.equal(alpha(erased, 60, 70), 255, "rows outside the eraser stay");
    assert.equal(alpha(erased, 20, 34), 255, "eraser is local");
    // Undo restores the erased artwork exactly; redo erases again.
    await panel(p);
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    fx.same(await exported(p, fx), upright, 0);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    fx.same(await exported(p, fx), erased, 0);

    // 3. Brush cursor matches the dab footprint on a scaled layer.
    await chooseTool(p, "Brush");
    await setNumber(p, fx, "Brush size", 20);
    const envelope = await native(p, fx),
      scaled = structuredClone(envelope.document);
    paintLayer({ document: scaled }).transform = { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0 };
    await reopen(p, fx, envelope, scaled);
    await chooseTool(p, "Brush");
    await panel(p, false);
    const board = await fx.artboardBounds(p),
      at = await point(p, 64, 48);
    await p.mouse.move(at.x, at.y);
    const cursor = await p.locator('[data-brush-cursor="round"] ellipse').first().boundingBox();
    near(cursor.width, ((20 * 2) / 128) * board.width, 2, "cursor follows layer scale");
    await chooseTool(p, "Pencil");
    await p.mouse.move(at.x + 1, at.y);
    assert.equal(await p.locator('[data-brush-cursor="square"] rect').count(), 1);

    // 4. Presets: factory recipe applies; inline save/duplicate/rename/delete/reset.
    await chooseTool(p, "Brush");
    await panel(p);
    await fx.tab(p, "Properties");
    await p.getByLabel("Brush preset", { exact: true }).selectOption("G-Pen");
    assert.equal(await p.getByLabel("Brush size", { exact: true }).inputValue(), "14");
    assert.equal(await p.getByLabel("Brush preset", { exact: true }).inputValue(), "G-Pen");
    await section(p, "Pen pressure");
    assert.equal(await p.getByLabel("Pen pressure size", { exact: true }).isChecked(), true);
    await p.getByLabel("Brush size", { exact: true }).fill("9");
    await p.getByLabel("Brush size", { exact: true }).press("Tab");
    await p.getByRole("button", { name: "Save current preset", exact: true }).click();
    await p.getByLabel("New preset name", { exact: true }).fill(`Inks ${width}`);
    await p.getByRole("button", { name: "Save preset", exact: true }).click();
    assert.equal(await p.getByLabel("Brush preset", { exact: true }).inputValue(), `Inks ${width}`);
    await p.getByRole("button", { name: "Duplicate preset", exact: true }).click();
    await p.getByRole("button", { name: "Rename preset", exact: true }).click();
    await p.getByLabel("Rename preset to", { exact: true }).fill("Speed lines");
    await p.getByRole("button", { name: "Save name", exact: true }).click();
    assert.equal(await p.getByLabel("Brush preset", { exact: true }).inputValue(), "Speed lines");
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "no horizontal overflow with the preset manager",
    );
    await p.screenshot({ path: `/workspace/screenshots/r3-brush-${width}.png` });
    await p.getByRole("button", { name: "Delete preset", exact: true }).click();
    await p.getByRole("button", { name: "Confirm delete", exact: true }).click();
    const names = await p
      .getByLabel("Brush preset", { exact: true })
      .locator("option")
      .allTextContents();
    assert.ok(names.includes(`Inks ${width}`) && !names.includes("Speed lines"));
    await p.getByLabel("Brush preset", { exact: true }).selectOption(`Inks ${width}`);
    assert.equal(await p.getByLabel("Brush size", { exact: true }).inputValue(), "9");

    // 5. Native save/reopen keeps every stroke and the exported pixels.
    const before = await native(p, fx),
      beforePixels = await exported(p, fx);
    await reopen(p, fx, before);
    const reopened = await native(p, fx);
    assert.deepEqual(paintLayer(reopened).strokes, paintLayer(before).strokes);
    fx.same(await exported(p, fx), beforePixels, 0);

    if (!touch) {
      // 6. Synthetic pen pressure (CDP): curve shapes recorded pressure; mouse records none.
      await panel(p);
      await fx.tab(p, "Properties");
      await p.getByRole("button", { name: "Reset presets", exact: true }).click();
      await p.getByRole("button", { name: "Confirm reset", exact: true }).click();
      assert.ok(
        !(
          await p.getByLabel("Brush preset", { exact: true }).locator("option").allTextContents()
        ).includes(`Inks ${width}`),
      );
      // Saving as new never overwrites an existing preset name.
      await p.getByRole("button", { name: "Save current preset", exact: true }).click();
      await p.getByLabel("New preset name", { exact: true }).fill("G-Pen");
      await p.getByRole("button", { name: "Save preset", exact: true }).click();
      await p.getByText(/A preset named “G-Pen” already exists/).waitFor();
      await p.getByRole("button", { name: "Cancel", exact: true }).click();
      await p.getByLabel("Brush preset", { exact: true }).selectOption("G-Pen");
      assert.equal(await p.getByLabel("Brush size", { exact: true }).inputValue(), "14");
      await p.getByLabel("Brush preset", { exact: true }).selectOption("Mapping Pen");
      await section(p, "Pen pressure");
      await p.getByLabel("Pen pressure size", { exact: true }).check();
      await setNumber(p, fx, "Pen pressure curve", 2);
      await penDrag(p, fx, [20, 84], [100, 84], 0.5);
      saved = await native(p, fx);
      s = paintLayer(saved).strokes.at(-1);
      assert.ok(s.points.length > 1);
      for (const point of s.points) near(point.pressure, 0.25, 0.01, "curved pen pressure");
      await drag(p, fx, [20, 90], [100, 90], false);
      saved = await native(p, fx);
      assert.ok(
        paintLayer(saved)
          .strokes.at(-1)
          .points.every((pt) => pt.pressure === undefined),
      );

      // 7. A very long, dense stroke commits (it used to exceed 10,000 points and vanish).
      await setNumber(p, fx, "Brush size", 2);
      const count = paintLayer(saved).strokes.length;
      await panel(p, false);
      await fx.artboardBounds(p);
      const a = await point(p, 4, 6),
        b = await point(p, 124, 6);
      await p.mouse.move(a.x, a.y);
      await p.mouse.down();
      for (let pass = 0; pass < 6; pass++)
        await p.mouse.move(pass % 2 ? a.x : b.x, a.y + pass, { steps: 2200 });
      await p.mouse.up();
      await fx.preview(p);
      saved = await native(p, fx);
      const long = paintLayer(saved).strokes;
      assert.equal(long.length, count + 1, "long stroke committed");
      assert.ok(long.at(-1).points.length <= 10_000);
      assert.ok(long.at(-1).points.length > 100);
      // A dynamic stroke past the 50,000-unit dab budget ends there and still commits.
      assert.ok(long.at(-1).dynamics, "Mapping Pen strokes use dynamics");
      // No smoothing, so the zigzag really travels its full width. The layer is still
      // scaled 2× from the cursor check and points are layer-local: 900 passes ≈ 54,000.
      await setNumber(p, fx, "Stroke smoothing", 0);
      await panel(p, false);
      await fx.artboardBounds(p);
      // The panel toggle changes the canvas layout; re-measure screen positions.
      const left = await point(p, 4, 6),
        right = await point(p, 124, 6);
      await p.mouse.move(left.x, left.y);
      await p.mouse.down();
      for (let pass = 0; pass < 900; pass++)
        await p.mouse.move(pass % 2 ? left.x : right.x, left.y + (pass % 40) * 0.5, { steps: 3 });
      await p.mouse.up();
      await fx.preview(p);
      await p.getByText(/maximum stroke length/).waitFor();
      saved = await native(p, fx);
      const budget = paintLayer(saved).strokes;
      assert.equal(budget.length, count + 2, "budget-limited stroke committed");
      let path = 0;
      const pts = budget.at(-1).points;
      for (let i = 1; i < pts.length; i++)
        path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      assert.ok(path <= 50_000 && path > 49_000, `stored path ${path}`);

      // 8. Mask painting targets the mask through the stroke's whole lifetime.
      const masked = structuredClone(saved.document),
        maskEnvelope = saved,
        target = paintLayer({ document: masked });
      target.mask = {
        enabled: true,
        inverted: false,
        selection: { regions: [], inverted: true, feather: 0 },
        strokes: [],
      };
      const pixelStrokes = target.strokes.length;
      await reopen(p, fx, maskEnvelope, masked);
      await panel(p);
      await fx.tab(p, "Layers");
      await p.getByRole("button", { name: "Edit mask R3 Paint", exact: true }).click();
      await setNumber(p, fx, "Brush size", 10);
      await drag(p, fx, [30, 40], [90, 40], false);
      saved = await native(p, fx);
      assert.equal(paintLayer(saved).mask.strokes.length, 1, "stroke went to the mask");
      assert.equal(paintLayer(saved).strokes.length, pixelStrokes, "artwork strokes unchanged");
    }
    results.push({ width, touch, angles, overflow: false, saveReopen: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    "/workspace/screenshots/r3-brush-results.json",
    JSON.stringify({ results, errors, syntheticPen: true, physicalStylus: false }, null, 2),
  );
  await browser.close();
}
console.log(
  JSON.stringify(
    { widths: results.filter((r) => r.width).map((r) => r.width), errors, syntheticPen: true },
    null,
    1,
  ),
);
