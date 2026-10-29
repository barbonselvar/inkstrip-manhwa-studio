/** R10 Milestone A: browser regressions for the 26 Oct 2026 audit defects INK-AUD-001,
 * 004, 005 and 006 (002/003 are server-side and covered by unit tests). Isolated browser
 * profiles and synthetic artwork only. 1440 px (mouse/keyboard), 390 and 320 px (touch). */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { encode } from "fast-png";
import { encodeBackup } from "../src/lib/studio/backup.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  results = [];

const pngFile = (name, width, height, rgba = [40, 120, 200, 255]) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { name, mimeType: "image/png", buffer: Buffer.from(encode({ width, height, data })) };
};
// The audit's gradient.svg fixture: a linear gradient and a local clipPath.
const GRADIENT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient><clipPath id="clip"><rect x="8" y="8" width="48" height="48"/></clipPath></defs><rect width="64" height="64" fill="url(#g)" clip-path="url(#clip)"/></svg>';
const SCRIPT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>void 0</script></svg>';

for (const view of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844, touch: true },
  { width: 320, height: 640, touch: true },
]) {
  const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      hasTouch: !!view.touch,
      isMobile: !!view.touch,
    }),
    p = await context.newPage(),
    checks = {};
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`${view.width}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${view.width}: ${m.text()}`);
  });
  console.log(`R10 audit checks at ${view.width}px`);
  const longPress = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox(),
      cdp = await context.newCDPSession(p),
      point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await p.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
  const imageTools = () => p.getByRole("dialog", { name: "Image tools", exact: true });

  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Audit QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  const chapterUrl = p.url();
  await p
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      pngFile("first.png", 96, 128),
      pngFile("second.png", 96, 128, [200, 40, 40, 255]),
    ]);
  await p.getByRole("button", { name: "Edit Image second.png", exact: true }).waitFor();

  // INK-AUD-006: selection target and options button have accurate names and states.
  const target = p.getByRole("button", { name: "Select image first.png", exact: true }),
    options = p.getByRole("button", { name: "Image options for first.png", exact: true }),
    check = p.getByRole("button", { name: /^(Check|Uncheck) first\.png$/ });
  assert.equal(await target.getAttribute("aria-pressed"), "true");
  assert.equal(await check.getAttribute("aria-pressed"), "true");
  await target.click();
  assert.equal(await target.getAttribute("aria-pressed"), "false");
  assert.equal(await check.getAttribute("aria-pressed"), "false", "one selection state");
  await target.click();
  assert.equal(await target.getAttribute("aria-pressed"), "true");
  assert.equal(await options.getAttribute("aria-haspopup"), "dialog");
  assert.equal(await options.getAttribute("aria-expanded"), "false");
  await options.click();
  await imageTools().waitFor();
  // The modal hides the page from assistive tech while open; read the trigger's DOM state.
  assert.equal(
    await p
      .locator('button[aria-label="Image options for first.png"]')
      .getAttribute("aria-expanded"),
    "true",
  );
  await p.keyboard.press("Escape");
  await imageTools().waitFor({ state: "detached" });
  assert.equal(await target.getAttribute("aria-pressed"), "true", "options do not toggle");
  assert.equal(await options.getAttribute("aria-expanded"), "false");
  if (view.touch) {
    await longPress(target);
    await imageTools().waitFor();
    await p.keyboard.press("Escape");
    await imageTools().waitFor({ state: "detached" });
    assert.equal(await target.getAttribute("aria-pressed"), "true", "long press does not toggle");
  } else {
    await target.click({ button: "right" });
    await imageTools().waitFor();
    await p.keyboard.press("Escape");
    await imageTools().waitFor({ state: "detached" });
    await target.focus();
    await p.keyboard.press("Shift+F10");
    await imageTools().waitFor();
    await p.keyboard.press("Escape");
    await imageTools().waitFor({ state: "detached" });
    await target.focus();
    await p.keyboard.press("Space");
    assert.equal(await target.getAttribute("aria-pressed"), "false", "Space toggles selection");
    await p.keyboard.press("Enter");
    assert.equal(await target.getAttribute("aria-pressed"), "true", "Enter toggles selection");
  }
  checks.imageOptions = true;

  // INK-AUD-005: an image over the Raster limit ends in a stable failed state.
  await p
    .locator('input[type="file"]')
    .first()
    .setInputFiles([pngFile("tall.png", 64, 20000)]);
  await p.getByRole("button", { name: "Edit Image tall.png", exact: true }).waitFor();
  await p.getByRole("button", { name: "Image options for tall.png", exact: true }).click();
  await imageTools().getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  const studio = p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true });
  await studio.waitFor();
  const failed = studio.getByRole("alert").filter({ hasText: "could not be opened" });
  await failed.waitFor();
  assert.match(await failed.innerText(), /16,384 px per side/);
  assert.equal(await studio.locator(".pro-save-state").innerText(), "Not opened");
  await p.waitForTimeout(1500); // the state must stay terminal, not drift back to loading
  assert.equal(await studio.getByText("Opening layered document").count(), 0);
  assert.equal(await studio.getByText("Unsaved draft").count(), 0);
  assert.equal(await studio.locator(".pro-save-state").innerText(), "Not opened");
  await p.screenshot({ path: `/workspace/screenshots/r10-aud005-${view.width}.png` });
  await failed.getByRole("button", { name: "Return to chapter", exact: true }).click();
  await studio.waitFor({ state: "detached" });
  // A subsequent valid image opens normally.
  await p.getByRole("button", { name: "Image options for first.png", exact: true }).click();
  await imageTools().getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  await studio.waitFor();
  await studio.locator(".pro-artboard").waitFor();
  assert.notEqual(await studio.locator(".pro-save-state").innerText(), "Not opened");
  checks.failedLoad = true;

  // INK-AUD-004: Assets help matches the importer; the audit's gradient/clip SVG imports.
  const panels = studio.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if ((await panels.getAttribute("aria-expanded")) === "false") await panels.click();
  await studio
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name: "Assets", exact: true })
    .click();
  const help = await studio.locator(".pro-help", { hasText: "SVG imports" }).innerText();
  assert.match(help, /local linear and radial gradients/);
  assert.match(help, /local clipping paths/);
  assert.match(help, /scripts and event handlers/);
  assert.doesNotMatch(help, /Gradients, clipping paths, masks/);
  const asset = studio.getByLabel("Import Pro asset", { exact: true });
  await asset.setInputFiles([
    { name: "gradient.svg", mimeType: "image/svg+xml", buffer: Buffer.from(GRADIENT_SVG) },
  ]);
  await studio.getByText(/^SVG vectors imported/).waitFor();
  await asset.setInputFiles([
    { name: "script.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SCRIPT_SVG) },
  ]);
  await studio
    .getByRole("alert")
    .filter({ hasText: /Unsupported SVG element: script/ })
    .waitFor();
  checks.svgHelp = true;
  await studio
    .getByRole("button", { name: "Back to chapter from Pro Studio", exact: true })
    .click();
  await studio.waitFor({ state: "detached" });

  // INK-AUD-001: a malformed stored record is set aside; the Library and search keep working.
  await p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("inkstrip");
        req.onsuccess = () => {
          const tx = req.result.transaction("projects", "readwrite");
          tx.objectStore("projects").put({
            id: "audit-bad",
            title: 42,
            createdAt: 1,
            updatedAt: 1,
          });
          tx.oncomplete = () => resolve(req.result.close());
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await p.goto(base);
  await p.getByText(/1 stored record has invalid metadata and was set aside/).waitFor();
  await p
    .getByRole("link", { name: /Audit QA/ })
    .first()
    .waitFor();
  await p.getByLabel("Search projects", { exact: true }).fill("audit");
  await p
    .getByRole("link", { name: /Audit QA/ })
    .first()
    .waitFor();
  await p.getByLabel("Search projects", { exact: true }).fill("");
  // A malformed backup is rejected as a whole through the real Restore control.
  const bad = encodeBackup({
    project: { id: "restored", title: { invalid: "object" }, createdAt: 1, updatedAt: 1 },
    chapters: [],
    panels: [],
    blobs: new Map(),
  });
  await p.locator('input[type="file"][accept=".inkstrip-project"]').setInputFiles([
    {
      name: "bad.inkstrip-project",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(await bad.arrayBuffer()),
    },
  ]);
  await p
    .getByRole("alert")
    .filter({ hasText: /invalid project metadata/ })
    .waitFor();
  const stored = await p.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("inkstrip");
        req.onsuccess = () => {
          const get = req.result.transaction("projects").objectStore("projects").getAll();
          get.onsuccess = () => resolve(get.result.map((x) => x.id).sort());
        };
      }),
  );
  assert.equal(stored.length, 2, "nothing restored; the set-aside record is kept, not deleted");
  assert.ok(stored.includes("audit-bad"));
  await p.goto(chapterUrl);
  await p.getByRole("button", { name: "Select image first.png", exact: true }).waitFor();
  checks.libraryIntegrity = true;

  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await p.screenshot({ path: `/workspace/screenshots/r10-chapter-${view.width}.png` });
  results.push({ width: view.width, ...checks });
  await context.close();
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
assert.deepEqual(errors, []);
