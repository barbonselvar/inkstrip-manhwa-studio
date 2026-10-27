import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  fx = proBrowserFixtures(base, errors),
  results = [];
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  for (const width of process.argv.includes("--quick") ? [1440] : [1440, 768, 390, 360, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage();
    await fx.start(p);
    await fx.open(p);
    const original = (await fx.native(p)).value,
      preview = await fx.preview(p);
    const nav = p.getByRole("navigation", { name: "Pro panels", exact: true }),
      buttons = nav.getByRole("button"),
      first = buttons.first(),
      last = buttons.last();
    await first.focus();
    await first.press("End");
    assert.equal(await last.getAttribute("aria-pressed"), "true");
    assert.equal(await last.evaluate((e) => document.activeElement === e), true);
    await last.press("ArrowRight");
    assert.equal(await first.getAttribute("aria-pressed"), "true");
    await first.press("ArrowLeft");
    assert.equal(await last.getAttribute("aria-pressed"), "true");
    await last.press("Home");
    assert.equal(await first.getAttribute("aria-pressed"), "true");
    assert.deepEqual(
      (await fx.native(p)).value,
      original,
      "navigation arrows cannot nudge selected artwork",
    );
    fx.same(await fx.preview(p), preview, 0);
    await p.getByRole("button", { name: "Brush tool", exact: true }).click();
    await fx.tab(p, "Properties");
    await p.locator("#pro-brush-settings > summary").click();
    assert.equal(await p.locator("#pro-brush-settings").evaluate((e) => e.open), false);
    await p.getByRole("button", { name: "Toggle Pro panels", exact: true }).click();
    await p.getByRole("button", { name: "Tool settings", exact: true }).click();
    await p.waitForFunction(() => document.activeElement?.id === "pro-brush-settings");
    assert.equal(await p.locator("#pro-brush-settings").evaluate((e) => e.open), true);
    const visible = await p.locator("#pro-brush-settings > summary").evaluate((e) => {
      const a = e.getBoundingClientRect(),
        b = e.closest(".pro-panel-content").getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    });
    assert.equal(visible, true, "settings jump brings existing brush controls into view");
    await p.getByRole("button", { name: "Text tool", exact: true }).click();
    await p.getByRole("button", { name: "Tool settings", exact: true }).click();
    await fx.tab(p, "Properties");
    assert.equal(
      await p
        .locator(".pro-panel-tabs")
        .evaluate((e) =>
          e.scrollWidth > e.clientWidth && innerWidth < 800
            ? [...e.querySelectorAll("button")].every((b) => b.getBoundingClientRect().height >= 44)
            : true,
        ),
      true,
    );
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(
      await p.locator(".pro-properties-content").count(),
      1,
      "one existing inspector implementation",
    );
    await p.screenshot({ path: `/workspace/screenshots/r10-inspector-${width}.png` });
    results.push({
      width,
      arrowNavigation: true,
      wrapHomeEnd: true,
      noArtworkNudge: true,
      contextualBrushJump: true,
      closedPanelOpened: true,
      controlsPreserved: true,
      overflow: false,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { results, errors, pixelTolerance: 0, physicalAndroid: false };
  await writeFile(
    "/workspace/r10-evidence/inspector-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
