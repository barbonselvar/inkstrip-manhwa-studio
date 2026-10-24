/** Native worker and independent SVG image comparisons for the shared Dialogue rendering path. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 500)));
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const [
      { ProRenderer },
      { fromPanel, layer },
      { DEFAULT_LETTERING },
      { vectorSvg },
      { defaultEffect },
    ] = await Promise.all([
      import("/src/lib/studio/pro/client.ts"),
      import("/src/lib/studio/pro/model.ts"),
      import("/src/lib/studio/dialogue/types.ts"),
      import("/src/lib/studio/pro/files.ts"),
      import("/src/lib/studio/pro/effects.ts"),
    ]);
    const renderer = new ProRenderer(),
      cases = [];
    const decode = async (blob) => {
      const b = await createImageBitmap(blob),
        c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      const x = c.getContext("2d");
      x.drawImage(b, 0, 0);
      b.close();
      return {
        pixels: x.getImageData(0, 0, c.width, c.height).data,
        width: c.width,
        height: c.height,
      };
    };
    try {
      for (const item of [
        { language: "en", text: "Every frame.\nA world.", font: "Arial" },
        { language: "ko", text: "새로운 이야기가 시작됩니다", font: "Noto Sans CJK KR" },
        { language: "ar", text: "مرحبا بالعالم", font: "Noto Sans Arabic" },
        { language: "ja", text: "次の駅で、会おう。", font: "Noto Sans CJK JP" },
        { language: "ja", text: "「次の駅で会おう。」", font: "Noto Sans CJK JP", vertical: true },
      ]) {
        await document.fonts.load(`500 36px "${item.font}"`, item.text);
        const d = fromPanel({ id: "fixture", name: "Lettering fixture", width: 512, height: 320 });
        d.source = undefined;
        d.background = "transparent";
        d.layers = [];
        d.dialogue = { version: 1, regions: [], presets: [] };
        const l = layer("text", 440, 260);
        l.transform = { ...l.transform, x: 30, y: 25 };
        l.text = item.text;
        l.fill = "#103020";
        l.stroke = "#ffffff";
        l.strokeWidth = 2;
        l.fontSize = 36;
        l.align = "center";
        l.lettering = {
          ...DEFAULT_LETTERING,
          font: item.font,
          language: item.language,
          direction: item.language === "ar" ? "rtl" : "ltr",
          writing: item.vertical ? "vertical" : "horizontal",
          fit: false,
          padding: 8,
        };
        d.layers = [l];
        await renderer.init({
          document: d,
          assets: {},
          revision: 0,
          acceptedBlobId: "s",
          updatedAt: 0,
        });
        const png = (await renderer.export(d, 16_777_216, "image/png", 1, () => {})).blob;
        const actual = await decode(png),
          svg = vectorSvg(d),
          url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const c = document.createElement("canvas");
          c.width = image.naturalWidth;
          c.height = image.naturalHeight;
          const x = c.getContext("2d");
          x.drawImage(image, 0, 0);
          const reference = x.getImageData(0, 0, c.width, c.height).data;
          let sum = 0,
            different = 0,
            ink = 0;
          for (let i = 0; i < reference.length; i++) {
            const diff = Math.abs(reference[i] - actual.pixels[i]);
            sum += diff;
            if (diff > 16) different++;
            if (i % 4 === 3 && actual.pixels[i] > 0) ink++;
          }
          cases.push({
            ...item,
            mean: sum / reference.length,
            fraction: different / reference.length,
            ink,
            svgPng: c.toDataURL(),
            svg,
            png: await new Promise((r) => {
              const f = new FileReader();
              f.onload = () => r(f.result);
              f.readAsDataURL(png);
            }),
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const d = fromPanel({ id: "region", name: "ROI", width: 256, height: 256 });
      d.source = undefined;
      const shape = layer("shape", 80, 60);
      shape.fill = "#4090c0";
      shape.transform.x = 20;
      shape.transform.y = 30;
      shape.effects = [{ ...defaultEffect("dropShadow"), radius: 5, distance: 6 }];
      d.layers = [shape];
      await renderer.init({
        document: d,
        assets: {},
        revision: 0,
        acceptedBlobId: "s",
        updatedAt: 0,
      });
      const before = JSON.stringify(d),
        all = await decode((await renderer.export(d, 16_777_216, "image/png", 1, () => {})).blob),
        roi = await decode(
          (await renderer.region(d, 16_777_216, { x: 34, y: 43, width: 90, height: 88 })).blob,
        );
      let mismatch = 0;
      for (let y = 0; y < 88; y++)
        for (let x = 0; x < 90; x++)
          for (let c = 0; c < 4; c++)
            if (roi.pixels[(y * 90 + x) * 4 + c] !== all.pixels[((y + 43) * 256 + x + 34) * 4 + c])
              mismatch++;
      let rejected = false;
      try {
        await renderer.region(d, 16_777_216, { x: -1, y: 0, width: 32, height: 32 });
      } catch {
        rejected = true;
      }
      const jpegDoc = fromPanel({
        id: "jpeg",
        name: "Transparent dialogue blend",
        width: 96,
        height: 64,
      });
      jpegDoc.source = undefined;
      jpegDoc.background = "transparent";
      const bubble = layer("shape", 64, 32);
      bubble.shape = "rectangle";
      bubble.dialogueRole = "bubble";
      bubble.fill = "#204060";
      bubble.strokeWidth = 0;
      bubble.opacity = 0.7;
      bubble.blend = "screen";
      bubble.transform.x = 16;
      bubble.transform.y = 16;
      jpegDoc.layers = [bubble];
      await renderer.init({
        document: jpegDoc,
        assets: {},
        revision: 0,
        acceptedBlobId: "s",
        updatedAt: 0,
      });
      const transparent = await decode(
          (await renderer.export(jpegDoc, 16_777_216, "image/png", 1, () => {})).blob,
        ),
        jpeg = await decode(
          (await renderer.export(jpegDoc, 16_777_216, "image/jpeg", 1, () => {})).blob,
        );
      const at = (32 * 96 + 48) * 4,
        alpha = transparent.pixels[at + 3] / 255,
        reference = [0, 1, 2].map((i) =>
          Math.round(transparent.pixels[at + i] * alpha + 255 * (1 - alpha)),
        ),
        actual = [...jpeg.pixels.slice(at, at + 3)],
        jpegError = Math.max(...actual.map((n, i) => Math.abs(n - reference[i])));
      return {
        cases,
        jpeg: { reference, actual, maxError: jpegError },
        region: {
          dimensions: [roi.width, roi.height],
          mismatch,
          rejected,
          documentUnchanged: before === JSON.stringify(d),
        },
      };
    } finally {
      renderer.dispose();
    }
  });
  await mkdir("/workspace/screenshots", { recursive: true });
  for (const [i, c] of result.cases.entries()) {
    await writeFile(
      `/workspace/screenshots/dialogue-lettering-${i}.png`,
      Buffer.from(c.png.split(",")[1], "base64"),
    );
    if (c.svgPng)
      await writeFile(
        `/workspace/screenshots/dialogue-lettering-${i}-svg.png`,
        Buffer.from(c.svgPng.split(",")[1], "base64"),
      );
    if (c.svg) await writeFile(`/workspace/screenshots/dialogue-lettering-${i}.svg`, c.svg);
    delete c.png;
    delete c.svgPng;
    delete c.svg;
  }
  await writeFile(
    "/workspace/screenshots/dialogue-render-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  for (const c of result.cases) {
    assert.ok(c.ink > 100);
    assert.ok(c.mean < 2 && c.fraction < 0.03, JSON.stringify(c));
  }
  assert.ok(
    result.jpeg.maxError <= 3,
    `JPEG matte must follow transparent layer blending: ${JSON.stringify(result.jpeg)}`,
  );
  assert.equal(result.region.mismatch, 0);
  assert.deepEqual(result.region.dimensions, [90, 88]);
  assert.equal(result.region.rejected, true);
  assert.equal(result.region.documentUnchanged, true);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
