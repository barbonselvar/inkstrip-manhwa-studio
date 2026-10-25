import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
/** Shared real-UI native/export fixtures; no app hooks or mocked workers. */
export function proBrowserFixtures(base, errors) {
  // Inspector toggles resize the canvas through ResizeObserver. CDP coordinates
  // must use the settled frame, otherwise a touch can land on empty artwork.
  async function artboardBounds(p) {
    return p.locator(".pro-artboard").evaluate(async (el) => {
      let previous,
        stable = 0;
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        const r = el.getBoundingClientRect(),
          bounds = { x: r.x, y: r.y, width: r.width, height: r.height },
          key = JSON.stringify(bounds);
        stable = key === previous ? stable + 1 : 0;
        if (stable >= 2 && r.width > 0 && r.height > 0) return bounds;
        previous = key;
      }
      throw new Error("Artboard layout did not settle before pointer input.");
    });
  }
  async function tab(p, name) {
    await p
      .getByRole("navigation", { name: "Pro panels", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
  }

  async function records(p) {
    return p.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip");
        r.onsuccess = () => resolve(r.result);
      });
      const rows = await new Promise((resolve) => {
        const r = db.transaction("panels").objectStore("panels").getAll();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return rows;
    });
  }

  async function start(p) {
    p.setDefaultTimeout(30000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await p.goto(base);
    await p.getByRole("button", { name: "New project", exact: true }).click();
    await p.getByPlaceholder("Night Market").fill("Transform QA");
    await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    const source = await p.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 96;
      const x = c.getContext("2d");
      const image = x.createImageData(128, 96);
      for (let y = 0; y < 96; y++)
        for (let px = 0; px < 128; px++)
          image.data.set(
            [px * 2, y * 2, 80, px < 16 ? 0 : px < 32 ? 128 : 255],
            (y * 128 + px) * 4,
          );
      x.putImageData(image, 0, 0);
      return c.toDataURL().split(",")[1];
    });
    await p
      .locator("input[type=file]")
      .first()
      .setInputFiles([
        { name: "geometry.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") },
      ]);
    await p.getByRole("button", { name: "Edit Image geometry.png", exact: true }).waitFor();
    return source;
  }

  async function open(p, mode = "Raster") {
    const button = p.getByRole("button", { name: `Open in ${mode} Studio`, exact: true });
    await button.scrollIntoViewIfNeeded();
    assert.ok(await button.isVisible());
    assert.ok(await button.isEnabled());
    await button.click();
    await p.getByRole("dialog", { name: `Inkstrip ${mode} Studio`, exact: true }).waitFor();
  }

  async function load(p, d, source, assets = { source: { mime: "image/png", data: source } }) {
    await tab(p, "History");
    const count = await p.locator(".pro-history-list li").count();
    await tab(p, "Assets");
    await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles([
      {
        name: "transform.inkstrip",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            format: "inkstrip-pro",
            version: d.version === 3 ? 9 : d.version === 2 ? 8 : 1,
            document: d,
            assets,
          }),
        ),
      },
    ]);
    await p
      .getByText("Native document imported into this Pro draft. Chapter unchanged.", {
        exact: true,
      })
      .waitFor();
    await tab(p, "History");
    await p.waitForFunction(
      (n) => document.querySelectorAll(".pro-history-list li").length === Math.min(51, n + 1),
      count,
    );
  }

  async function native(p) {
    await tab(p, "Export");
    const ev = p.waitForEvent("download");
    await p.getByRole("button", { name: "Export editable .inkstrip", exact: true }).click();
    const bytes = await readFile(await (await ev).path());
    return { bytes, value: JSON.parse(bytes.toString()) };
  }

  async function raster(p, mime = "image/png") {
    await tab(p, "Export");
    await p.getByLabel("Pro export format", { exact: true }).selectOption(mime);
    const ev = p.waitForEvent("download");
    await p.getByRole("button", { name: /^Export composite ·/ }).click();
    const bytes = await readFile(await (await ev).path());
    return p.evaluate(
      async ({ data, mime }) => {
        const b = await createImageBitmap(new Blob([Uint8Array.from(data)], { type: mime })),
          c = document.createElement("canvas");
        c.width = b.width;
        c.height = b.height;
        const x = c.getContext("2d");
        x.drawImage(b, 0, 0);
        b.close();
        return {
          width: c.width,
          height: c.height,
          pixels: [...x.getImageData(0, 0, c.width, c.height).data],
        };
      },
      { data: [...bytes], mime },
    );
  }

  function same(a, b, tolerance = 1) {
    assert.equal(a.width, b.width);
    assert.equal(a.height, b.height);
    for (let i = 0; i < a.pixels.length; i++)
      assert.ok(
        Math.abs(a.pixels[i] - b.pixels[i]) <= tolerance,
        `channel ${i}: ${a.pixels[i]} ≠ ${b.pixels[i]}`,
      );
  }

  async function preview(p) {
    await p.waitForFunction(
      () =>
        document
          .querySelector('canvas[aria-label="Pro composite preview"]')
          ?.getAttribute("aria-busy") === "false",
    );
    return p.evaluate(() => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      return {
        width: c.width,
        height: c.height,
        pixels: [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data],
      };
    });
  }
  return { tab, records, start, open, load, native, raster, same, preview, artboardBounds };
}
