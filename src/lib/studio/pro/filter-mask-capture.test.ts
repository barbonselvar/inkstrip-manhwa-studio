import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, EMPTY_SELECTION, type Selection } from "./model.ts";
import { captureFilterMask } from "./filter-mask-capture.ts";
test("no selection captures full source coverage outside current canvas bounds", () => {
  const doc = fromPanel({ id: "scope", name: "scope", width: 128, height: 96 }),
    layer = doc.layers[0]!;
  layer.transform.x = 12;
  for (const selection of [undefined, EMPTY_SELECTION, { ...EMPTY_SELECTION, feather: 12 }]) {
    const mask = captureFilterMask(selection, layer, doc);
    assert.deepEqual(mask, {
      selection: { regions: [], inverted: true, feather: 0 },
      enabled: true,
      inverted: false,
      density: 1,
    });
    layer.transform.x = -30;
    assert.equal(
      Object.hasOwn(mask.selection, "frame"),
      false,
      "later source motion cannot reveal a baked document clip",
    );
  }
});
test("explicit selections preserve document framing, inversion and R5 transform", () => {
  const doc = fromPanel({ id: "scope", name: "scope", width: 128, height: 96 }),
    layer = doc.layers[0]!;
  layer.transform.x = 12;
  const selection: Selection = {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 10, y: 12 },
            { x: 70, y: 80 },
          ],
        },
      ],
      inverted: true,
      feather: 3,
    },
    before = structuredClone(selection),
    mask = captureFilterMask(selection, layer, doc);
  assert.deepEqual(mask.selection, {
    ...selection,
    frame: { width: 128, height: 96, transform: { ...layer.transform } },
  });
  assert.deepEqual(selection, before);
  assert.deepEqual(Object.keys(mask.selection.frame!).sort(), ["height", "transform", "width"]);
});
