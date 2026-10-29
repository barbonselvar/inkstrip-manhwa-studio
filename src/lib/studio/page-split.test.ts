import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "fast-png";
import {
  checkPngSplittable,
  needsSplit,
  partName,
  rowElements,
  SplitError,
  splitPlan,
} from "./page-split.ts";

const desktop = { maxSide: 16384, maxArea: 16_777_216 },
  touch = { maxSide: 16384, maxArea: 4_000_000 };

test("split plans cover every row once, within the Raster budget, as evenly as possible", () => {
  for (const [w, h, budget, count] of [
    [1080, 20000, desktop, 2],
    [1080, 20000, touch, 6],
    [1080, 5000, touch, 2],
    [800, 27348, desktop, 2],
    [64, 20000, desktop, 2],
  ] as const) {
    const parts = splitPlan(w, h, budget);
    assert.equal(parts.length, count, `${w}x${h}`);
    let y = 0;
    for (const p of parts) {
      assert.equal(p.y, y);
      assert.ok(p.height >= 1 && p.height <= budget.maxSide && w * p.height <= budget.maxArea);
      y += p.height;
    }
    assert.equal(y, h);
    const heights = parts.map((p) => p.height);
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, "even bands");
  }
  assert.equal(needsSplit(1080, 1920, touch), false);
  assert.equal(needsSplit(1080, 5000, touch), true);
  assert.equal(needsSplit(1080, 10000, desktop), false);
  assert.equal(needsSplit(1080, 20000, desktop), true);
  assert.equal(needsSplit(20000, 100, desktop), false, "too wide: splitting by height cannot help");
  assert.throws(() => splitPlan(20000, 100, desktop), SplitError);
  assert.throws(() => splitPlan(1, 64 * 16384 + 1, desktop), /more than 64 pages/);
  assert.equal(partName("scan.final.png", 0, 3), "scan.final-part-01-of-03.png");
});

test("PNG parts stack back into the original pixels for every bit depth and colour type", () => {
  const cases: [number, number, number[][] | null, number[] | null][] = [
    [1, 1, null, null],
    [2, 1, null, null],
    [
      4,
      1,
      [
        [0, 0, 0],
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ],
      null,
    ],
    [8, 1, null, null],
    [8, 2, null, null],
    [8, 3, null, null],
    [8, 4, null, null],
    [16, 3, null, null],
    [16, 4, null, null],
    [
      8,
      1,
      [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      [0, 128, 255],
    ],
  ];
  for (const [depth, channels, palette, transparency] of cases) {
    const w = 37,
      h = 1003,
      per = rowElements(w, channels, depth),
      max = palette ? palette.length - 1 : 2 ** Math.min(depth, 8) - 1,
      data =
        depth === 16
          ? Uint16Array.from({ length: per * h }, (_, i) => (i * 40503) % 65536)
          : Uint8Array.from({ length: per * h }, (_, i) =>
              depth < 8 ? (i * 131) % 256 : (i * 7) % (max + 1),
            );
    const original = decode(
      encode({
        width: w,
        height: h,
        data,
        depth: depth as 8,
        channels,
        ...(palette ? { palette } : {}),
        ...(transparency ? { transparency: Uint16Array.from(transparency) } : {}),
      }),
    );
    const parts = splitPlan(w, h, { maxSide: 16384, maxArea: w * 250 });
    assert.equal(parts.length, 5);
    const pieces = parts.map(({ y, height }) =>
      decode(
        encode({
          width: w,
          height,
          data: original.data.subarray(y * per, (y + height) * per),
          depth: original.depth,
          channels: original.channels,
          ...(original.palette ? { palette: original.palette } : {}),
          ...(original.transparency ? { transparency: original.transparency } : {}),
        }),
      ),
    );
    const joined: number[] = pieces.flatMap((p) => [...p.data]);
    assert.deepEqual(joined, [...original.data], `${depth}-bit, ${channels} channel(s)`);
    for (const p of pieces) {
      assert.equal(p.depth, original.depth);
      assert.equal(p.channels, original.channels);
      assert.deepEqual(p.palette, original.palette);
      assert.deepEqual(
        p.transparency && [...p.transparency],
        original.transparency && [...original.transparency],
      );
    }
  }
});

test("PNGs whose display depends on colour or animation chunks are refused", () => {
  const plain = encode({ width: 4, height: 4, data: new Uint8Array(64), depth: 8, channels: 4 });
  assert.doesNotThrow(() => checkPngSplittable(plain));
  for (const [type, why] of [
    ["gAMA", /gamma/],
    ["iCCP", /colour profile/],
    ["cHRM", /colour primaries/],
    ["acTL", /animation/],
  ] as const) {
    const chunk = new Uint8Array(16);
    new DataView(chunk.buffer).setUint32(0, 4);
    chunk.set(new TextEncoder().encode(type), 4);
    const tagged = new Uint8Array([...plain.subarray(0, 33), ...chunk, ...plain.subarray(33)]);
    assert.throws(
      () => checkPngSplittable(tagged),
      (e: unknown) => e instanceof SplitError && why.test((e as Error).message),
      type,
    );
  }
});
