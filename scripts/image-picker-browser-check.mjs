/** Image picker: real Chapter and Raster Studio flows in Chromium (local DEV only).
 * Files enter through the picker's own file inputs, exactly as the system picker
 * delivers them; imports run through the unchanged pipeline and IndexedDB. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, devices } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const shots = "screenshots/image-picker";
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const results = [],
  errors = [];
const fixture = (name) => readFile(`src/lib/studio/fixtures/import/${name}`);
const png = async (name, source = "original.png") => ({
  name,
  mimeType: "image/png",
  buffer: await fixture(source),
});
const check = async (name, fn) => {
  const started = Date.now();
  await fn();
  results.push({ name, ms: Date.now() - started });
  console.log(`ok - ${name}`);
};

async function page(options = {}) {
  const context = await browser.newContext(options);
  // Track object URLs so cleanup can be asserted without app hooks.
  await context.addInitScript(() => {
    const created = new Set(),
      revoked = new Set(),
      make = URL.createObjectURL.bind(URL),
      free = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = make(blob);
      created.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.add(url);
      free(url);
    };
    window.__urls = {
      reset() {
        created.clear();
        revoked.clear();
      },
      leaked: () => [...created].filter((url) => !revoked.has(url)),
      created: () => created.size,
    };
  });
  const p = await context.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Picker QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  return p;
}

const picker = (p) => p.getByRole("dialog", { name: "Add images", exact: true });
const tiles = (p) => picker(p).locator(".picker-tile");
async function settle(p) {
  await p.waitForFunction(() => !document.querySelector('.picker-tile[data-status="checking"]'));
}
async function openPicker(p) {
  await p.getByRole("button", { name: "Add images", exact: true }).click();
  await picker(p).waitFor();
}
async function choose(p, files, source = "files") {
  await picker(p).locator(`[data-picker-input="${source}"]`).setInputFiles(files);
  await settle(p);
}
const panelNames = (p) =>
  p
    .getByRole("button", { name: /^Edit Image / })
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label").replace("Edit Image ", "")),
    );

const desktop = await page({ viewport: { width: 1440, height: 900 } });

await check("opens as a dialog with an empty state and closes with Escape", async () => {
  const p = desktop;
  await openPicker(p);
  await picker(p).getByText("Add your pages", { exact: true }).waitFor();
  assert.equal(
    await picker(p).getByRole("tab", { name: "Photos" }).getAttribute("aria-selected"),
    "true",
  );
  assert.ok(await picker(p).getByRole("button", { name: "Add images", exact: true }).isDisabled());
  await p.screenshot({ path: `${shots}/desktop-1440-empty.png` });
  await p.keyboard.press("Escape");
  await picker(p).waitFor({ state: "detached" });
  const focused = await p.evaluate(() => document.activeElement?.textContent?.trim());
  assert.equal(focused, "Add images", "focus returns to the trigger");
});

await check("multi-select validates, rejects invalid files and skips duplicates", async () => {
  const p = desktop;
  await p.evaluate(() => window.__urls.reset());
  await openPicker(p);
  await choose(p, [
    await png("page-3.png"),
    await png("page-1.png", "page.png"),
    { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image at all") },
    await png("page-2.png", "batch-plane.png"),
  ]);
  assert.equal(await tiles(p).count(), 4);
  const invalid = picker(p).locator('.picker-tile[data-status="invalid"]');
  assert.equal(await invalid.count(), 1);
  assert.match(await invalid.innerText(), /header|unsupported|malformed/i);
  assert.equal(await picker(p).locator(".picker-tile[data-selected]").count(), 3);
  await picker(p).getByRole("button", { name: "Add 3 images", exact: true }).waitFor();
  await p.waitForFunction(
    () => document.querySelectorAll('.picker-tile img[src^="blob:"]').length === 3,
  );
  // Same files again: nothing new is added.
  await choose(p, [await png("page-3.png")]);
  assert.equal(await tiles(p).count(), 4);
  await picker(p)
    .getByRole("status")
    .getByText(/duplicate skipped/)
    .waitFor();
  await p.screenshot({ path: `${shots}/desktop-1440-grid.png` });
});

await check(
  "keyboard: arrows move focus, Enter toggles, P previews, Escape closes preview first",
  async () => {
    const p = desktop;
    const first = tiles(p).nth(0).locator('[data-role="toggle"]');
    await first.focus();
    await p.keyboard.press("ArrowRight");
    const second = tiles(p).nth(1).locator('[data-role="toggle"]');
    assert.equal(await second.evaluate((el) => el === document.activeElement), true);
    assert.equal(await second.getAttribute("aria-pressed"), "true");
    await p.keyboard.press("Enter");
    assert.equal(await second.getAttribute("aria-pressed"), "false");
    await p.keyboard.press(" ");
    assert.equal(await second.getAttribute("aria-pressed"), "true");
    await p.keyboard.press("p");
    const preview = picker(p).getByRole("dialog", { name: /^Preview / });
    await preview.waitFor();
    await preview.locator('img[src^="blob:"]').waitFor();
    await p.screenshot({ path: `${shots}/desktop-1440-preview.png` });
    await p.keyboard.press("Escape");
    await preview.waitFor({ state: "detached" });
    assert.ok(await picker(p).isVisible(), "picker stays open");
    // Tab cycling stays inside the dialog (focus trap).
    for (let i = 0; i < 25; i++) await p.keyboard.press("Tab");
    assert.ok(await p.evaluate(() => !!document.activeElement?.closest(".picker-sheet")));
  },
);

await check("cancel imports nothing and releases every temporary URL", async () => {
  const p = desktop;
  await picker(p).getByRole("button", { name: "Cancel", exact: true }).click();
  await picker(p).waitFor({ state: "detached" });
  assert.deepEqual(await panelNames(p), []);
  assert.ok((await p.evaluate(() => window.__urls.created())) >= 3);
  assert.deepEqual(await p.evaluate(() => window.__urls.leaked()), []);
});

await check("recent files return, selection reorders, and import keeps that order", async () => {
  const p = desktop;
  await openPicker(p);
  await picker(p).getByRole("tab", { name: "Recent" }).click();
  await settle(p);
  assert.equal(await tiles(p).count(), 3, "the three valid files are offered again");
  assert.equal(await picker(p).locator(".picker-tile[data-selected]").count(), 0);
  for (const name of ["page-3.png", "page-1.png", "page-2.png"])
    await picker(p)
      .getByRole("button", { name: new RegExp(`^${name}, not selected`) })
      .click();
  await picker(p)
    .getByRole("tab", { name: /^Selected/ })
    .click();
  const rows = picker(p).locator(".picker-row");
  assert.equal(await rows.count(), 3);
  await picker(p).getByRole("button", { name: "Sort by name", exact: true }).click();
  await picker(p).getByRole("button", { name: "Move page-1.png down", exact: true }).click();
  assert.deepEqual(await rows.locator(".truncate.text-sm").allInnerTexts(), [
    "page-2.png",
    "page-1.png",
    "page-3.png",
  ]);
  await picker(p)
    .getByRole("button", { name: "Remove page-3.png from selection", exact: true })
    .click();
  await p.screenshot({ path: `${shots}/desktop-1440-selected.png` });
  await picker(p).getByRole("tab", { name: "Collections" }).click();
  await picker(p).getByText("Recently chosen", { exact: true }).waitFor();
  await picker(p).getByRole("button", { name: "Add 2 images", exact: true }).click();
  await picker(p).waitFor({ state: "detached" });
  await p.waitForFunction(
    () => document.querySelectorAll('[aria-label^="Edit Image "]').length === 2,
  );
  assert.deepEqual(await panelNames(p), ["page-2.png", "page-1.png"]);
});

await check("Raster Studio import uses single-selection mode and adds one layer", async () => {
  const p = desktop;
  await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  const studio = p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true });
  await studio.waitFor();
  const tab = (name) =>
    p
      .getByRole("navigation", { name: "Pro panels", exact: true })
      .getByRole("button", { name, exact: true });
  await tab("History").click();
  const before = await p.locator(".pro-history-list li").count();
  await tab("Assets").click();
  await p.getByRole("button", { name: "Import image / SVG / native", exact: true }).click();
  const single = p.getByRole("dialog", { name: "Import into Raster Studio", exact: true });
  await single.waitFor();
  await single.locator('[data-picker-input="files"]').setInputFiles([await png("layer.png")]);
  await settle(p);
  const gif = { name: "anim.gif", mimeType: "image/gif", buffer: await fixture("original.gif") };
  await single.locator('[data-picker-input="files"]').setInputFiles([gif]);
  await single
    .getByRole("status")
    .getByText(/not supported here/)
    .waitFor();
  await single
    .locator('[data-picker-input="files"]')
    .setInputFiles([await png("second.png", "page.png")]);
  await settle(p);
  assert.equal(await single.locator(".picker-tile[data-selected]").count(), 1, "single mode");
  await p.screenshot({ path: `${shots}/desktop-1440-raster-single.png` });
  await single.getByRole("button", { name: "Import", exact: true }).click();
  await single.waitFor({ state: "detached" });
  await tab("History").click();
  await p.waitForFunction(
    (n) => document.querySelectorAll(".pro-history-list li").length === n + 1,
    before,
  );
  assert.match(await p.locator(".pro-history-list li").last().innerText(), /./);
  await p
    .getByRole("button", { name: "Back to chapter from Pro Studio", exact: true })
    .click()
    .catch(() => {});
});

for (const [width, height, touch] of [
  [320, 640, true],
  [360, 740, true],
  [390, 844, true],
  [768, 1024, true],
  [1440, 900, false],
]) {
  await check(`layout at ${width}px has no overflow and keeps actions reachable`, async () => {
    const p = await page(
      touch
        ? { ...devices["Pixel 7"], viewport: { width, height } }
        : { viewport: { width, height } },
    );
    await openPicker(p);
    await choose(p, [
      await png("one.png"),
      await png("two.png", "page.png"),
      await png("three.png", "batch-plane.png"),
      await png("tall.png", "tall.png"),
    ]);
    await p.waitForTimeout(400);
    const box = await picker(p).boundingBox();
    const metrics = await p.evaluate(() => {
      const sheet = document.querySelector(".picker-sheet"),
        grid = document.querySelector(".picker-grid"),
        confirm = document.querySelector("[data-picker-confirm]").getBoundingClientRect();
      return {
        docOverflow: document.documentElement.scrollWidth - innerWidth,
        sheetOverflow: sheet.scrollWidth - sheet.clientWidth,
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        confirmBottom: confirm.bottom,
        confirmRight: confirm.right,
        confirmHeight: confirm.height,
        tile: document.querySelector(".picker-tile").getBoundingClientRect().width,
      };
    });
    assert.ok(metrics.docOverflow <= 0, `page overflow ${metrics.docOverflow}`);
    assert.ok(metrics.sheetOverflow <= 0, `sheet overflow ${metrics.sheetOverflow}`);
    assert.ok(metrics.confirmBottom <= height && metrics.confirmRight <= width);
    assert.ok(metrics.confirmHeight >= 44, "touch-sized confirm");
    if (width < 768) {
      assert.equal(Math.round(box.width), width, "full-width bottom sheet");
      assert.ok(Math.abs(box.y + box.height - height) <= 1, "anchored to the bottom");
      assert.ok(metrics.columns === 3 || (width >= 480 && metrics.columns === 4));
      assert.ok(metrics.tile >= 90, `large thumbnails (${metrics.tile}px)`);
      assert.ok(await picker(p).locator(".picker-handle").isVisible());
    } else {
      assert.ok(box.x > 0 && box.y > 0, "centered dialog");
      assert.ok(metrics.columns >= 4);
    }
    await p.screenshot({ path: `${shots}/layout-${width}.png` });
    if (touch && width < 768) {
      // Drag the handle down to dismiss.
      const handle = await picker(p).locator(".picker-handle-zone").boundingBox();
      const cdp = await p.context().newCDPSession(p);
      const x = handle.x + handle.width / 2,
        y = handle.y + handle.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let d = 20; d <= 260; d += 40)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + d }],
        });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await picker(p).waitFor({ state: "detached" });
      assert.deepEqual(await panelNames(p), [], "dismissing imports nothing");
    }
    await p.context().close();
  });
}

await check("reduced motion disables sheet animation", async () => {
  const p = await page({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await openPicker(p);
  const duration = await picker(p).evaluate((el) =>
    parseFloat(getComputedStyle(el).animationDuration),
  );
  assert.ok(duration <= 0.01, `animation ${duration}s`);
  await p.context().close();
});

await browser.close();
const relevant = errors.filter((e) => !/favicon|Download the React DevTools/.test(e));
assert.deepEqual(relevant, [], "no console errors");
console.log(JSON.stringify({ passed: results.length, results }, null, 2));
