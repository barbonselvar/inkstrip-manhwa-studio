import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type ProSession } from "./model.ts";
import { advancedGradient } from "./gradient.ts";
import { addGradientFill, r8Document } from "./r8-document.ts";
import { nativeFile, readNative } from "./files.ts";
const document = () =>
  addGradientFill(
    fromPanel({ id: "p", name: "Trust", width: 32, height: 32 }),
    advancedGradient(),
    { regions: [], inverted: false, feather: 0 },
    undefined,
    "fill",
  ).document;
test("unknown future schema/envelope/filter/style and malformed gradient/mask records reject before any embedded image decode", async () => {
  const d = document(),
    session: ProSession = {
      document: d,
      assets: { source: new Blob(["immutable original"], { type: "image/png" }) },
      revision: 0,
      acceptedBlobId: "a",
      updatedAt: 1,
    },
    valid = JSON.parse(await (await nativeFile(session)).text()),
    originalAtob = globalThis.atob;
  let decodes = 0;
  globalThis.atob = (v: string) => {
    decodes++;
    return originalAtob(v);
  };
  try {
    const mutations = [
      (v: typeof valid) => {
        v.version = 10;
      },
      (v: typeof valid) => {
        v.document.version = 4;
      },
      (v: typeof valid) => {
        v.version = 8;
      },
      (v: typeof valid) => {
        v.document.layers[1].smartFilters = [
          { id: "unsafe", enabled: true, operation: { kind: "execute", script: "alert(1)" } },
        ];
      },
      (v: typeof valid) => {
        v.document.layers[1].gradient.stops = Array.from({ length: 129 }, (_, i) => ({
          position: i / 128,
          color: "#000000",
          opacity: 1,
        }));
      },
      (v: typeof valid) => {
        v.document.layers[1].gradient.stops[0].midpoint = 0;
      },
      (v: typeof valid) => {
        v.document.layers[1].smartFilters = [
          {
            id: "f",
            enabled: true,
            operation: { kind: "gaussian", radius: 1 },
            mask: {
              enabled: true,
              inverted: false,
              density: 1,
              selection: {
                regions: [
                  {
                    kind: "pixels",
                    operation: "add",
                    points: [
                      { x: 0, y: 0 },
                      { x: 1, y: 0 },
                      { x: 0, y: 1 },
                    ],
                    pixels: { width: 1e9, height: 1e9, runs: [0, 1, 255] },
                  },
                ],
                inverted: false,
                feather: 0,
              },
            },
          },
        ];
      },
      (v: typeof valid) => {
        v.document.layers[1].effects = [{ kind: "futureRelief", enabled: true }];
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      await assert.rejects(() => readNative(new Blob([JSON.stringify(value)]), "p", "accepted"));
      assert.equal(decodes, 0, "unsafe metadata must fail before atob/asset allocation");
    }
    assert.equal(session.document.layers[1]!.gradient!.stops.length, 2);
    assert.equal(await session.assets.source!.text(), "immutable original");
  } finally {
    globalThis.atob = originalAtob;
  }
});
test("prototype keys and truncated/corrupt native data reject without executing serialized text", async () => {
  for (const text of [
    "{",
    "null",
    '{"format":"inkstrip-pro","version":9,"document":{"__proto__":{}},"assets":{}}',
    '{"format":"inkstrip-pro","version":9,"document":{"constructor":{"prototype":{}}},"assets":{}}',
  ])
    await assert.rejects(() => readNative(new Blob([text]), "p", "accepted"));
});
test("gradient presets reject non-gradient targets rather than silently applying an ineffectual setting", () => {
  const d = fromPanel({ id: "p", name: "Kind", width: 32, height: 32 });
  assert.throws(
    () =>
      r8Document(
        { origin: d, layerId: d.layers[0]!.id },
        { gradient: advancedGradient() },
        16_777_216,
      ),
    /Gradient Fill/,
  );
});

test("visible filter stacks share a document work budget and hidden originals do not consume render work", () => {
  const d = {
      ...fromPanel({ id: "work", name: "Work", width: 512, height: 512 }),
      version: 3 as const,
    },
    a = layer("paint", 512, 512, "a"),
    b = layer("paint", 512, 512, "b");
  a.smartFilters = [{ id: "a", enabled: true, operation: { kind: "gaussian", radius: 32 } }];
  b.smartFilters = structuredClone(a.smartFilters);
  d.layers.push(a, b);
  const snapshot = structuredClone(d);
  assert.throws(() => validateDocument(d), /document kernel-work/);
  assert.deepEqual(d, snapshot);
  b.visible = false;
  validateDocument(d);
});
