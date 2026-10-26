import { test } from "node:test";
import assert from "node:assert/strict";
import {
  factoryR8Presets,
  readR8Presets,
  validateR8Presets,
  validateR8Settings,
} from "./r8-presets.ts";
import { fromPanel, layer, validateDocument, type ProSession } from "./model.ts";
import { advancedGradient } from "./gradient.ts";
import { addGradientFill, r8Document, r8Settings, commitR8Document } from "./r8-document.ts";
import { processSmart, defaultSmartOperation, type SmartOperation } from "./smart-filters.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { encodeBackup, decodeBackup, type ProjectData } from "../backup.ts";
const doc = () => fromPanel({ id: "p", name: "R8 state", width: 128, height: 96 });
test("factory/custom layer presets validate and round-trip without sharing mutable arrays", () => {
  const presets = factoryR8Presets();
  validateR8Presets(presets);
  const restored = readR8Presets(JSON.stringify(presets));
  assert.deepEqual(restored, presets);
  restored[0]!.settings.effects![0]!.opacity = 0;
  assert.equal(presets[0]!.settings.effects![0]!.opacity, 0.35);
});
test("stored presets strictly reject corrupt JSON, duplicates, unsafe keys, unknown fields, ranges and budgets", () => {
  assert.throws(() => readR8Presets("{"));
  assert.throws(() => readR8Presets("x".repeat(1_000_001)));
  const p = factoryR8Presets()[0]!;
  assert.throws(() => validateR8Presets([p, p]));
  assert.throws(() => validateR8Presets(Array(21).fill(p)));
  assert.throws(() => validateR8Presets([{ ...p, name: "bad\nname" }]));
  assert.throws(() => readR8Presets('[{"version":1,"name":"Unsafe","settings":{"__proto__":{}}}]'));
  assert.throws(() => validateR8Settings({ light: Infinity }));
  assert.throws(() => validateR8Settings({ gradient: { ...advancedGradient(), smoothness: -1 } }));
  assert.throws(() => validateR8Settings({ unknown: true } as never));
});
test("filter order is noncommutative, deterministic and source-preserving", () => {
  const input = new Uint8ClampedArray(9 * 9 * 4);
  for (let i = 0; i < input.length; i += 4) input.set([128, 128, 128, 255], i);
  const snapshot = input.slice(),
    noise = defaultSmartOperation("grain"),
    blur = defaultSmartOperation("gaussian");
  const a = processSmart(processSmart(input, 9, 9, noise), 9, 9, blur),
    b = processSmart(processSmart(input, 9, 9, blur), 9, 9, noise);
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, processSmart(processSmart(input, 9, 9, noise), 9, 9, blur));
  assert.deepEqual(input, snapshot);
});
test("styles/filter/gradient commits preserve source object identity, change one history state, and reject stale targets", () => {
  const original = doc(),
    created = addGradientFill(
      original,
      advancedGradient(),
      { regions: [], inverted: false, feather: 0 },
      undefined,
      "g",
    ),
    draft = { origin: original, layerId: "g", created: created.document },
    settings = r8Settings(created.document.layers.at(-1)!);
  const next = commitR8Document(original, draft, settings, 16_777_216);
  assert.equal(next.layers[0], original.layers[0]);
  assert.equal(next.source, original.source);
  assert.equal(original.layers.length, 1);
  const history = record(createHistory(original), next);
  assert.equal(history.past.length, 1);
  assert.equal(undo(history).present, original);
  assert.equal(redo(undo(history)).present, next);
  assert.throws(() => commitR8Document({ ...original }, draft, settings, 16_777_216), /changed/);
});
test("R7 Quick Mask cannot become an effects/filter/gradient target through document APIs", () => {
  const d = doc(),
    mask = layer("paint", 128, 96, "quick");
  mask.name = "Quick Mask (temporary)";
  d.layers.push(mask);
  assert.throws(() => r8Document({ origin: d, layerId: mask.id }, {}, 16_777_216), /Quick Mask/);
  assert.throws(
    () => addGradientFill(d, advancedGradient(), { regions: [], inverted: false, feather: 0 }),
    /Quick Mask/,
  );
});
test("unsupported groups and extended vector sources reject Smart Filters without loss of editable geometry", () => {
  const d = doc(),
    group = layer("group", 128, 96, "group"),
    shape = layer("shape", 128, 96, "shape");
  shape.vectorOverflow = true;
  d.layers.push(group, shape);
  const operation = defaultSmartOperation("gaussian");
  for (const id of ["group", "shape"])
    assert.throws(
      () =>
        r8Document(
          { origin: d, layerId: id },
          { smartFilters: [{ id: "f", enabled: true, operation }] },
          16_777_216,
        ),
      /Smart Filters/,
    );
  assert.equal(shape.vectorOverflow, true);
  assert.equal(shape.smartFilters, undefined);
});
test("all filter families have strict finite parameters and preserve alpha on empty input", () => {
  for (const kind of [
    "gaussian",
    "motion",
    "radial",
    "unsharp",
    "highPass",
    "grain",
    "median",
    "surface",
    "emboss",
    "edgeDetect",
  ] as SmartOperation["kind"][]) {
    const a = defaultSmartOperation(kind),
      src = new Uint8ClampedArray(5 * 5 * 4),
      out = processSmart(src, 5, 5, a);
    for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 0);
  }
});
test("new format rejects field injection and advanced records on legacy schemas, including overlay gradient versions", () => {
  const d = doc(),
    g = addGradientFill(d, advancedGradient(), {
      regions: [],
      inverted: false,
      feather: 0,
    }).document;
  assert.throws(() => validateDocument({ ...g, version: 1 }));
  assert.throws(() => validateDocument({ ...g, version: 2 }));
  assert.throws(() => validateDocument({ ...g, malicious: true } as never));
  const e = factoryR8Presets()[0]!.settings.effects![0]!;
  e.gradient = advancedGradient();
  delete e.version;
  d.layers[0]!.effects = [e];
  assert.throws(() => validateDocument(d), /schema3|version2/);
});

test("Chapter backup recovery keeps schema3 filter/gradient/style metadata and original asset bytes", async () => {
  const original = doc(),
    gradient = addGradientFill(
      original,
      advancedGradient(),
      { regions: [], inverted: false, feather: 0 },
      undefined,
      "gradient",
    ).document,
    document = r8Document(
      { origin: gradient, layerId: "gradient" },
      {
        ...r8Settings(gradient.layers.at(-1)!),
        effects: factoryR8Presets()[0]!.settings.effects,
        smartFilters: [{ id: "noise", enabled: true, operation: defaultSmartOperation("grain") }],
      },
      16_777_216,
    ),
    source = new Blob(["original source"], { type: "image/png" }),
    session: ProSession = {
      document,
      assets: { source },
      revision: 0,
      acceptedBlobId: "b",
      updatedAt: 1,
    },
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
      sessions: [session],
    },
    restored = await decodeBackup(encodeBackup(data));
  assert.deepEqual(restored.sessions![0]!.document, JSON.parse(JSON.stringify(document)));
  assert.equal(await restored.sessions![0]!.assets.source!.text(), await source.text());
  assert.equal(restored.sessions![0]!.document.version, 3);
});
