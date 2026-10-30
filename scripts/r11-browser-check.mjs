/** R11 browser gate: open-time asset compaction through the real Clone Stamp
 * workflow, and the command palette at five widths with real touch. Isolated
 * synthetic browser profiles only; no existing project is opened. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local QA servers only");
await mkdir("/workspace/screenshots", { recursive: true });
await mkdir("/workspace/r11-evidence", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  errors = [],
  results = [];

async function start(p, name) {
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill(name);
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  // Noise-like texture so every captured composite is a distinct, realistic PNG.
  const source = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d"),
      image = x.createImageData(128, 96);
    let seed = 7;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      image.data[i] = 40 + (seed & 127);
      image.data[i + 1] = 60 + ((seed >> 8) & 127);
      image.data[i + 2] = 80 + ((seed >> 16) & 127);
      image.data[i + 3] = 255;
    }
    x.putImageData(image, 0, 0);
    x.fillStyle = "#000000";
    x.fillRect(60, 44, 8, 8);
    return c.toDataURL().split(",")[1];
  });
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "r11.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
    ]);
  await p.getByRole("button", { name: "Edit Image r11.png", exact: true }).waitFor();
}
async function open(p) {
  const button = p.getByRole("button", { name: "Open in Raster Studio", exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).waitFor();
  await p.locator('canvas[aria-label="Pro composite preview"]').waitFor();
}
async function panels(p) {
  const toggle = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}
/** The stored Pro record, read directly from IndexedDB. */
async function stored(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip-pro");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const r = db.transaction("sessions").objectStore("sessions").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return rows.map(({ session }) => ({
        assets: Object.keys(session.assets).length,
        bytes: Object.values(session.assets).reduce((n, b) => n + b.size, 0),
        revision: session.revision,
        cloneAssets: session.document.layers.flatMap((l) =>
          l.strokes.filter((s) => s.clone).map((s) => s.clone.assetId),
        ),
        sourceAsset: session.document.source?.assetId,
      }));
    } finally {
      db.close();
    }
  });
}
async function storedAssets(p, expected) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const [row] = await stored(p);
    if (row?.assets === expected) return row;
    if (Date.now() > deadline)
      throw Error(`Stored assets ${row?.assets} never reached ${expected}`);
    await p.waitForTimeout(50);
  }
}
async function point(p, x, y) {
  const r = await p.locator(".pro-artboard").boundingBox();
  return { x: r.x + (x / 128) * r.width, y: r.y + (y / 96) * r.height };
}
async function sample(p, x, y) {
  const q = await point(p, x, y);
  await p.keyboard.down("Alt");
  await p.mouse.click(q.x, q.y);
  await p.keyboard.up("Alt");
}
/** SHA-256 of the full RGBA preview, so a mismatch never builds a huge diff. */
async function composite(p) {
  const pixels = await p.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
    return [c.width, c.height, ...c.getContext("2d").getImageData(0, 0, c.width, c.height).data];
  });
  return createHash("sha256").update(Uint8Array.from(pixels)).digest("hex");
}
/** A preview hash that held for three reads 300 ms apart (renders are asynchronous). */
async function stableComposite(p) {
  let last = "",
    same = 0;
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    const hash = await composite(p);
    same = hash === last ? same + 1 : 0;
    last = hash;
    if (same >= 2) return hash;
    await p.waitForTimeout(300);
  }
  throw Error("The composite preview never settled.");
}
/** Waits up to 30 s for the preview to reach an expected hash; reports the last one. */
async function expectComposite(p, expected, message) {
  let hash = "";
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    hash = await composite(p);
    if (hash === expected) return;
    await p.waitForTimeout(250);
  }
  assert.equal(hash, expected, message);
}
async function settled(p) {
  await p.waitForFunction(
    () => document.querySelector(".pro-save-state")?.getAttribute("data-save-state") === "saved",
  );
  await p.waitForFunction(() => !document.querySelector(".pro-workspace[aria-busy='true']"));
}

// ── Open-time compaction through the real Clone Stamp workflow ──────────────
if (!process.argv.includes("--commands-only")) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    p = await context.newPage();
  await start(p, "R11 asset compaction QA");
  await open(p);
  await panels(p);
  await p.getByRole("button", { name: "Clone Stamp tool", exact: true }).click();
  // Each sample stores a full-resolution composite. None is referenced until painted.
  for (let i = 1; i <= 63; i++) {
    await sample(p, 10 + (i % 50), 20 + (i % 30));
    await storedAssets(p, 1 + i);
  }
  console.log("63 samples stored");
  const full = (await stored(p))[0];
  assert.equal(full.assets, 64);
  assert.deepEqual(full.cloneAssets, []);
  await sample(p, 40, 40);
  await p
    .getByRole("alert")
    .filter({ hasText: "A Pro document supports at most 64 raster assets." })
    .waitFor();
  assert.equal((await stored(p))[0].assets, 64, "the refused sample stored nothing");
  const beforeReopen = await stableComposite(p);
  await p.getByRole("button", { name: "Dismiss Pro error", exact: true }).click();
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  console.log("reopening at the cap");
  await p.reload();
  await open(p);
  const notice = p.getByText(
    "Recovered editable Pro document. 63 unused stored images will be released on the next save. Chapter unchanged.",
    { exact: true },
  );
  const noticeShown = await notice
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  await expectComposite(p, beforeReopen, "reopened artwork is pixel-identical");
  assert.equal((await stored(p))[0].assets, 64, "opening alone never rewrites storage");
  await panels(p);
  await p.getByRole("button", { name: "Clone Stamp tool", exact: true }).click();
  // On R10 this sample is refused again: unreferenced samples survived the reload.
  await sample(p, 20, 30);
  const afterSample = await storedAssets(p, 2);
  assert.equal(await p.getByRole("alert").count(), 0, "the sample that was refused now succeeds");
  assert.ok(noticeShown, "the reopened draft reports the images it will release");
  // Paint with the sampled source so it becomes a document root.
  const a = await point(p, 70, 50),
    b = await point(p, 90, 60);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps: 8 });
  await p.mouse.up();
  await p.getByRole("button", { name: "Save draft", exact: true }).click();
  await settled(p);
  const painted = (await stored(p))[0];
  assert.equal(painted.assets, 2);
  assert.equal(painted.cloneAssets.length, 1, "one Clone Stamp stroke references the sample");
  const paintedPixels = await stableComposite(p);
  assert.notEqual(paintedPixels, beforeReopen, "the clone stroke changed the artwork");
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p.reload();
  await open(p);
  await p
    .getByText("Recovered editable Pro document. Chapter unchanged.", { exact: true })
    .waitFor();
  await expectComposite(p, paintedPixels, "the referenced clone source survives");
  assert.equal((await stored(p))[0].assets, 2);
  assert.ok(
    await p.getByRole("button", { name: "Pro undo", exact: true }).isDisabled(),
    "a reopened draft starts a fresh Undo history",
  );
  await p.screenshot({ path: "/workspace/screenshots/r11-compaction-1440.png" });
  results.push({
    case: "compaction",
    storedBeforeReopen: full,
    storedAfterFirstSave: afterSample,
    storedAfterPaint: painted,
    refusedAtCap: true,
    reopenedPixelIdentical: true,
    referencedCloneSourceRetained: true,
  });
  await context.close();
}

// ── Command palette at five widths, mouse/keyboard and real touch ───────────
for (const width of [1440, 768, 390, 360, 320]) {
  const touch = width < 1000,
    context = await browser.newContext({
      viewport: { width, height: touch ? 844 : 1000 },
      hasTouch: touch,
      isMobile: touch && width < 500,
    }),
    p = await context.newPage();
  await start(p, `R11 commands ${width}`);
  await open(p);
  const before = await stableComposite(p),
    opener = p.getByRole("button", { name: "Commands", exact: true });
  await opener.scrollIntoViewIfNeeded();
  if (touch) await opener.tap();
  else await p.keyboard.press("Control+k");
  const dialog = p.getByRole("dialog", { name: "Commands", exact: true }),
    search = dialog.getByRole("combobox", { name: "Search commands", exact: true });
  await search.waitFor();
  assert.ok(await search.evaluate((e) => e === document.activeElement), "search has focus");
  assert.ok(
    await search.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e;
    }),
    "the palette is on top of the Studio, not hidden behind it",
  );
  // Disabled actions stay discoverable but cannot run.
  await search.fill("undo");
  const undo = dialog.getByRole("option").filter({ hasText: "Undo" }).first();
  assert.equal(await undo.getAttribute("aria-disabled"), "true");
  // Forced: Playwright otherwise refuses aria-disabled targets, which is the point.
  if (touch) await undo.tap({ force: true });
  else await undo.click({ force: true });
  assert.ok(await dialog.isVisible(), "a disabled command does not close the palette");
  // Keyboard selection runs the same handler as the tool rail.
  await search.fill("eras");
  assert.equal(
    await dialog.getByRole("option", { selected: true }).locator(".pro-command-label").innerText(),
    "Eraser",
  );
  await search.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await p.getByRole("button", { name: "Eraser tool", exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  // Panels: a touch tap or ArrowDown + Enter opens the inspector tab.
  if (touch) await opener.tap();
  else await opener.click();
  await search.fill("layers");
  // Measure after the dialog's entrance animation; a running scale shrinks boxes.
  await p.waitForFunction(() => {
    const palette = [...document.querySelectorAll('[role="dialog"]')].find(
      (d) => d.querySelector("h2")?.textContent === "Commands",
    );
    return (
      palette &&
      palette
        .getAnimations({ subtree: true })
        .every((a) => a.effect?.getTiming().iterations === Infinity || a.playState === "finished")
    );
  });
  const rows = await dialog.getByRole("option").evaluateAll((items) =>
    items.map((e) => {
      const r = e.getBoundingClientRect();
      return { height: r.height, right: r.right };
    }),
  );
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.ok(row.height >= 43.9, `command rows stay touch-sized at ${width}px: ${row.height}`);
    assert.ok(row.right <= width, `command rows fit inside ${width}px`);
  }
  await search.fill("la");
  await p.screenshot({ path: `/workspace/screenshots/r11-commands-results-${width}.png` });
  await search.fill("layers");
  const layers = dialog.getByRole("option").filter({ hasText: "Layers panel" });
  if (touch) await layers.tap();
  else {
    await search.press("ArrowDown");
    await search.press("ArrowUp");
    await search.press("Enter");
  }
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await p
      .getByRole("navigation", { name: "Pro panels", exact: true })
      .getByRole("button", { name: "Layers", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  // Escape closes without side effects; an unknown query explains itself.
  if (touch) await opener.tap();
  else await p.keyboard.press("Control+k");
  await search.fill("no such command");
  await dialog.getByRole("status").filter({ hasText: "No matching command." }).waitFor();
  await p.screenshot({ path: `/workspace/screenshots/r11-commands-${width}.png` });
  await search.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(
    await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).isVisible(),
    "Escape closes only the palette, not the Studio",
  );
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await expectComposite(p, before, "navigation never changes artwork");
  // Choosing Eraser from the rail adds an empty Paint layer in Raster; the palette runs
  // the same handler, so history must match exactly and navigation adds nothing.
  await p
    .getByRole("navigation", { name: "Pro panels", exact: true })
    .getByRole("button", { name: "History", exact: true })
    .click();
  assert.deepEqual(
    (await p.locator(".pro-history-list li").allInnerTexts()).map((t) => t.split("\n").at(-1)),
    ["Imported accepted image", "Add paint"],
  );
  console.log(`commands ${width}px ok`);
  results.push({ case: "commands", width, touch, keyboard: !touch, artworkUnchanged: true });
  await context.close();
}

assert.deepEqual(errors, []);
await writeFile("/workspace/r11-evidence/r11-browser.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify({ ok: true, results }, null, 2));
await browser.close();
