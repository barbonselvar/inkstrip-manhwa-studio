import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, type ProDocument } from "./model.ts";
import { pathfinder } from "./pathfinder.ts";
import { createCompound } from "./compound.ts";
import { defaultSmartOperation } from "./smart-filters.ts";

function fixture(filteredIndex: number, enabled: boolean): ProDocument {
  const shapes = [layer("shape", 20, 20), layer("shape", 20, 20)];
  shapes.forEach((shape, i) => {
    shape.transform.x = i * 10;
    shape.strokeWidth = 0;
  });
  shapes[filteredIndex]!.smartFilters = [
    { id: "editable-noise", enabled, operation: defaultSmartOperation("grain") },
  ];
  return {
    ...fromPanel({ id: "geometry", name: "Filtered geometry", width: 64, height: 64 }),
    version: 3,
    source: undefined,
    layers: shapes,
  };
}

for (const operation of ["Pathfinder", "Compound"] as const)
  test(`${operation} cannot discard or rebase Smart Filters from either operand`, () => {
    for (const enabled of [true, false])
      for (const filteredIndex of [0, 1]) {
        const doc = fixture(filteredIndex, enabled),
          before = structuredClone(doc),
          ids = doc.layers.map((l) => l.id);
        assert.throws(
          () =>
            operation === "Pathfinder" ? pathfinder(doc, ids, "unite") : createCompound(doc, ids),
          /Remove Smart Filters/,
          `${operation}: operand ${filteredIndex}, enabled=${enabled}`,
        );
        assert.deepEqual(doc, before, "all source geometry and editable settings remain exact");
      }
  });
