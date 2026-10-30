import { test } from "node:test";
import assert from "node:assert/strict";
import { advancedEffect, effectPixels, validateEffects, type Effect } from "./effects.ts";
import { fromPanel, validateAssets, type ProSession } from "./model.ts";
import { documentAssetIds, analyzeAssetReachability } from "./asset-references.ts";
import { nativeFile, readNative, mergeNativeSession } from "./files.ts";
import { validateNativeImages } from "./native-images.ts";
import { validateR8Presets } from "./r8-presets.ts";
import { documentSources } from "./raster-budget.ts";
const effect = (): Effect => ({
  ...advancedEffect("patternOverlay"),
  version: 3,
  pattern: {
    kind: "bitmap",
    assetId: "tile",
    width: 2,
    height: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    color2: "#ffffff",
  },
});
function session(): ProSession {
  const document = fromPanel({ id: "pattern", name: "Pattern", width: 8, height: 4 });
  document.version = 3;
  document.layers[0]!.effects = [effect()];
  return {
    acceptedBlobId: "accepted",
    updatedAt: 0,
    revision: 0,
    document,
    assets: {
      source: new Blob(["source"], { type: "image/png" }),
      tile: new Blob(["tile"], { type: "image/png" }),
    },
  };
}
test("bitmap Pattern Overlay versions and bounded references reject unsafe metadata", () => {
  const e = effect();
  validateEffects([e]);
  assert.throws(
    () => validateR8Presets([{ version: 1, name: "Dangling", settings: { effects: [e] } }]),
    /document-owned/,
  );
  for (const patch of [{ version: 2 }, { version: 4 }, { kind: "colorOverlay" }])
    assert.throws(() => validateEffects([{ ...e, ...patch }] as Effect[]));
  for (const patch of [
    { width: 513 },
    { height: 0 },
    { assetId: "" },
    { assetId: "../source" },
    { width: NaN },
    { kind: "checker" },
  ])
    assert.throws(() =>
      validateEffects([{ ...e, pattern: { ...e.pattern!, ...patch } }] as Effect[]),
    );
  const s = session();
  delete s.assets.tile;
  assert.throws(() => validateAssets(s), /Pattern Overlay/);
  s.document.version = 2;
  assert.throws(() => validateAssets(s), /schema 3/);
});
test("bitmap pixels repeat, offset and premultiply alpha across bilinear seams", () => {
  const source = new Uint8ClampedArray(4 * 2 * 4).fill(255),
    e = effect();
  const textures = new Map([
    [
      "tile",
      { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) },
    ],
  ]);
  const result = effectPixels(source, 4, 2, [e], 1, 135, textures);
  assert.deepEqual(
    [...result.slice(0, 16)],
    [255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255],
  );
  e.pattern!.offsetX = 1;
  assert.deepEqual(
    [...effectPixels(source, 4, 2, [e], 1, 135, textures).slice(0, 4)],
    [0, 0, 255, 255],
  );
  e.pattern!.offsetX = 0;
  e.pattern!.scale = 2;
  textures.get("tile")!.data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]);
  const soft = effectPixels(source, 4, 2, [e], 1, 135, textures);
  assert.equal(soft[0], 255, "transparent green cannot tint red interpolation");
  assert.ok(soft[1]! > 0 && soft[1]! < 255, "source shows through the semitransparent repeat seam");
  assert.equal(soft[1], soft[2]);
  assert.throws(() => effectPixels(source, 4, 2, [e]), /source is missing/);
  source[3] = 0;
  assert.equal(effectPixels(source, 4, 2, [e], 1, 135, textures)[3], 0, "source alpha preserved");
});
test("native patterns preserve exact bytes, asset remapping and undo/recovery reachability", async () => {
  const s = session();
  validateAssets(s);
  assert.deepEqual([...documentAssetIds(s.document)].sort(), ["source", "tile"]);
  const native = await nativeFile(s),
    restored = await readNative(native, "restored", "accepted");
  assert.equal(restored.document.layers[0]!.effects![0]!.version, 3);
  assert.equal(await restored.assets.tile!.text(), "tile");
  const merged = mergeNativeSession(s, restored),
    id = merged.document.layers[0]!.effects![0]!.pattern!.assetId!;
  assert.notEqual(id, "tile");
  assert.equal(await merged.assets[id]!.text(), "tile");
  const current = structuredClone(s.document);
  current.layers[0]!.effects = [];
  const report = analyzeAssetReachability(
    { ...s, document: current },
    { undo: [s.document], checkpoints: [merged.document] },
  );
  assert.ok(report.referenced.includes("tile"));
  assert.ok(report.referenced.includes(id));
  assert.equal(report.deletionSafe, false);
});
test("mismatched bitmap dimensions are rejected before native image decoding", async () => {
  const s = session(),
    bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const v = new DataView(bytes.buffer);
  v.setUint32(16, 4096);
  v.setUint32(20, 4096);
  s.assets.tile = new Blob([bytes], { type: "image/png" });
  delete s.assets.source;
  s.document.layers[0]!.kind = "paint";
  delete s.document.layers[0]!.assetId;
  delete s.document.source;
  let calls = 0;
  await assert.rejects(
    validateNativeImages(s, 16_777_216, async () => {
      calls++;
      throw Error("must not decode");
    }),
    /pattern dimensions/,
  );
  assert.equal(calls, 0);
  const same = session();
  same.document.layers[0]!.effects![0]!.pattern!.assetId = "source";
  assert.throws(() => documentSources(same.document, 4_000_000), /dimensions conflict/);
});
