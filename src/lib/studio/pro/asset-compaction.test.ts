import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateAssets, type ProSession } from "./model.ts";
import { compactOpenedSession, documentAssetIds } from "./asset-references.ts";
import { mergeNativeSession, nativeFile, readNative } from "./files.ts";
import { advancedEffect } from "./effects.ts";

const png = (bytes: number[] | Uint8Array<ArrayBuffer>) =>
  new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], { type: "image/png" });

function session(): ProSession {
  return {
    document: fromPanel({ id: "panel", name: "Page", width: 32, height: 24 }),
    assets: { source: png([1, 2, 3]) },
    revision: 7,
    acceptedBlobId: "media",
    updatedAt: 1,
  };
}

/** Every root kind the shared native-export traversal knows about. */
function rooted(): ProSession {
  const s = session(),
    paint = layer("paint", 32, 24),
    hidden = layer("raster", 32, 24),
    styled = layer("shape", 32, 24);
  for (const id of ["texture", "mask-texture", "hidden", "tile", "unused-a", "unused-b"])
    s.assets[id] = png(new TextEncoder().encode(id));
  hidden.assetId = "hidden";
  hidden.visible = false;
  const stroke = {
    points: [{ x: 4, y: 4 }],
    size: 5,
    hardness: 1,
    opacity: 1,
    flow: 1,
    color: "#000000",
    erase: false,
    clone: {
      assetId: "texture",
      width: 32,
      height: 24,
      source: { x: 0, y: 0 },
      destination: { x: 4, y: 4 },
      mode: "clone" as const,
    },
  };
  paint.strokes = [stroke];
  paint.mask = {
    enabled: true,
    selection: { regions: [], inverted: false, feather: 0 },
    strokes: [{ ...stroke, clone: { ...stroke.clone, assetId: "mask-texture" } }],
  };
  const pattern = {
    ...advancedEffect("patternOverlay"),
    version: 3 as const,
    pattern: {
      kind: "bitmap" as const,
      assetId: "tile",
      width: 2,
      height: 1,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      color2: "#ffffff",
    },
  };
  styled.effects = [pattern];
  s.document.version = 3;
  // The original source stays a root after its base layer is deleted.
  s.document.layers = [paint, hidden, styled];
  return s;
}

test("reproduction: unreferenced assets survive saves and make the 64-asset cap refuse new work", () => {
  const s = session();
  // 63 superseded Clone Stamp samples or native imports, none referenced any longer.
  for (let i = 0; i < 63; i++) s.assets[`superseded-${i}`] = png([i]);
  validateAssets(s);
  const next = { ...s, assets: { ...s.assets, merged: png([9]) } };
  assert.throws(() => validateAssets(next), /at most 64 raster assets/);
  const { session: opened, removed } = compactOpenedSession(s);
  assert.equal(removed.length, 63);
  assert.deepEqual(Object.keys(opened.assets), ["source"]);
  validateAssets({ ...opened, assets: { ...opened.assets, merged: png([9]) } });
});

test("reproduction: unreferenced bytes count toward the 48MB pool until the document is reopened", () => {
  const s = session();
  s.assets["old-composite"] = png(new Uint8Array(46_000_000));
  validateAssets(s);
  assert.throws(
    () => validateAssets({ ...s, assets: { ...s.assets, sample: png(new Uint8Array(3_000_000)) } }),
    /48MB/,
  );
  const { session: opened, bytes } = compactOpenedSession(s);
  assert.equal(bytes, 46_000_000);
  validateAssets({
    ...opened,
    assets: { ...opened.assets, sample: png(new Uint8Array(3_000_000)) },
  });
});

test("repeated native import no longer exhausts the asset cap after reopening", async () => {
  let s = session();
  for (let i = 0; i < 63; i++)
    s = mergeNativeSession(s, await readNative(await nativeFile(s), "panel", "media"));
  assert.equal(Object.keys(s.assets).length, 64, "in-session Undo keeps every imported source");
  const decoded = await readNative(await nativeFile(s), "panel", "media");
  assert.throws(() => mergeNativeSession(s, decoded), /at most 64 raster assets/);
  const { session: opened } = compactOpenedSession(s);
  assert.equal(Object.keys(opened.assets).length, 1);
  const merged = mergeNativeSession(opened, decoded);
  assert.deepEqual(
    [...new Uint8Array(await merged.assets[merged.document.source!.assetId]!.arrayBuffer())],
    [1, 2, 3],
  );
});

test("compaction keeps exactly the native-export roots, the same Blobs and byte-identical native files", async () => {
  const s = rooted(),
    before = structuredClone(Object.keys(s.assets)),
    { session: opened, removed, bytes } = compactOpenedSession(s);
  assert.deepEqual(removed, ["unused-a", "unused-b"]);
  assert.equal(bytes, "unused-a".length + "unused-b".length);
  assert.deepEqual(Object.keys(opened.assets).sort(), [...documentAssetIds(s.document)].sort());
  assert.deepEqual(Object.keys(opened.assets).sort(), [
    "hidden",
    "mask-texture",
    "source",
    "texture",
    "tile",
  ]);
  for (const id of Object.keys(opened.assets)) assert.equal(opened.assets[id], s.assets[id]);
  assert.equal(opened.document, s.document, "document is not rewritten");
  assert.deepEqual(Object.keys(s.assets), before, "the loaded session is not mutated");
  validateAssets(opened);
  assert.equal(await (await nativeFile(opened)).text(), await (await nativeFile(s)).text());
  const reopened = await readNative(await nativeFile(opened), "panel", "media");
  assert.deepEqual(Object.keys(reopened.assets).sort(), Object.keys(opened.assets).sort());
});

test("compaction is a no-op without orphans and never hides a missing reference", () => {
  const s = session();
  assert.equal(compactOpenedSession(s).session, s);
  const broken = session(),
    raster = layer("raster", 32, 24);
  raster.assetId = "gone";
  broken.document.layers.push(raster);
  broken.assets.extra = png([5]);
  const { session: opened } = compactOpenedSession(broken);
  assert.throws(() => validateAssets(opened), /raster source is missing/);
  assert.ok(broken.assets.extra, "a refused document keeps its stored pool");
});
