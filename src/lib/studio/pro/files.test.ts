import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateAssets, type ProSession } from "./model.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
import { tonePixels } from "./pixels.ts";
test("native export retains current/hidden/original/clone/mask assets without copying unused history", async () => {
  const s = session(),
    paint = layer("paint", 32, 24),
    hidden = layer("raster", 32, 24);
  for (const id of ["texture", "mask-texture", "hidden", "unused-history"])
    s.assets[id] = new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" });
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
  s.document.layers = [paint, hidden]; // Original source survives deletion of its base layer.
  const restored = await readNative(await nativeFile(s), "panel", "media");
  assert.deepEqual(Object.keys(restored.assets).sort(), [
    "hidden",
    "mask-texture",
    "source",
    "texture",
  ]);
  assert.ok(s.assets["unused-history"], "Export must not evict the session's Undo assets");
  validateAssets(restored);
});
test("25 native import/export cycles retain original bytes without exponential file growth", async () => {
  const { mergeNativeSession } = await import("./files.ts");
  let s = session();
  const initialSize = (await nativeFile(s)).size;
  for (let i = 0; i < 25; i++) {
    const file = await nativeFile(s),
      decoded = await readNative(file, "panel", "media");
    assert.equal(Object.keys(decoded.assets).length, 1);
    assert.ok(file.size < initialSize + 128);
    s = mergeNativeSession(s, decoded);
    assert.deepEqual(
      [...new Uint8Array(await s.assets[s.document.source!.assetId]!.arrayBuffer())],
      [1, 2, 3],
    );
  }
  assert.equal(
    Object.keys(s.assets).length,
    26,
    "All old immutable IDs remain available for session Undo",
  );
});
test("new vector features use a v2 envelope that older v1 readers reject; legacy documents stay v1", async () => {
  const s = session();
  assert.equal(JSON.parse(await (await nativeFile(s)).text()).version, 1);
  const p = layer("shape", 32, 24);
  p.shape = "path";
  p.anchors = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
  ];
  p.subpaths = [
    {
      anchors: [
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        { x: 10, y: 10 },
      ],
      closed: true,
    },
  ];
  p.fillRule = "evenodd";
  s.document.layers.push(p);
  const file = await nativeFile(s),
    envelope = JSON.parse(await file.text());
  assert.equal(envelope.version, 2);
  assert.equal(envelope.document.version, 1);
  assert.equal(
    envelope.version === 1,
    false,
    "The production v1-only reader must refuse feature-bearing files",
  );
  const restored = await readNative(file, "panel", "media");
  assert.deepEqual(restored.document.layers[1]!.subpaths, p.subpaths);
  s.document.layers.pop();
  const legacy = await readNative(await nativeFile(s), "panel", "media");
  assert.deepEqual(legacy.document, s.document);
});
const session = (): ProSession => ({
  document: fromPanel({ id: "panel", name: "test", width: 32, height: 24 }),
  assets: { source: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
  revision: 1,
  acceptedBlobId: "media",
  updatedAt: 0,
});
test("native format roundtrip keeps editable text, immutable source bytes and target identity", async () => {
  const s = session(),
    t = layer("text", 32, 24);
  t.text = "<Ink & Light>\nSecond line";
  s.document.layers.push(t);
  const reopened = await readNative(await nativeFile(s), "new-panel", "accepted");
  validateAssets(reopened);
  assert.equal(reopened.document.panelId, "new-panel");
  assert.equal(reopened.document.layers[1]!.text, t.text);
  assert.deepEqual(
    new Uint8Array(await reopened.assets.source!.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});
test("Clone Stamp and Healing Brush snapshots survive native roundtrip and asset remapping", async () => {
  const incoming = session(),
    paint = layer("paint", 32, 24, "clone-layer");
  incoming.assets["clone-snapshot"] = new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" });
  paint.strokes.push({
    points: [
      { x: 9, y: 8 },
      { x: 10, y: 8 },
    ],
    size: 5,
    hardness: 1,
    opacity: 0.75,
    flow: 1,
    color: "#000000",
    erase: false,
    clone: {
      assetId: "clone-snapshot",
      width: 32,
      height: 24,
      source: { x: 2, y: 3 },
      destination: { x: 9, y: 8 },
      mode: "heal",
    },
  });
  incoming.document.layers.push(paint);
  const reopened = await readNative(await nativeFile(incoming), "panel-2", "media-2");
  assert.equal(reopened.document.layers.at(-1)!.strokes[0]!.clone?.assetId, "clone-snapshot");
  assert.equal(reopened.document.layers.at(-1)!.strokes[0]!.clone?.mode, "heal");
  validateAssets(reopened);
  const { mergeNativeSession } = await import("./files.ts"),
    merged = mergeNativeSession(session(), reopened),
    remapped = merged.document.layers.at(-1)!.strokes[0]!.clone!.assetId;
  assert.notEqual(remapped, "clone-snapshot");
  assert.equal(merged.assets[remapped]!.type, "image/png");
  validateAssets(merged);
});
test("native import refuses wrong versions, executable assets and missing sources", async () => {
  await assert.rejects(() =>
    readNative(new Blob(['{"format":"inkstrip-pro","version":9}']), "p", "m"),
  );
  await assert.rejects(() =>
    readNative(
      new Blob([
        JSON.stringify({
          format: "inkstrip-pro",
          version: 1,
          document: session().document,
          assets: { source: { mime: "image/svg+xml", data: btoa("<script/>") } },
        }),
      ]),
      "p",
      "m",
    ),
  );
});
test("SVG is explicitly vector-only, escapes text and rejects unsupported effects", () => {
  const s = session(),
    t = layer("text", 32, 24);
  t.text = '<script> & "art"';
  t.strokeWidth = 0;
  s.document.layers.push(t);
  const svg = vectorSvg(s.document);
  assert.ok(svg.includes("&lt;script&gt; &amp; &quot;art&quot;"));
  assert.ok(!svg.includes("<image"));
  t.mask = { selection: { regions: [], inverted: true, feather: 0 }, strokes: [], enabled: true };
  assert.throws(() => vectorSvg(s.document), /does not support/);
});
test("levels/gamma and hue change RGB while preserving alpha and transparent pixels", () => {
  const data = new Uint8ClampedArray([64, 64, 64, 128, 3, 4, 5, 0]),
    l = layer("raster", 1, 2);
  l.gamma = 2;
  const result = tonePixels(data, l);
  assert.ok(result[0]! > 100);
  assert.equal(result[3], 128);
  assert.deepEqual([...result.slice(4)], [3, 4, 5, 0]);
});
test("imported IDs are remapped without overwriting undo sources or raw comparison references", async () => {
  const current = session(),
    incoming = session();
  incoming.assets.source = new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" });
  const { mergeNativeSession } = await import("./files.ts"),
    { sourceReference } = await import("./model.ts");
  const combined = mergeNativeSession(current, incoming),
    id = combined.document.layers[0]!.assetId!;
  assert.notEqual(id, "source");
  assert.deepEqual([...new Uint8Array(await combined.assets.source!.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual([...new Uint8Array(await combined.assets[id]!.arrayBuffer())], [9, 8, 7]);
  assert.equal(sourceReference(combined.document)!.assetId, id);
  assert.equal(current.document.layers[0]!.assetId, "source");
  validateAssets(combined);
});
