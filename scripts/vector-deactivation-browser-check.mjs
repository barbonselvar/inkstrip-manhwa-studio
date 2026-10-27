/** Vector Studio deactivation: hidden from the homepage and navigation, Raster Studio is the
 * main editor, legacy vector projects and links still work, and saved data stays intact. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fromPanel, layer } from "../src/lib/studio/pro/model.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [],
  fx = proBrowserFixtures(base, errors);
const visibleText = (p) => p.evaluate(() => document.body.innerText);
const vectorButtons = (p) =>
  p.getByRole("button", { name: /vector/i }).filter({ hasNot: p.locator("[hidden]") });

try {
  for (const view of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844, mobile: true },
  ]) {
    const context = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        hasTouch: !!view.mobile,
        isMobile: !!view.mobile,
      }),
      p = await context.newPage(),
      checks = {};
    console.log(`Vector deactivation at ${view.width}px`);
    p.setDefaultTimeout(30000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    // 1. Homepage and navigation never advertise Vector Studio.
    await p.goto(base);
    await p.getByRole("button", { name: "New project", exact: true }).waitFor();
    assert.doesNotMatch(await visibleText(p), /vector/i);
    assert.equal(await vectorButtons(p).count(), 0);
    assert.equal(await p.getByRole("link", { name: /vector/i }).count(), 0);
    checks.homepage = true;

    // 2. Chapter workspace and image menu: Raster Studio only.
    const source = await fx.start(p);
    const raster = p.getByRole("button", { name: "Open in Raster Studio", exact: true });
    await raster.waitFor();
    assert.equal(await p.getByRole("button", { name: "Open in Vector Studio" }).count(), 0);
    await p.getByText("Raster Studio is the main editor", { exact: false }).waitFor();
    await p
      .getByRole("button", { name: "Select image geometry.png", exact: true })
      .click({ button: "right" });
    await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).last().waitFor();
    assert.equal(await p.getByRole("button", { name: "Open in Vector Studio" }).count(), 0);
    await p.keyboard.press("Escape");
    // The menu's own "Open in Raster Studio" copy is gone once it has fully closed.
    await p.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].filter(
          (b) => b.textContent?.trim() === "Open in Raster Studio",
        ).length === 1,
    );
    checks.navigationHidden = true;

    // 3. Raster Studio stays the default editor, without a Vector mode switch.
    await fx.open(p, "Raster");
    const modes = p.getByRole("group", { name: "Switch editing mode", exact: true });
    await modes.getByRole("button", { name: "Raster", exact: true }).waitFor();
    assert.equal(await modes.getByRole("button", { name: "Vector", exact: true }).count(), 0);
    await p.getByRole("button", { name: "Brush tool", exact: true }).waitFor();
    // Gradient layers are Raster content: adding one must not reveal the Vector switch.
    await fx.tab(p, "Layers");
    await p.getByRole("button", { name: "Gradient layer", exact: true }).click();
    await p.getByText("Editable gradient layer", { exact: true }).waitFor();
    assert.equal(await modes.getByRole("button", { name: "Vector", exact: true }).count(), 0);
    checks.rasterAccessible = true;

    // 4. A legacy vector document (artboards) keeps Vector access and its data, including a
    //    gradient layer.
    const d = fromPanel({ id: "p", name: "Legacy vector", width: 128, height: 96 });
    d.artboards = [
      { id: "board", name: "Cover", x: 0, y: 0, width: 128, height: 96, background: "#ffffff" },
    ];
    const gradient = layer("gradient", 128, 96);
    gradient.name = "Sky gradient";
    d.layers.push(gradient);
    await fx.load(p, d, source);
    const legacy = modes.getByRole("button", { name: "Vector", exact: true });
    await legacy.waitFor();
    await legacy.click();
    await p.getByRole("dialog", { name: "Inkstrip Vector Studio", exact: true }).waitFor();
    await fx.tab(p, "Artboards");
    await p.getByText("Cover", { exact: false }).first().waitFor();
    const saved = (await fx.native(p)).value.document;
    assert.deepEqual(
      saved.artboards.map((b) => [b.name, b.width, b.height]),
      [["Cover", 128, 96]],
    );
    const savedGradient = saved.layers.find((l) => l.name === "Sky gradient");
    assert.equal(savedGradient.kind, "gradient");
    assert.deepEqual(savedGradient.gradient.stops, gradient.gradient.stops);
    checks.legacyDocument = true;

    // 5. Saved data survives closing and reopening in Raster Studio.
    await p.getByRole("button", { name: "Save draft", exact: true }).click();
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p
      .getByRole("dialog", { name: /Inkstrip (Raster|Vector) Studio/ })
      .waitFor({ state: "detached" });
    await fx.open(p, "Raster");
    await modes.getByRole("button", { name: "Vector", exact: true }).waitFor();
    const reopened = (await fx.native(p)).value.document;
    assert.deepEqual(
      reopened.layers.map((l) => [l.name, l.kind]),
      saved.layers.map((l) => [l.name, l.kind]),
    );
    assert.deepEqual(reopened.artboards, saved.artboards);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
      .waitFor({ state: "detached" });
    checks.dataIntact = true;

    // 6. Legacy link: `?vector=legacy` restores the hidden entry point and is remembered.
    const chapterUrl = p.url().split("?")[0];
    await p.goto(`${chapterUrl}?vector=legacy`);
    const vectorEntry = p.getByRole("button", { name: "Open in Vector Studio", exact: true });
    await vectorEntry.waitFor();
    await vectorEntry.click();
    await p.getByRole("dialog", { name: "Inkstrip Vector Studio", exact: true }).waitFor();
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p.goto(chapterUrl);
    await p.getByRole("button", { name: "Open in Vector Studio", exact: true }).waitFor();
    checks.legacyLink = true;

    await p.screenshot({ path: `/workspace/screenshots/vector-hidden-${view.width}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results.push({ width: view.width, ...checks });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }));
} finally {
  await browser.close();
}
