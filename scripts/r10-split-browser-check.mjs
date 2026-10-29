/** R10 D1: lossless split of images over Raster Studio's limit, through the real Chapter UI.
 * Parts must stack back into the original pixels exactly (semi-transparent data included),
 * keep the original untouched, sit right after it and open in Raster. 1440 px desktop
 * (16.8MP budget) and 390 px touch (4MP budget). Isolated profiles, synthetic artwork. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { decode, encode } from "fast-png";

const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  results = [];

function tallPng(width, height, extraChunk) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0, i = 0; y < height; y++)
    for (let x = 0; x < width; x++, i += 4)
      data.set([(x * 7 + y) & 255, (y * 3) & 255, (x ^ y) & 255, (x + y * 5) & 255], i);
  let png = encode({ width, height, data, depth: 8, channels: 4 });
  if (extraChunk)
    png = new Uint8Array([...png.subarray(0, 33), ...extraChunk, ...png.subarray(33)]);
  return { png, data };
}
// gAMA with a valid CRC (gamma 1/2.2): colour information split parts could not keep.
const GAMA = Uint8Array.from([
  0, 0, 0, 4, 0x67, 0x41, 0x4d, 0x41, 0, 0, 0xb1, 0x8f, 0x0b, 0xfc, 0x61, 0x05,
]);

for (const view of [
  { width: 1440, height: 1000, w: 1080, h: 20000, parts: 2 },
  { width: 390, height: 844, touch: true, w: 1080, h: 5000, parts: 2 },
]) {
  const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      hasTouch: !!view.touch,
      isMobile: !!view.touch,
    }),
    p = await context.newPage(),
    checks = {};
  p.setDefaultTimeout(60000);
  p.on("pageerror", (e) => errors.push(`${view.width}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${view.width}: ${m.text()}`);
  });
  console.log(`R10 split at ${view.width}px`);
  const tools = () => p.getByRole("dialog", { name: "Image tools", exact: true });
  const options = (name) =>
    p.getByRole("button", { name: `Image options for ${name}`, exact: true });
  const records = () =>
    p.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open("inkstrip");
          req.onsuccess = () => {
            const get = req.result.transaction("panels").objectStore("panels").getAll();
            get.onsuccess = () => resolve(get.result.sort((a, b) => a.order - b.order));
          };
        }),
    );
  const blobBytes = (id) =>
    p.evaluate(
      (id) =>
        new Promise((resolve) => {
          const req = indexedDB.open("inkstrip");
          req.onsuccess = () => {
            const get = req.result.transaction("blobs").objectStore("blobs").get(id);
            get.onsuccess = async () => {
              const bytes = new Uint8Array(await get.result.arrayBuffer());
              let s = "";
              for (let i = 0; i < bytes.length; i += 32768)
                s += String.fromCharCode(...bytes.subarray(i, i + 32768));
              resolve(btoa(s));
            };
          };
        }),
      id,
    );

  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Split QA");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  const tall = tallPng(view.w, view.h),
    small = tallPng(96, 128),
    tagged = tallPng(64, 20000, GAMA);
  await p
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: "small.png", mimeType: "image/png", buffer: Buffer.from(small.png) },
      { name: "tall.png", mimeType: "image/png", buffer: Buffer.from(tall.png) },
      { name: "after.png", mimeType: "image/png", buffer: Buffer.from(small.png) },
    ]);
  await p.getByRole("button", { name: "Edit Image after.png", exact: true }).waitFor();
  const before = await records(),
    original = before.find((r) => r.name === "tall.png");

  // An image that already fits offers no split.
  await options("small.png").click();
  await tools().waitFor();
  assert.equal(
    await tools()
      .getByRole("button", { name: /^Split into/ })
      .count(),
    0,
  );
  await p.keyboard.press("Escape");
  await tools().waitFor({ state: "detached" });

  // The failed Raster open points to the split.
  await options("tall.png").click();
  await tools().getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  const studio = p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true });
  await studio.getByRole("alert").filter({ hasText: "could not be opened" }).waitFor();
  await studio.getByText(/Image options → Split into\s+editable pages/).waitFor();
  await studio.getByRole("button", { name: "Return to chapter", exact: true }).click();
  await studio.waitFor({ state: "detached" });
  checks.hint = true;

  // Split: parts added right after the original, original untouched.
  await options("tall.png").click();
  await tools()
    .getByRole("button", { name: `Split into ${view.parts} editable pages`, exact: true })
    .click();
  await p.getByText(`Added ${view.parts} editable pages below tall.png`).waitFor();
  const after = await records();
  assert.deepEqual(
    after.map((r) => r.name),
    [
      "small.png",
      "tall.png",
      ...Array.from({ length: view.parts }, (_, i) => `tall-part-0${i + 1}-of-0${view.parts}.png`),
      "after.png",
    ],
  );
  assert.deepEqual(
    after.find((r) => r.id === original.id),
    { ...original, order: after.find((r) => r.id === original.id).order },
    "original record unchanged",
  );
  assert.equal(
    Buffer.from(await blobBytes(original.blobId), "base64").equals(Buffer.from(tall.png)),
    true,
  );
  const parts = after.filter((r) => r.name.startsWith("tall-part-"));
  const joined = new Uint8Array(view.w * view.h * 4);
  let offset = 0;
  for (const part of parts) {
    assert.equal(part.width, view.w);
    assert.ok(part.width * part.height <= (view.touch ? 4_000_000 : 16_777_216));
    const decoded = decode(Buffer.from(await blobBytes(part.blobId), "base64"));
    assert.equal(decoded.depth, 8);
    assert.equal(decoded.channels, 4);
    joined.set(decoded.data, offset);
    offset += decoded.data.length;
  }
  assert.equal(offset, joined.length);
  assert.ok(
    Buffer.from(joined).equals(Buffer.from(tall.data)),
    "parts stack into the exact original pixels",
  );
  checks.exact = true;

  // A part opens normally in Raster Studio.
  await options(parts[0].name).click();
  await tools().getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  await studio.locator(".pro-artboard").waitFor();
  assert.equal(
    await studio.getByRole("alert").filter({ hasText: "could not be opened" }).count(),
    0,
  );
  await studio
    .getByRole("button", { name: "Back to chapter from Pro Studio", exact: true })
    .click();
  await studio.waitFor({ state: "detached" });
  checks.partOpens = true;

  // Colour-tagged PNG: refused with a reason, nothing added.
  if (!view.touch) {
    await p
      .locator('input[type="file"]')
      .first()
      .setInputFiles([
        { name: "gamma.png", mimeType: "image/png", buffer: Buffer.from(tagged.png) },
      ]);
    await p.getByRole("button", { name: "Edit Image gamma.png", exact: true }).waitFor();
    const count = (await records()).length;
    await options("gamma.png").click();
    await tools()
      .getByRole("button", { name: /^Split into \d+ editable pages$/ })
      .click();
    await p.getByText(/contains gamma information/).waitFor();
    assert.equal((await records()).length, count, "nothing added");
    checks.refusesColourChunks = true;
  }

  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await p.screenshot({ path: `/workspace/screenshots/r10-split-${view.width}.png` });
  results.push({ width: view.width, ...checks });
  await context.close();
}
await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));
assert.deepEqual(errors, []);
