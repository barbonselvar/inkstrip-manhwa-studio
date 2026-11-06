import { test } from "node:test";
import assert from "node:assert/strict";
import { boundary, boundaryOffset, BOUNDARY_SHAPES } from "./boundaries.ts";
import {
  fade,
  validateFade,
  validateObject,
  validateCompositionPreferences,
  presetBlobIds,
} from "./model.ts";
import { fadeCoverage } from "./masks.ts";
import { inkGlyph, inkPolygons, inkSupported } from "./ink.ts";
import { MANHWA_WORDS, INK_STYLES } from "./ink-catalog.ts";
import { sfx, common } from "./library.ts";
import { removeCornerMatte } from "./assets.ts";
import { projectBlobIds, encodeBackup, decodeBackup } from "../backup.ts";
test("legacy straight fade coverage is unchanged and optional boundaries validate", () => {
  const f = fade();
  validateFade(f);
  const shaped = { ...f, boundary: boundary("Straight") };
  for (let x = 0; x < 800; x += 100)
    for (let y = 0; y < 600; y += 10)
      assert.equal(fadeCoverage(f, x, y, 800, 600), fadeCoverage(shaped, x, y, 800, 600));
});
test("all nine boundary families have bounded deterministic coverage; wave changes the actual mask", () => {
  for (const shape of BOUNDARY_SHAPES) {
    const f = { ...fade(), boundary: boundary(shape) };
    validateFade(f);
    for (let x = 0; x <= 800; x += 20) {
      const n = fadeCoverage(f, x, 400, 800, 600);
      assert.ok(n >= 0 && n <= 1);
      assert.equal(n, fadeCoverage(f, x, 400, 800, 600));
    }
  }
  const f = { ...fade(), length: 100, boundary: { ...boundary("Wave"), frequency: 1 } };
  assert.notEqual(fadeCoverage(f, 200, 480, 800, 600), fadeCoverage(f, 600, 480, 800, 600));
});
test("Bezier control points and freehand vertices change the mask rather than a rectangular blur", () => {
  const a = boundary("Bezier"),
    b = { ...a, points: a.points.map((p) => ({ ...p, y: 0 })) };
  assert.notEqual(boundaryOffset(a, 0.5), boundaryOffset(b, 0.5));
  const f = boundary("Freehand");
  f.points = [
    { x: 0, y: 0 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0 },
  ];
  assert.equal(boundaryOffset(f, 0.5), 100);
  assert.equal(boundaryOffset(f, 0), 0);
});
test("top and bottom placements mirror exactly; both combines both edges", () => {
  const b = boundary("Organic"),
    f = { ...fade(), boundary: { ...b, placement: "Top" as const } };
  const g = { ...f, boundary: { ...b, placement: "Bottom" as const } },
    both = { ...f, boundary: { ...b, placement: "Both" as const } };
  for (let y = 0; y < 600; y += 7) {
    assert.equal(fadeCoverage(f, 200, y, 800, 600), fadeCoverage(g, 200, 600 - y, 800, 600));
    assert.equal(
      fadeCoverage(both, 200, y, 800, 600),
      Math.max(fadeCoverage(f, 200, y, 800, 600), fadeCoverage(g, 200, y, 800, 600)),
    );
  }
});
test("unsafe boundary geometry and unknown ink styles are rejected", () => {
  for (const patch of [
    { amplitude: Infinity },
    { frequency: 0 },
    { shape: "script" },
    { points: [] },
    { points: Array(129).fill({ x: 0, y: 0 }) },
  ])
    assert.throws(() =>
      validateFade({ ...fade(), boundary: { ...boundary(), ...patch } } as never),
    );
  assert.throws(() => validateObject({ ...sfx("SWISH"), ink: "untrusted" }));
});
test("original Hangul and English presets produce polygon outlines for every style", () => {
  for (const [, ko, en] of MANHWA_WORDS) {
    assert.ok(inkSupported(ko));
    assert.ok(inkSupported(en));
    for (const ink of INK_STYLES) {
      const o = { ...sfx(ko), ink };
      validateObject(o);
      const polys = inkPolygons(o);
      assert.ok(polys.length > 5);
      assert.ok(
        polys.every(
          (p) => p.length >= 4 && p.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)),
        ),
      );
    }
  }
  assert.equal(inkSupported("💥"), false);
  assert.equal(inkGlyph("💥"), null);
});
test("all composed Hangul syllables have editable geometric jamo outlines", () => {
  for (let c = 0xac00; c <= 0xd7a3; c++) assert.ok(inkGlyph(String.fromCodePoint(c))!.length > 0);
});
test("corner-connected matte removal preserves enclosed white ink and source bytes", () => {
  const w = 7,
    h = 7,
    data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 1; y < 6; y++)
    for (let x = 1; x < 6; x++) {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  const center = (3 * w + 3) * 4;
  data[center] = data[center + 1] = data[center + 2] = 255;
  const before = new Uint8ClampedArray(data),
    out = removeCornerMatte(data, w, h, 12);
  assert.equal(out[3], 0);
  assert.equal(out[center + 3], 255);
  assert.deepEqual(data, before);
});
test("asset presets retain blob references independently of chapter layers and round-trip in packages", async () => {
  const value = {
      ...common("Imported SWISH", 300, 100),
      kind: "overlay" as const,
      blobId: "asset-png",
    },
    preferences = {
      presets: [
        {
          id: "preset-1",
          name: "SWISH",
          category: "asset" as const,
          collection: "Sword Swing",
          value,
        },
      ],
      favorites: [],
    };
  validateCompositionPreferences(preferences);
  assert.deepEqual(presetBlobIds(preferences), ["asset-png"]);
  const project = {
    id: "project",
    title: "Assets",
    createdAt: 1,
    updatedAt: 1,
    compositionPreferences: preferences,
  };
  assert.deepEqual(projectBlobIds([], [], project), ["asset-png"]);
  const decoded = await decodeBackup(
    encodeBackup({
      project,
      chapters: [],
      panels: [],
      blobs: new Map([["asset-png", new Blob(["fixture"], { type: "image/png" })]]),
    }),
  );
  assert.equal(decoded.project.compositionPreferences!.presets[0].collection, "Sword Swing");
  assert.equal(await decoded.blobs.get("asset-png")!.text(), "fixture");
});
