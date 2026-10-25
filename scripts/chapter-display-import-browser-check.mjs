/** Chapter Display and universal import: real UI, worker decoders, IndexedDB and stitching.
 * Source-module target (store access): local DEV only. Quota failure is an injected
 * boundary test; every decode, conversion and transaction is real. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { encode } from "fast-png";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
await mkdir("/workspace/chapter-evidence", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  results = [],
  errors = [];
const fixture = (name) => readFile(`src/lib/studio/fixtures/import/${name}`);
const file = async (name, from = name, mimeType = "") => ({
  name,
  mimeType,
  buffer: await fixture(from),
});
/** Solid-colour PNG generated in Node, so pixel order can be verified in the stitched page. */
function solid(name, width, height, rgb) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) data.set(rgb, i);
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(encode({ width, height, data, channels: 3 })),
  };
}
/** Tall strip with a vertical gradient: row y has red = y mod 256. */
function tall(name, width, height) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([y & 255, (y >> 8) & 255, 90], (y * width + x) * 3);
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(encode({ width, height, data, channels: 3 })),
  };
}

async function store(p) {
  await p.evaluate(async () => {
    if (window.__chapterStore) return;
    for (const entry of performance
      .getEntriesByType("resource")
      .filter((x) => new URL(x.name).pathname === "/src/lib/studio/store.ts")) {
      const s = (await import(entry.name)).useStudio;
      if (
        s.getState().ready &&
        s.getState().chapters.some((c) => location.pathname.endsWith(c.id))
      ) {
        window.__chapterStore = s;
        return;
      }
    }
    throw Error("Chapter store module not found");
  });
  await p.waitForFunction(() => window.__chapterStore.getState().job === null, null, {
    timeout: 120000,
  });
}
const state = (p) =>
  p.evaluate(() => {
    const s = window.__chapterStore.getState(),
      chapter = s.chapters.find((c) => location.pathname.endsWith(c.id));
    return {
      chapter,
      panels: s.panels
        .filter((x) => x.chapterId === chapter.id)
        .sort((a, b) => a.order - b.order)
        .map(({ id, name, mime, width, height, blobId }) => ({
          id,
          name,
          mime,
          width,
          height,
          blobId,
        })),
      banner: s.banner,
      failures: (s.importFailures[chapter.id] ?? []).map(({ name, kind, reason }) => ({
        name,
        kind,
        reason,
      })),
      notes: s.importNotes[chapter.id] ?? [],
    };
  });
async function input(p, files) {
  await p.locator('input[type="file"]').first().setInputFiles(files);
  await store(p);
}
const blobBytes = (p, id) =>
  p.evaluate(async (id) => {
    const { getBlob } = await import("/src/lib/studio/db.ts");
    const b = await getBlob(id);
    return b ? [...new Uint8Array(await b.arrayBuffer())] : null;
  }, id);
/** Pixel samples from the rendered page images (document order = reading order). */
const pageSamples = (p, points) =>
  p.evaluate(async (points) => {
    const imgs = [...document.querySelectorAll("img.manhwa-image")];
    await Promise.all(imgs.map((i) => i.decode()));
    return points.map(([part, x, y]) => {
      const img = imgs[part],
        c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      return [...g.getImageData(x, y, 1, 1).data];
    });
  }, points);
const near = (a, b, t = 6) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
async function showDisplay(p, mobile) {
  if (mobile)
    await p
      .getByLabel("Chapter views", { exact: true })
      .getByRole("button", { name: "Display", exact: true })
      .click();
}
async function showPanels(p, mobile) {
  if (mobile)
    await p
      .getByLabel("Chapter views", { exact: true })
      .getByRole("button", { name: "Panels", exact: true })
      .click();
}

try {
  for (const view of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844, mobile: true },
    { width: 360, height: 780, mobile: true },
  ]) {
    const context = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        hasTouch: !!view.mobile,
        isMobile: !!view.mobile,
      }),
      p = await context.newPage(),
      checks = {};
    p.setDefaultTimeout(60000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    console.log(`Chapter display/import at ${view.width}px`);
    await p.goto(base);
    await p.getByRole("button", { name: "New project", exact: true }).click();
    await p.getByPlaceholder("Night Market").fill("Display QA");
    await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    await store(p);

    // --- Zero images: helpful empty state, Display disabled.
    await showDisplay(p, view.mobile);
    await p.getByText("No images yet.", { exact: true }).waitFor();
    await showPanels(p, view.mobile);
    assert.equal(
      await p
        .getByRole("complementary")
        .getByRole("button", { name: /^Display/ })
        .first()
        .isDisabled(),
      true,
    );
    checks.zero = true;

    // --- One image (the reported bug): JPEG at the page width is displayed, bytes untouched.
    const jpeg = await p.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      const g = c.getContext("2d");
      g.fillStyle = "#3366cc";
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = "#ffcc00";
      g.fillRect(0, 300, 800, 300);
      const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      return [...new Uint8Array(await b.arrayBuffer())];
    });
    await input(p, [{ name: "single.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) }]);
    let s = await state(p);
    assert.equal(s.panels.length, 1);
    assert.deepEqual(await blobBytes(p, s.panels[0].blobId), jpeg, "original JPEG bytes stored");
    await p.getByText("1 of 1 checked", { exact: true }).waitFor();
    await p.getByRole("button", { name: "Display 1", exact: true }).click();
    await store(p);
    await p.locator("img.manhwa-image").first().waitFor();
    s = await state(p);
    assert.equal(s.chapter.strip.panelIds.length, 1);
    assert.equal(s.chapter.strip.width, 800);
    assert.equal(s.chapter.strip.totalHeight, 600);
    assert.deepEqual(
      await blobBytes(p, s.chapter.strip.parts[0].blobId),
      jpeg,
      "single JPEG page reuses the original bytes",
    );
    const [top, bottom] = await pageSamples(p, [
      [0, 400, 100],
      [0, 400, 500],
    ]);
    assert.ok(near(top, [0x33, 0x66, 0xcc]) && near(bottom, [0xff, 0xcc, 0x00]));
    checks.singleImage = true;

    // --- Multiple images, reading order, reorder and selection notices.
    await showPanels(p, view.mobile);
    await input(p, [
      solid("red.png", 400, 200, [220, 30, 30]),
      solid("green.png", 400, 200, [30, 200, 60]),
    ]);
    await p.getByRole("button", { name: "Display 3", exact: true }).click();
    await store(p);
    s = await state(p);
    assert.deepEqual(
      s.chapter.strip.panelIds,
      s.panels.map((x) => x.id),
    );
    let samples = await pageSamples(p, [
      [0, 400, 100],
      [0, 400, 700],
      [0, 400, 1100],
    ]);
    assert.ok(near(samples[0], [0x33, 0x66, 0xcc]));
    assert.ok(near(samples[1], [220, 30, 30]));
    assert.ok(near(samples[2], [30, 200, 60]));
    await showPanels(p, view.mobile);
    await p.getByRole("button", { name: "Move down" }).nth(1).click(); // red below green
    await store(p);
    await showDisplay(p, view.mobile);
    await p.getByText("Images, order, or settings changed.", { exact: false }).waitFor();
    await showPanels(p, view.mobile);
    await p.getByRole("button", { name: "Display 3", exact: true }).click();
    await store(p);
    samples = await pageSamples(p, [
      [0, 400, 700],
      [0, 400, 1100],
    ]);
    assert.ok(near(samples[0], [30, 200, 60]) && near(samples[1], [220, 30, 30]), "reordered");
    await showPanels(p, view.mobile);
    await p.getByRole("button", { name: "Uncheck red.png", exact: true }).click();
    await showDisplay(p, view.mobile);
    await p.getByText("The checked photos differ from the page shown.", { exact: false }).waitFor();
    await showPanels(p, view.mobile);
    await p.getByRole("button", { name: "Check red.png", exact: true }).click();
    checks.multipleAndReorder = true;

    // --- Mixed formats with partial failures: order kept, specific reasons, retry offered.
    const truncated = (await fixture("original.jpg")).subarray(0, 200);
    await input(p, [
      await file("a.webp", "original.webp"),
      await file("b.heic", "original.heic"),
      await file("c.tiff", "lzw.tiff"),
      { name: "broken.jpg", mimeType: "image/jpeg", buffer: truncated },
      await file("d.jxl", "original.jxl"),
      await file("e.avif", "original.avif"),
      { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
      await file("f.gif", "animated.gif"),
      await file("g.bmp", "original.bmp"),
      await file("h-alpha.tiff", "alpha.tiff"),
    ]);
    s = await state(p);
    assert.deepEqual(
      s.panels.slice(3).map((x) => [x.name, x.mime]),
      [
        ["a.webp", "image/webp"],
        ["b.heic", "image/png"],
        ["c.tiff", "image/png"],
        ["d.jxl", "image/png"],
        ["e.avif", "image/avif"],
        ["f.gif", "image/gif"],
        ["g.bmp", "image/bmp"],
        ["h-alpha.tiff", "image/png"],
      ],
    );
    assert.deepEqual(
      s.failures.map((f) => [f.name, f.kind]),
      [
        ["broken.jpg", "corrupted"],
        ["notes.png", "unsupported"],
      ],
    );
    assert.equal(s.notes.length, 4);
    assert.ok(s.notes.every((n) => /converted to lossless PNG/.test(n)));
    await p.getByRole("region", { name: "Import report", exact: true }).waitFor();
    await p.getByText("broken.jpg", { exact: true }).waitFor();
    // Converted pixels are lossless: JPEG XL and TIFF match the PNG reference exactly.
    const exact = await p.evaluate(
      async (ids) => {
        const { getBlob } = await import("/src/lib/studio/db.ts");
        const read = async (b) => {
          const bm = await createImageBitmap(b),
            c = new OffscreenCanvas(bm.width, bm.height),
            g = c.getContext("2d");
          g.drawImage(bm, 0, 0);
          return [...g.getImageData(0, 0, bm.width, bm.height).data];
        };
        const ref = await read(
          await (await fetch("/src/lib/studio/fixtures/import/original.png")).blob(),
        );
        return Promise.all(
          ids.map(
            async (id) => JSON.stringify(await read(await getBlob(id))) === JSON.stringify(ref),
          ),
        );
      },
      [
        s.panels.find((x) => x.name === "d.jxl").blobId,
        s.panels.find((x) => x.name === "c.tiff").blobId,
      ],
    );
    assert.deepEqual(exact, [true, true]);
    // Original bytes are kept for browser-native formats (no recompression).
    assert.deepEqual(await blobBytes(p, s.panels.find((x) => x.name === "a.webp").blobId), [
      ...(await fixture("original.webp")),
    ]);
    // Retry keeps reporting the same specific failures without touching imported images.
    const before = s.panels.length;
    await p.getByRole("button", { name: "Retry 2 failed files", exact: true }).click();
    await store(p);
    s = await state(p);
    assert.equal(s.panels.length, before);
    assert.equal(s.failures.length, 2);
    await p
      .getByRole("region", { name: "Import report", exact: true })
      .screenshot({ path: `/workspace/screenshots/chapter-${view.width}-import-report.png` });
    await p.getByRole("button", { name: "Dismiss import report", exact: true }).click();
    checks.mixedFormats = true;

    // --- Storage failure (injected quota): that chunk adds nothing; retry then succeeds.
    await p.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      window.__restoreAdd = () => (IDBObjectStore.prototype.add = add);
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === "blobs") throw new DOMException("Injected quota", "QuotaExceededError");
        return add.apply(this, args);
      };
    });
    await input(p, [
      solid("quota-a.png", 64, 64, [1, 2, 3]),
      solid("quota-b.png", 64, 64, [4, 5, 6]),
    ]);
    s = await state(p);
    assert.equal(s.panels.length, before);
    assert.deepEqual(
      s.failures.map((f) => [f.name, f.kind]),
      [
        ["quota-a.png", "storage"],
        ["quota-b.png", "storage"],
      ],
    );
    await p.evaluate(() => window.__restoreAdd());
    await p.getByRole("button", { name: "Retry 2 failed files", exact: true }).click();
    await store(p);
    s = await state(p);
    assert.equal(s.panels.length, before + 2);
    assert.deepEqual(
      s.panels.slice(-2).map((x) => x.name),
      ["quota-a.png", "quota-b.png"],
    );
    assert.equal(s.failures.length, 0);
    checks.storageFailureAndRetry = true;

    // --- Long vertical image: imports on touch devices and stays at full page width.
    await input(p, [tall("long-strip.png", 1080, 20000)]);
    s = await state(p);
    const strip = s.panels.at(-1);
    assert.deepEqual([strip.name, strip.width, strip.height], ["long-strip.png", 1080, 20000]);
    await p.evaluate(() =>
      window.__chapterStore
        .getState()
        .selectNone(
          window.__chapterStore.getState().chapters.find((c) => location.pathname.endsWith(c.id))
            .id,
        ),
    );
    await p.getByRole("button", { name: "Check long-strip.png", exact: true }).click();
    await p.getByRole("button", { name: "Display 1", exact: true }).click();
    await store(p);
    s = await state(p);
    assert.equal(s.chapter.strip.width, 800, "not narrowed");
    assert.equal(s.chapter.strip.totalHeight, Math.round(20000 * (800 / 1080)));
    if (view.mobile) assert.ok(s.chapter.strip.parts.length >= 2, "split across device canvases");
    // Rows continue across the part break: red channel follows the source row (y mod 256).
    const lastPart = s.chapter.strip.parts.length - 1,
      rowsBefore = s.chapter.strip.parts.slice(0, lastPart).reduce((n, x) => n + x.height, 0),
      pageY = rowsBefore + 10,
      [sample] = await pageSamples(p, [[lastPart, 400, 10]]),
      sourceRow = Math.round((pageY + 0.5) * (1080 / 800) - 0.5);
    assert.ok(
      Math.abs(sample[0] - (sourceRow & 255)) <= 4 ||
        Math.abs(sample[0] - (sourceRow & 255)) >= 250,
    );
    checks.longVertical = { parts: s.chapter.strip.parts.length, width: s.chapter.strip.width };

    // --- Large batch beyond the aggregate budget imports in chunks instead of failing.
    if (!view.mobile) {
      const plane = await fixture("batch-plane.png"); // 4000×4000 = 16 MP each
      const planes = Array.from({ length: 9 }, (_, i) => ({
        name: `plane-${i}.png`,
        mimeType: "image/png",
        buffer: plane,
      }));
      const count = (await state(p)).panels.length;
      await input(p, planes);
      s = await state(p);
      assert.equal(s.panels.length, count + 9, "144 MP batch imported in chunks");
      assert.deepEqual(
        s.panels.slice(-9).map((x) => x.name),
        planes.map((x) => x.name),
      );
      checks.chunkedBatch = true;
    }

    // --- Converted images open in Raster Studio at their real size.
    await showPanels(p, view.mobile);
    await p.evaluate(() => {
      const st = window.__chapterStore.getState(),
        chapter = st.chapters.find((c) => location.pathname.endsWith(c.id));
      st.selectNone(chapter.id);
    });
    await p.getByRole("button", { name: "Check b.heic", exact: true }).click();
    await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
    await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).waitFor();
    await p.waitForFunction(() => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      return c && c.width === 32 && c.height === 24 && c.getAttribute("aria-busy") === "false";
    });
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
      .waitFor({ state: "detached" });
    checks.rasterStudio = true;

    // --- Persistence after reload: images, order and the displayed page survive.
    const saved = await state(p);
    await p.reload();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    await p.evaluate(() => delete window.__chapterStore);
    await store(p);
    s = await state(p);
    assert.deepEqual(
      s.panels.map((x) => [x.name, x.blobId]),
      saved.panels.map((x) => [x.name, x.blobId]),
    );
    assert.deepEqual(s.chapter.strip.parts, saved.chapter.strip.parts);
    await showDisplay(p, view.mobile);
    await p.locator("img.manhwa-image").first().waitFor();
    checks.persistence = true;

    // --- Removing every photo of the page returns Display to its empty state.
    await showPanels(p, view.mobile);
    await p.getByRole("button", { name: "Remove long-strip.png", exact: true }).click();
    await p.waitForFunction(() => {
      const st = window.__chapterStore.getState(),
        chapter = st.chapters.find((c) => location.pathname.endsWith(c.id));
      return !st.panels.some((x) => x.name === "long-strip.png") && chapter.strip === null;
    });
    s = await state(p);
    assert.equal(s.chapter.strip, null);
    await showDisplay(p, view.mobile);
    await p.getByText("Nothing displayed yet.", { exact: true }).waitFor();
    checks.removalClearsPage = true;

    await p.screenshot({ path: `/workspace/screenshots/chapter-${view.width}.png` });
    await showPanels(p, view.mobile);
    await p.screenshot({ path: `/workspace/screenshots/chapter-${view.width}-panels.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.noOverflow = true;
    results.push({ width: view.width, mobileEmulation: !!view.mobile, ...checks });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "/workspace/chapter-evidence/chapter-display-import.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }));
} finally {
  await browser.close();
}
