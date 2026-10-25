/** Real DOM/worker viewport transitions. Observe the first committed view; no sleeps,
 * mocked pixels or dimension/tolerance relaxation can hide a stale-ready bitmap. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors),
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  await mkdir("/workspace/r6-artboard-fix-evidence", { recursive: true });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 500,
        isMobile: width < 500,
      }),
      p = await context.newPage(),
      source = await fx.start(p);
    await fx.open(p, "Vector");
    const d = fromPanel({ id: "far", name: "Viewport readiness", width: 128, height: 96 });
    d.layers[0].visible = false;
    const red = layer("shape", 32, 32, "red"),
      blue = layer("shape", 32, 32, "blue");
    Object.assign(red, { fill: "#ff0000", strokeWidth: 0 });
    red.transform.x = 10008;
    red.transform.y = 8;
    Object.assign(blue, { fill: "#0000ff", strokeWidth: 0 });
    blue.transform.x = -9992;
    blue.transform.y = 8;
    d.layers.push(red, blue);
    d.artboards = [
      {
        id: "east",
        name: "East",
        x: 10000,
        y: 0,
        width: 64,
        height: 64,
        background: "transparent",
      },
      {
        id: "west",
        name: "West",
        x: -10000,
        y: 0,
        width: 64,
        height: 64,
        background: "transparent",
      },
    ];
    await fx.load(p, d, source);
    await fx.tab(p, "Artboards");
    assert.equal((await fx.preview(p)).width, 1400);
    const original = (await fx.native(p)).value;
    await fx.tab(p, "History");
    const historyCount = await p.locator(".pro-history-list li").count();
    for (const id of ["east", "west", "east", "west"]) {
      await fx.tab(p, "Artboards");
      await p.getByLabel("Active artboard", { exact: true }).selectOption(id);
      const x = id === "east" ? 10000 : -10000;
      const transition = await p.evaluate(
        (x) =>
          new Promise((resolve) => {
            const svg = document.querySelector('svg[aria-label="Pro selection overlays"]'),
              canvas = document.querySelector('canvas[aria-label="Pro composite preview"]');
            const observer = new MutationObserver(() => {
              const f = svg.viewBox.baseVal;
              if (f.x === x && f.width === 64) {
                observer.disconnect();
                resolve({
                  frame: [f.x, f.y, f.width, f.height],
                  bitmap: [canvas.width, canvas.height],
                  busy: canvas.getAttribute("aria-busy"),
                });
              }
            });
            observer.observe(svg, { attributes: true, attributeFilter: ["viewBox"] });
            [...document.querySelectorAll("button")]
              .find((b) => b.textContent.trim() === "Fit selected board")
              .click();
          }),
        x,
      );
      assert.deepEqual(transition.frame, [x, 0, 64, 64]);
      assert.equal(
        transition.busy,
        "true",
        "New viewport must be pending in its first DOM commit, before the passive render effect",
      );
      const focused = await fx.preview(p);
      assert.equal(focused.width, 64);
      assert.equal(focused.height, 64);
      assert.deepEqual(
        focused.pixels.slice((16 * 64 + 16) * 4, (16 * 64 + 16) * 4 + 4),
        id === "east" ? [255, 0, 0, 255] : [0, 0, 255, 255],
      );
      results.push({ width, id, ...transition, completed: [focused.width, focused.height] });
    }
    const current = (await fx.native(p)).value;
    assert.deepEqual(current.document, original.document);
    assert.deepEqual(current.assets, original.assets);
    await fx.tab(p, "History");
    assert.equal(await p.locator(".pro-history-list li").count(), historyCount);
    await p.screenshot({ path: `/workspace/screenshots/r6-viewport-${width}.png` });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const record = { passed: true, results, errors, pixelTolerance: 0, historyChanged: false };
  await writeFile(
    "/workspace/r6-artboard-fix-evidence/viewport-browser.json",
    JSON.stringify(record, null, 2),
  );
  console.log(JSON.stringify(record, null, 2));
} finally {
  await browser.close();
}
