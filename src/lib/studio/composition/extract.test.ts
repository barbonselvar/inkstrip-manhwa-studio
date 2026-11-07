import test from "node:test";
import assert from "node:assert/strict";
import {
  rectSelection,
  polygonSelection,
  maskBounds,
  estimateBackground,
  generateMatte,
  decontaminate,
  stampBrush,
  strokeBrush,
  applyMatte,
  recolor,
  dilateAlpha,
  buildAsset,
  fitArea,
  type RGB,
} from "./extract.ts";

/** White background with a black horizontal antialiased bar (rows 18..21 solid, 17/22 at 50%). */
function synthetic(width = 40, height = 40) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let ink = 0;
      if (x >= 8 && x < 32) ink = y >= 18 && y <= 21 ? 1 : y === 17 || y === 22 ? 0.5 : 0;
      const v = Math.round(255 * (1 - ink));
      rgba.set([v, v, v, 255], o);
    }
  return { rgba, width, height };
}
const count = (mask: Uint8Array, min = 1) => mask.reduce((n, v) => n + (v >= min ? 1 : 0), 0);

test("rectangle selection is clipped and order independent", () => {
  const m = rectSelection(10, 8, 7, 6, 2, 1);
  assert.equal(count(m), 5 * 5);
  assert.deepEqual(maskBounds(m, 10, 8), { x: 2, y: 1, width: 5, height: 5 });
  const clipped = rectSelection(10, 8, -5, -5, 3, 100);
  assert.equal(count(clipped), 3 * 8);
});

test("polygon rasterization covers the expected area at pixel centers", () => {
  const square = polygonSelection(20, 20, [
    { x: 2, y: 2 },
    { x: 12, y: 2 },
    { x: 12, y: 12 },
    { x: 2, y: 12 },
  ]);
  assert.equal(count(square), 100);
  const triangle = polygonSelection(100, 100, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ]);
  // Half of the surface, within one-pixel diagonal tolerance.
  assert.ok(Math.abs(count(triangle) - 5000) <= 100, String(count(triangle)));
  assert.equal(triangle[5 * 100 + 5], 255);
  assert.equal(triangle[95 * 100 + 95], 0);
  assert.equal(
    count(
      polygonSelection(10, 10, [
        { x: 1, y: 1 },
        { x: 5, y: 5 },
      ]),
    ),
    0,
  );
});

test("color-key matte removes a flat background and keeps antialiased strokes", () => {
  const { rgba, width, height } = synthetic();
  const original = Uint8ClampedArray.from(rgba);
  const selection = rectSelection(width, height, 2, 2, 38, 38);
  const { alpha, backgrounds } = generateMatte(rgba, width, height, selection);
  assert.equal(backgrounds.length, 1);
  assert.deepEqual(backgrounds[0], [255, 255, 255]);
  assert.equal(alpha[5 * width + 5], 0, "background removed");
  assert.equal(alpha[19 * width + 20], 255, "solid stroke kept");
  const edge = alpha[17 * width + 20]!;
  assert.ok(edge > 20 && edge < 255, `antialiased edge is partial: ${edge}`);
  assert.equal(alpha[0], 0, "outside selection is zero");
  assert.equal(alpha[19 * width + 0], 0, "stroke outside selection is zero");
  assert.deepEqual(rgba, original, "source pixels untouched");
});

test("background estimate ignores a stroke crossing the selection border", () => {
  const { rgba, width, height } = synthetic();
  // Selection border crosses the bar on its left/right ends but is dominated by white.
  const selection = rectSelection(width, height, 12, 4, 28, 36);
  const bg = estimateBackground(rgba, width, height, selection);
  assert.equal(bg.length, 1);
  assert.ok(bg[0]!.every((v) => v > 240));
});

test("decontamination un-mixes the background from edge pixels", () => {
  // Red stroke at 50% coverage over white is observed as (255,128,128).
  const rgba = new Uint8ClampedArray([255, 128, 128, 255]);
  const out = decontaminate(rgba, Uint8Array.of(128), [[255, 255, 255]]);
  assert.ok(out[0]! > 250 && out[1]! < 10 && out[2]! < 10, Array.from(out).join());
  assert.equal(rgba[1], 128, "input untouched");
  const opaque = decontaminate(rgba, Uint8Array.of(255), [[255, 255, 255]]);
  assert.deepEqual(Array.from(opaque), [255, 128, 128, 255]);
});

test("brush semantics: foreground, eraser, restore and background removal", () => {
  const { rgba, width, height } = synthetic();
  const selection = rectSelection(width, height, 2, 2, 38, 38);
  const { alpha: preliminary, backgrounds, key } = generateMatte(rgba, width, height, selection);
  const context = { rgba, preliminary, backgrounds, key };
  const alpha = Uint8Array.from(preliminary);
  stampBrush(alpha, width, height, { x: 5, y: 5 }, 3, "foreground", context, 1);
  assert.equal(alpha[5 * width + 5], 255, "foreground forces keep on background");
  stampBrush(alpha, width, height, { x: 20, y: 19.5 }, 3, "erase", context, 1);
  assert.equal(alpha[19 * width + 20], 0, "eraser removes stroke");
  strokeBrush(alpha, width, height, { x: 2, y: 2 }, { x: 38, y: 38 }, 6, "restore", context, 1);
  strokeBrush(
    alpha,
    width,
    height,
    { x: 20, y: 19.5 },
    { x: 20, y: 19.5 },
    4,
    "restore",
    context,
    1,
  );
  assert.equal(alpha[19 * width + 20], 255, "restore returns stroke");
  assert.equal(alpha[5 * width + 5], 0, "restore returns background removal");
  // Background brush only removes background-like pixels under it.
  const keep = new Uint8Array(width * height).fill(255);
  stampBrush(keep, width, height, { x: 20, y: 18 }, 6, "background", context, 1);
  assert.equal(keep[14 * width + 20], 0, "white under brush removed");
  assert.equal(keep[19 * width + 20], 255, "ink under brush kept");
  assert.equal(keep[2 * width + 2], 255, "outside brush untouched");
});

test("soft brush edges never overshoot", () => {
  const alpha = new Uint8Array(100).fill(100);
  const ctx = {
    rgba: new Uint8ClampedArray(400),
    preliminary: alpha,
    backgrounds: [] as RGB[],
    key: { tolerance: 0, full: 1 },
  };
  stampBrush(alpha, 10, 10, { x: 5, y: 5 }, 4, "foreground", ctx, 0);
  assert.ok(alpha.every((v) => v >= 100 && v <= 255));
  assert.ok(alpha[5 * 10 + 5]! > alpha[5 * 10 + 8]!);
});

test("recolor keeps alpha and replaces color", () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 200, 255, 255, 255, 0]);
  const out = recolor(rgba, "#ff0000", 1, 0);
  assert.deepEqual(Array.from(out.slice(0, 4)), [255, 0, 0, 200]);
  assert.deepEqual(Array.from(out.slice(4)), [255, 255, 255, 0], "transparent pixel unchanged");
  assert.deepEqual(Array.from(rgba.slice(0, 4)), [0, 0, 0, 200]);
});

test("outline dilation grows the alpha bounding box by the width", () => {
  const alpha = new Uint8Array(30 * 30);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) alpha[y * 30 + x] = 255;
  const grown = dilateAlpha(alpha, 30, 30, 3);
  assert.deepEqual(maskBounds(grown, 30, 30, 127), { x: 7, y: 7, width: 16, height: 16 });
  assert.deepEqual(maskBounds(alpha, 30, 30), { x: 10, y: 10, width: 10, height: 10 });
});

test("buildAsset crops to artwork with outline/shadow room and preserves transparency", () => {
  const { rgba, width, height } = synthetic();
  const original = Uint8ClampedArray.from(rgba);
  const selection = rectSelection(width, height, 2, 2, 38, 38);
  const { alpha, backgrounds } = generateMatte(rgba, width, height, selection);
  const plain = buildAsset(rgba, width, height, alpha, backgrounds, {
    decontaminate: true,
    opacity: 1,
    padding: 0,
  })!;
  assert.equal(plain.width, 24);
  assert.equal(plain.height, 6);
  assert.ok(plain.data[3]! > 20 && plain.data[3]! < 255, "antialiased top row kept partially");
  assert.ok(plain.data[(2 * 24 + 5) * 4 + 3] === 255);
  const styled = buildAsset(rgba, width, height, alpha, backgrounds, {
    decontaminate: true,
    opacity: 0.5,
    padding: 1,
    outline: { color: "#ffffff", width: 2 },
    shadow: { color: "#000000", x: 3, y: 0, blur: 0, opacity: 1 },
  })!;
  assert.equal(styled.width, 24 + 2 * (1 + 2 + 3));
  // Corner of the padded frame stays transparent.
  assert.equal(styled.data[3], 0);
  // Opacity applied: solid stroke now ~50%.
  const center = ((styled.height >> 1) * styled.width + (styled.width >> 1)) * 4;
  assert.ok(Math.abs(styled.data[center + 3]! - 128) <= 1);
  assert.deepEqual(rgba, original);
  assert.equal(buildAsset(rgba, width, height, new Uint8Array(width * height), backgrounds), null);
});

test("applyMatte multiplies alpha only and fitArea respects the budget", () => {
  const out = applyMatte(new Uint8ClampedArray([10, 20, 30, 255]), Uint8Array.of(51));
  assert.deepEqual(Array.from(out), [10, 20, 30, 51]);
  const fit = fitArea(8000, 8000, 16_000_000);
  assert.ok(fit.width * fit.height <= 16_000_000);
  assert.equal(fitArea(100, 50, 1e9).scale, 1);
});
