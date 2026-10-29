import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { encode } from "fast-png";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [];
let activePage;
try {
  await mkdir("/workspace/screenshots", { recursive: true });
  for (const width of [1440, 768, 390, 360, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await context.newPage();
    activePage = p;
    console.log(`Mobile width ${width}`);
    p.setDefaultTimeout(30000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await p.goto(base);
    await p.getByRole("button", { name: "New project", exact: true }).click();
    await p.getByPlaceholder("Night Market").fill("R10 mobile");
    await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    const name = "Episode-001-panel-00042-inkstrip-original-artwork.png",
      buffer = Buffer.from(
        encode({ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(255) }),
      );
    await p
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name, mimeType: "image/png", buffer });
    await p.getByRole("button", { name: `Edit Image ${name}`, exact: true }).waitFor();
    const row = p.locator("[data-order-panel]"),
      select = p.getByRole("button", { name: `Select image ${name}`, exact: true }),
      options = p.getByRole("button", { name: `Image options for ${name}`, exact: true });
    await select.evaluate((e) => e.scrollIntoView({ block: "center", inline: "nearest" }));
    const geometry = await row.evaluate((row) => {
      const target = row.querySelector(".panel-image-target"),
        name = row.querySelector(".panel-image-name"),
        options = row.querySelector(".panel-row-end"),
        r = (e) => {
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };
      return {
        target: r(target),
        name: r(name),
        options: r(options),
        row: r(row),
        buttons: [...row.querySelectorAll("button")].map(r),
        whiteSpace: getComputedStyle(name).whiteSpace,
      };
    });
    await writeFile(
      `/workspace/r10-evidence/mobile-geometry-${width}.json`,
      JSON.stringify(geometry, null, 2),
    );
    if (width <= 360) {
      assert.ok(geometry.name.width >= 120, "narrow rows preserve readable filename width");
      assert.equal(geometry.whiteSpace, "normal");
      assert.ok(
        geometry.target.y + geometry.target.height <= geometry.options.y,
        "filename row cannot collide with options",
      );
    }
    for (const b of width < 800 ? geometry.buttons : []) {
      assert.ok(b.width >= 43.9 && b.height >= 43.9, "touch targets remain at least44px");
    }
    assert.equal(await select.getAttribute("aria-pressed"), "true");
    if (width < 800) {
      const b = await select.boundingBox();
      assert.equal(
        await p.evaluate(
          ({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".panel-image-target"),
          { x: b.x + b.width / 2, y: b.y + b.height / 2 },
        ),
        true,
        "real touch must hit the visible selection target",
      );
      await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    } else await select.click();
    assert.equal(await select.getAttribute("aria-pressed"), "false");
    await options.click();
    const menu = p.getByRole("dialog", { name: "Image tools", exact: true });
    await menu.waitFor();
    await p.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await select.focus();
    await select.press("Shift+F10");
    await menu.waitFor();
    await menu.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
    const studio = p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true });
    await studio.locator(".pro-artboard").waitFor();
    await studio
      .getByRole("button", { name: "Save draft", exact: true })
      .waitFor({ state: "visible" });
    await studio
      .getByRole("button", { name: "Recovery checkpoints", exact: true })
      .waitFor({ state: "visible" });
    assert.equal(
      await studio.getByRole("button", { name: "Save draft", exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await studio.getByRole("button", { name: "Recovery checkpoints", exact: true }).isVisible(),
      true,
    );
    await p.screenshot({ path: `/workspace/screenshots/r10-mobile-studio-${width}.png` });
    await studio
      .getByRole("button", { name: "Back to chapter from Pro Studio", exact: true })
      .click();
    await studio.waitFor({ state: "hidden" });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `/workspace/screenshots/r10-mobile-rows-${width}.png` });
    results.push({
      width,
      geometry,
      readableNarrowFilename: true,
      selection: true,
      options: true,
      shiftF10: true,
      saveVisible: true,
      recoveryVisible: true,
      noOverflow: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { results, errors, physicalAndroid: false };
  await writeFile("/workspace/r10-evidence/mobile-browser.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (activePage)
    await activePage
      .screenshot({ path: "/workspace/screenshots/r10-mobile-failure.png" })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
