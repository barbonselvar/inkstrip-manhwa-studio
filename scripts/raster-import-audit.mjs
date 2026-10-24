// R1: exercise the actual Assets UI with an oversized header, without allocating its pixels.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { start, open, tab, native, preview } = proBrowserFixtures(base, errors);
  await start(page);
  await open(page);
  await preview(page);
  const before = await native(page);
  await tab(page, "Assets");
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.__oversizedDecodeCalls = 0;
    window.createImageBitmap = async function (source, ...args) {
      if (source instanceof Blob && source.size === 24) window.__oversizedDecodeCalls++;
      return original.call(this, source, ...args);
    };
  });
  const header = Buffer.alloc(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  header.write("IHDR", 12);
  header.writeUInt32BE(65535, 16);
  header.writeUInt32BE(65535, 20);
  await page.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
    name: "oversized-header.png",
    mimeType: "image/png",
    buffer: header,
  });
  await page.locator(".pro-alert").waitFor();
  const message = await page.locator(".pro-alert").innerText();
  const decodes = await page.evaluate(() => window.__oversizedDecodeCalls);
  const after = await native(page);
  assert.deepEqual(after.value.document, before.value.document);
  assert.deepEqual(after.value.assets, before.value.assets);
  console.log(
    JSON.stringify({ decodes, message, documentUnchanged: true, sourceUnchanged: true, errors }),
  );
  assert.equal(decodes, 0, "Oversized assets must be rejected before createImageBitmap");
  assert.match(message, /pixel budget/);
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close();
}
