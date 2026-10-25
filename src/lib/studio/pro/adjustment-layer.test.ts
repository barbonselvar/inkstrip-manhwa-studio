import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type ProDocument, type ProSession } from "./model.ts";
import {
  createAdjustmentDraft,
  adjustmentDocument,
  commitAdjustmentDocument,
  upgradeAdjustmentDocument,
} from "./adjustment-layer.ts";
import {
  ADJUSTMENT_KINDS,
  validateAdjustmentLayer,
  validateNativeTree,
  canonicalNative,
  type AdjustmentLayerSettings,
} from "./adjustment-schema.ts";
import { defaultOperation, processColor, type ColorOperation } from "./color-engine.ts";
import { applyAdjustmentTiles, histogramTiles } from "./adjustment-tiles.ts";
import { blendClippedPixels } from "./clipping.ts";
import { nativeFile, readNative, mergeNativeSession, vectorSvg } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { documentSources } from "./raster-budget.ts";
import { duplicateLayers } from "./layers.ts";
import { removeLayer } from "./model.ts";
import { encodeBackup, decodeBackup, type ProjectData } from "../backup.ts";
const doc = () => fromPanel({ id: "p", name: "Persistent", width: 128, height: 96 });
const source = new Blob(["immutable source artwork"], { type: "image/png" });
const session = (document = doc()): ProSession => ({
  document,
  assets: { source },
  revision: 0,
  acceptedBlobId: "accepted",
  updatedAt: 1,
});
const settings = (operation: ColorOperation = { kind: "invert" }): AdjustmentLayerSettings => ({
  version: 1,
  operation: operation as AdjustmentLayerSettings["operation"],
});
const add = (d = doc(), id = "a", a = settings()) =>
  adjustmentDocument(createAdjustmentDraft(d, d.layers.at(-1)?.id, id), a, 16_777_216);
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test("schema migration is immutable, lossless and opt-in; legacy source/layer identities survive", () => {
  const d = doc(),
    snapshot = structuredClone(d),
    next = upgradeAdjustmentDocument(d);
  assert.equal(d.version, 1);
  assert.equal(next.version, 2);
  assert.equal(next.layers, d.layers);
  assert.equal(next.source, d.source);
  assert.deepEqual(d, snapshot);
  assert.equal(upgradeAdjustmentDocument(next), next);
});
test("creating a real adjustment adds metadata only with stable IDs, no raster snapshot or original duplication", () => {
  const d = doc(),
    next = add(d);
  assert.equal(next.version, 2);
  assert.equal(next.layers.length, 2);
  assert.equal(next.layers[0], d.layers[0]);
  assert.equal(next.layers[1]!.id, "a");
  assert.equal(next.layers[1]!.kind, "adjustment");
  assert.equal(next.layers[1]!.assetId, undefined);
  assert.deepEqual(next.layers[1]!.strokes, []);
  assert.equal(next.layers[0]!.visible, true);
  assert.deepEqual(next.source, d.source);
  assert.equal(d.layers.length, 1);
});
test("new adjustment inserts above the complete selected clipping stack, below unrelated upper artwork", () => {
  const d = doc(),
    clip = layer("shape", 128, 96, "clip"),
    top = layer("paint", 128, 96, "upper");
  clip.clipped = true;
  d.layers.push(clip, top);
  const out = adjustmentDocument(
    createAdjustmentDraft(d, d.layers[0]!.id, "a"),
    settings(),
    16_777_216,
  );
  assert.deepEqual(
    out.layers.map((l) => l.id),
    [d.layers[0]!.id, "clip", "a", "upper"],
  );
});
test("selecting a group creates a group-local adjustment and locked destination rejects without mutation", () => {
  const d = doc(),
    g = layer("group", 128, 96, "g");
  d.layers.push(g);
  const next = adjustmentDocument(createAdjustmentDraft(d, g.id, "a"), settings(), 16_777_216);
  assert.equal(next.layers.at(-1)!.parentId, "g");
  g.locked = true;
  assert.throws(() => createAdjustmentDraft(d, g.id), /Unlock/);
  assert.equal(d.layers.length, 2);
});
test("all eleven supported color operation families round-trip editable parameters and original bytes in schema2/envelope8", async () => {
  for (const kind of ADJUSTMENT_KINDS) {
    const operation = defaultOperation(kind),
      record = settings(operation);
    record.preset = { name: "Saved preset" };
    const s = session(add(doc(), "a", record)),
      blob = await nativeFile(s),
      wire = JSON.parse(await blob.text()),
      reopened = await readNative(blob, "p", "accepted");
    assert.equal(wire.version, 8);
    assert.equal(wire.document.version, 2);
    assert.deepEqual(reopened.document, plain(s.document));
    assert.deepEqual(reopened.document.layers[1]!.adjustmentLayer, record);
    assert.equal(await reopened.assets.source!.text(), await source.text());
    assert.equal(Object.keys(reopened.assets).length, 1);
  }
});
test("legacy portable versions1–5 and7 migrate without layer loss and retain their actual features", async () => {
  for (const version of [1, 2, 3, 4, 5, 7]) {
    const d = doc();
    if (version === 2) {
      const p = layer("shape", 30, 20, "shape");
      p.lineCap = "round";
      d.layers.push(p);
    }
    if (version === 3)
      d.artboards = [
        {
          id: "board",
          name: "Board",
          x: 0,
          y: 0,
          width: 128,
          height: 96,
          background: "transparent",
        },
      ];
    if (version === 4) {
      const p = layer("shape", 20, 20, "shape");
      p.vectorClips = [];
      d.layers.push(p);
    }
    if (version === 5)
      d.brushSettings = {
        size: 12,
        hardness: 0.8,
        opacity: 1,
        flow: 1,
        color: "#ff0000",
        sizePressure: true,
        smoothing: 0,
      };
    if (version === 7) d.dialogue = { version: 1, regions: [], presets: [] };
    const file = await nativeFile(session(d)),
      wire = JSON.parse(await file.text());
    assert.equal(wire.version, version);
    const old = await readNative(file, "p", "accepted");
    assert.deepEqual(old.document, plain(d));
    const upgraded = add(old.document);
    assert.deepEqual(upgraded.layers.slice(0, -1), old.document.layers);
    const fresh = await readNative(
      await nativeFile({ ...old, document: upgraded }),
      "p",
      "accepted",
    );
    assert.equal(fresh.document.version, 2);
    assert.deepEqual(fresh.document.layers.slice(0, -1), old.document.layers);
    assert.equal(await fresh.assets.source!.text(), await source.text());
  }
});
test("canonical native8 encoding is deterministic across property and asset insertion order", async () => {
  const s = session(add()),
    a = await (await nativeFile(s)).text(),
    layerCopy = Object.fromEntries(Object.entries(s.document.layers[1]!).reverse()),
    docCopy = Object.fromEntries(
      Object.entries({ ...s.document, layers: [s.document.layers[0], layerCopy] }).reverse(),
    ) as ProDocument;
  assert.equal(await (await nativeFile({ ...s, document: docCopy })).text(), a);
  assert.equal(
    canonicalNative({ b: 1, a: { z: 2, y: 3 } }),
    canonicalNative({ a: { y: 3, z: 2 }, b: 1 }),
  );
});
test("legacy readers reject the new portable and internal versions instead of silently dropping settings", async () => {
  const wire = JSON.parse(await (await nativeFile(session(add()))).text());
  assert.equal([1, 2, 3, 4, 5, 7].includes(wire.version), false);
  assert.notEqual(wire.document.version, 1);
  const removed = removeLayer(add(), "a");
  assert.equal(removed.version, 2);
  assert.equal(JSON.parse(await (await nativeFile(session(removed))).text()).version, 8);
});
test("settings reject future versions, unsupported filters, unknown keys, malformed curves and invalid numeric ranges", () => {
  const curves = defaultOperation("curves") as Extract<ColorOperation, { kind: "curves" }>;
  curves.channels.red = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 255, y: 255 },
  ];
  for (const a of [
    { version: 2, operation: { kind: "invert" } },
    { version: 1, operation: { kind: "future" } },
    { version: 1, operation: { kind: "gaussian", radius: 1 } },
    { ...settings(), future: true },
    settings({ kind: "exposure", stops: NaN, gamma: 1 }),
    settings(curves),
    { ...settings(), preset: { name: "x", execute: "code" } },
    { ...settings(), preset: { name: " " } },
  ])
    assert.throws(() => validateAdjustmentLayer(a));
});
test("schema2 strictly rejects unsupported layer/document/mask fields, legacy mixing and invalid record placement", () => {
  const valid = add();
  for (const mutate of [
    (d: ProDocument) => {
      d.version = 1;
    },
    (d: ProDocument) => {
      d.layers[1]!.kind = "paint";
    },
    (d: ProDocument) => {
      d.layers[1]!.adjustments.brightness = 2;
    },
    (d: ProDocument) => {
      d.layers[1]!.strokes = [];
      d.layers[1]!.assetId = "source";
    },
    (d: ProDocument) => {
      Object.assign(d, { future: true });
    },
    (d: ProDocument) => {
      Object.assign(d.layers[0]!, { future: true });
    },
  ]) {
    const d = structuredClone(valid);
    mutate(d);
    assert.throws(() => validateDocument(d));
  }
});
test("unknown future native versions, mismatched envelope/schema and malicious JSON are rejected", async () => {
  const wire = JSON.parse(await (await nativeFile(session(add()))).text());
  for (const mutate of [
    (v: typeof wire) => {
      v.version = 9;
    },
    (v: typeof wire) => {
      v.version = 1;
    },
    (v: typeof wire) => {
      v.document.version = 99;
    },
    (v: typeof wire) => {
      v.document.layers[1].adjustmentLayer.operation.kind = "future";
    },
    (v: typeof wire) => {
      v.assets.source.data = "=bad";
    },
    (v: typeof wire) => {
      v.extra = true;
    },
  ]) {
    const v = structuredClone(wire);
    mutate(v);
    await assert.rejects(readNative(new Blob([JSON.stringify(v)]), "p", "a"));
  }
  const poison = JSON.stringify(wire).replace(
    '"format":"inkstrip-pro"',
    '"__proto__":{"polluted":true},"format":"inkstrip-pro"',
  );
  await assert.rejects(readNative(new Blob([poison]), "p", "a"), /Unsafe/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  await assert.rejects(readNative(new Blob(["{broken"]), "p", "a"));
});
test("untrusted native8 rejects dangling assets, duplicate identities, oversized masks and excessive layers/assets atomically", async () => {
  const wire = JSON.parse(await (await nativeFile(session(add()))).text()),
    snapshot = structuredClone(wire);
  for (const mutate of [
    (v: typeof wire) => {
      delete v.assets.source;
    },
    (v: typeof wire) => {
      v.document.layers[1].id = v.document.layers[0].id;
    },
    (v: typeof wire) => {
      v.document.layers[1].mask = {
        enabled: true,
        inverted: false,
        strokes: [],
        width: 16384,
        height: 16384,
      };
    },
    (v: typeof wire) => {
      v.document.layers = Array.from({ length: 49 }, (_, i) => ({
        ...v.document.layers[1],
        id: `layer-${i}`,
      }));
    },
    (v: typeof wire) => {
      v.assets = Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [i ? `asset-${i}` : "source", v.assets.source]),
      );
    },
  ]) {
    const unsafe = structuredClone(wire);
    mutate(unsafe);
    await assert.rejects(readNative(new Blob([JSON.stringify(unsafe)]), "p", "a"));
    assert.deepEqual(wire, snapshot);
  }
});
test("schema migration retains legacy adjustment settings alongside advanced layers without resetting or flattening them", async () => {
  const d = doc(),
    legacy = layer("adjustment", 128, 96, "legacy");
  legacy.adjustments.brightness = 12;
  legacy.hue = 20;
  legacy.color = { vibrance: 14 };
  d.layers.push(legacy);
  const next = add(d),
    reopened = await readNative(await nativeFile(session(next)), "p", "a");
  assert.deepEqual(reopened.document.layers[1], plain(legacy));
  assert.equal(reopened.document.layers[2]!.adjustmentLayer!.operation.kind, "invert");
  assert.equal(await reopened.assets.source!.text(), await source.text());
});
test("structural depth and malformed metadata are bounded before recursive allocation", () => {
  let deep: unknown = {};
  for (let i = 0; i < 60; i++) deep = [deep];
  assert.throws(() => validateNativeTree(deep), /structural/);
  assert.throws(() => validateNativeTree(JSON.parse('{"constructor":{}}')), /Unsafe/);
});
test("Apply edits one layer and existing masks, opacity, blend, geometry and siblings remain exact", () => {
  const d = add(),
    target = d.layers[1]!;
  target.opacity = 0.4;
  target.blend = "screen";
  target.mask = {
    enabled: true,
    selection: { regions: [], inverted: true, feather: 0 },
    strokes: [],
    density: 0.5,
  };
  target.transform.x = 3;
  const draft = { origin: d, layerId: "a" },
    next = commitAdjustmentDocument(
      d,
      draft,
      settings({ kind: "threshold", level: 100 }),
      16_777_216,
    );
  assert.equal(next.layers[0], d.layers[0]);
  for (const k of ["mask", "opacity", "blend", "transform"] as const)
    assert.deepEqual(next.layers[1]![k], target[k]);
  assert.equal(d.layers[1]!.adjustmentLayer!.operation.kind, "invert");
});
test("unchanged Apply is a no-op; stale revisions, deletion and locks reject, without mutating source", () => {
  const d = add(),
    draft = { origin: d, layerId: "a" };
  assert.equal(adjustmentDocument(draft, settings(), 16_777_216), d);
  assert.throws(
    () => commitAdjustmentDocument({ ...d }, draft, settings(), 16_777_216),
    /document changed/,
  );
  const locked = structuredClone(d);
  locked.layers[1]!.locked = true;
  assert.throws(
    () => adjustmentDocument({ origin: locked, layerId: "a" }, settings(), 16_777_216),
    /unlocked/,
  );
  assert.throws(() =>
    adjustmentDocument({ origin: removeLayer(d, "a"), layerId: "a" }, settings(), 16_777_216),
  );
});
test("create/edit/duplicate/delete use the existing exact Undo/Redo timeline and preserve schema migration", () => {
  const d = doc(),
    a = add(d),
    b = adjustmentDocument(
      { origin: a, layerId: "a" },
      settings({ kind: "posterize", levels: 3 }),
      16_777_216,
    ),
    duplicate = duplicateLayers(b, ["a"]),
    removed = removeLayer(duplicate.document, duplicate.ids[0]!);
  let h = createHistory(d);
  for (const n of [a, b, duplicate.document, removed]) h = record(h, n);
  for (const expected of [duplicate.document, b, a, d]) {
    h = undo(h);
    assert.equal(h.present, expected);
  }
  for (const expected of [a, b, duplicate.document, removed]) {
    h = redo(h);
    assert.equal(h.present, expected);
  }
  assert.deepEqual(duplicate.document.layers.at(-1)!.adjustmentLayer, b.layers[1]!.adjustmentLayer);
  assert.notEqual(duplicate.ids[0], "a");
});
test("native import retains editable settings while rekeying only immutable raster assets", async () => {
  const incoming = session(add()),
    current = session(),
    result = mergeNativeSession(current, await readNative(await nativeFile(incoming), "p", "a"));
  assert.deepEqual(
    result.document.layers[1]!.adjustmentLayer,
    incoming.document.layers[1]!.adjustmentLayer,
  );
  assert.equal(result.document.layers[1]!.id, "a");
  assert.notEqual(result.document.layers[0]!.assetId, "source");
  assert.equal(await result.assets[result.document.source!.assetId]!.text(), await source.text());
  assert.throws(() => vectorSvg(result.document), /adjustment layers/);
});
test("Chapter project backup round-trips schema2 sessions without flattening or losing source bytes", async () => {
  const s = session(add()),
    data: ProjectData = {
      project: { id: "project", title: "P", createdAt: 1, updatedAt: 1 },
      chapters: [
        {
          id: "chapter",
          projectId: "project",
          title: "C",
          strip: null,
          createdAt: 1,
          updatedAt: 1,
          width: 128,
          seam: 0,
          format: "image/png",
        },
      ],
      panels: [
        {
          id: "p",
          name: "Page",
          chapterId: "chapter",
          blobId: "b",
          thumbId: "t",
          mime: "image/png",
          width: 128,
          height: 96,
          order: 0,
          createdAt: 1,
        },
      ],
      blobs: new Map([
        ["b", source],
        ["t", source],
      ]),
      sessions: [s],
    };
  const back = await decodeBackup(encodeBackup(data));
  assert.deepEqual(back.sessions![0]!.document, plain(s.document));
  assert.equal(await back.sessions![0]!.assets.source!.text(), await source.text());
  assert.equal(back.sessions![0]!.document.layers.length, 2);
});
test("large document and cumulative adjustment work budgets remain enforced", () => {
  const d = doc();
  d.width = d.height = 4096;
  d.layers[0]!.width = d.layers[0]!.height = 4096;
  const big = add(d);
  documentSources(big, 16_777_216);
  assert.throws(() => documentSources(big, 4_000_000), /budget/);
  let many = big;
  for (let i = 1; i < 7; i++) many = add(many, `a${i}`);
  assert.throws(() => add(many, "tooMany"), /processing budget/);
  const malformed = structuredClone(big);
  malformed.layers[1]!.width = 20000;
  assert.throws(() => validateDocument(malformed));
});

class Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  reads: number[] = [];
  constructor(w: number, h: number, data: Uint8ClampedArray) {
    this.width = w;
    this.height = h;
    this.data = data.slice();
  }
  getImageData(x: number, y: number, w: number, h: number) {
    this.reads.push(w * h);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++)
      data.set(
        this.data.subarray(((y + row) * this.width + x) * 4, ((y + row) * this.width + x + w) * 4),
        row * w * 4,
      );
    return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
  }
  putImageData(image: ImageData, x: number, y: number) {
    for (let row = 0; row < image.height; row++)
      this.data.set(
        image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4),
        ((y + row) * this.width + x) * 4,
      );
  }
}
test("tiled color output is pixel exact across seams, all families and fractional coverage/blend", async () => {
  const w = 519,
    h = 515,
    input = new Uint8ClampedArray(w * h * 4),
    mask = input.slice();
  for (let p = 0; p < input.length; p += 4) {
    input.set([p % 256, (p / 4) % 256, 80, p % 20 ? 128 : 255], p);
    mask[p + 3] = (p / 16) % 256;
  }
  for (const kind of ADJUSTMENT_KINDS) {
    const a = defaultOperation(kind);
    if (!ADJUSTMENT_KINDS.includes(a.kind as typeof kind)) throw Error();
    const target = new Pixels(w, h, input),
      coverage = new Pixels(w, h, mask),
      filtered = processColor(input, w, h, a);
    for (let p = 0; p < filtered.length; p += 4) filtered[p + 3] = input[p + 3] ? mask[p + 3]! : 0;
    const expected = blendClippedPixels(input, filtered, 0.37, "multiply");
    await applyAdjustmentTiles(
      target,
      coverage,
      w,
      h,
      a as AdjustmentLayerSettings["operation"],
      0.37,
      "multiply",
      async () => {},
    );
    assert.deepEqual(target.data, expected, kind);
    assert.ok(Math.max(...target.reads) <= 512 * 512);
  }
});
test("mask density and adjustment opacity interpolate RGB while retaining backdrop alpha", async () => {
  const target = new Pixels(1, 1, new Uint8ClampedArray([128, 64, 32, 128])),
    coverage = new Pixels(1, 1, new Uint8ClampedArray([255, 255, 255, 128]));
  await applyAdjustmentTiles(
    target,
    coverage,
    1,
    1,
    { kind: "invert" },
    0.5,
    "source-over",
    async () => {},
  );
  assert.deepEqual([...target.data], [128, 96, 80, 128]);
});
test("tile cancellation stops before writing a stale region", async () => {
  const input = new Uint8ClampedArray(1024 * 2 * 4).fill(255),
    target = new Pixels(1024, 2, input),
    coverage = new Pixels(1024, 2, input);
  let n = 0;
  await assert.rejects(
    applyAdjustmentTiles(
      target,
      coverage,
      1024,
      2,
      { kind: "invert" },
      1,
      "source-over",
      async () => {
        if (++n === 2) throw new DOMException("Cancelled", "AbortError");
      },
    ),
    /Cancelled/,
  );
  assert.equal(target.data[0], 0);
  assert.equal(target.data[512 * 4], 255);
});
test("native source histogram accumulates real alpha-weighted bins across bounded tiles", async () => {
  const input = new Uint8ClampedArray(1025 * 4);
  for (let p = 0; p < input.length; p += 4) input.set([80, 120, 180, p % 12 ? 128 : 0], p);
  const plane = new Pixels(1025, 1, input),
    bins = await histogramTiles(plane, 1025, 1, async () => {}),
    count = Array.from({ length: 1025 }, (_, i) => ((i * 4) % 12 ? 128 / 255 : 0)).reduce(
      (a, b) => a + b,
      0,
    );
  assert.ok(Math.abs(bins.red[80]! - count) < 1e-8);
  assert.equal(bins.red[0], 0);
  assert.ok(Math.max(...plane.reads) <= 512 * 512);
});
