/** Native selection coverage, independent of the low-resolution synthesis context.
 * This tests traditional local repair, not neural/generative inference. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const { retouchImage } = await import("/src/lib/studio/retouch/client.ts"),
      { paintSelection } = await import("/src/lib/studio/retouch/selection.ts");
    const w = 513,
      h = 437,
      canvas = new OffscreenCanvas(w, h),
      ctx = canvas.getContext("2d"),
      pixels = new ImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        pixels.data.set([(x * 7) % 211, (y * 9) % 229, (x + y) % 197, 255], (y * w + x) * 4);
    ctx.putImageData(pixels, 0, 0);
    const stroke = (mode, a, b) => ({
        tool: "rectangle",
        mode,
        size: 1,
        feather: 0,
        points: [
          { x: a[0] / w, y: a[1] / h },
          { x: b[0] / w, y: b[1] / h },
        ],
      }),
      strokes = [stroke("add", [113, 87], [401, 355]), stroke("subtract", [240, 180], [270, 220])],
      mask = new OffscreenCanvas(w, h),
      mc = mask.getContext("2d");
    paintSelection(mc, strokes, w, h);
    const coverage = mc.getImageData(0, 0, w, h).data,
      input = await canvas.convertToBlob(),
      start = performance.now(),
      blob = await retouchImage(input, strokes, {
        mode: "local",
        signal: new AbortController().signal,
        progress: () => {},
      }),
      bitmap = await createImageBitmap(blob),
      output = new OffscreenCanvas(w, h),
      oc = output.getContext("2d");
    oc.drawImage(bitmap, 0, 0);
    bitmap.close();
    const actual = oc.getImageData(0, 0, w, h).data;
    let outsidePixels = 0,
      outsideChanged = 0,
      insideChanged = 0;
    for (let p = 0; p < w * h; p++) {
      const changed = [0, 1, 2, 3].some((c) => actual[p * 4 + c] !== pixels.data[p * 4 + c]);
      if (coverage[p * 4 + 3] === 0) {
        outsidePixels++;
        if (changed) outsideChanged++;
      } else if (changed) insideChanged++;
      if (actual[p * 4 + 3] !== 255) throw Error("Source alpha changed");
    }
    return {
      width: w,
      height: h,
      outsidePixels,
      outsideChanged,
      insideChanged,
      ms: performance.now() - start,
    };
  });
  await writeFile(
    "/workspace/r14-evidence/retouch-precision-latest.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  assert.equal(
    result.outsideChanged,
    0,
    "all native unselected pixels, including subtract holes, must remain byte-exact",
  );
  assert.ok(result.insideChanged > 0, "selected pixels must actually be repaired");
} finally {
  await browser.close();
}
