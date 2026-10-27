import { test } from "node:test";
import assert from "node:assert/strict";
import { contextualInspector, inspectorKeyIndex } from "./inspector.ts";
test("context settings navigate existing available panels without changing a tool", () => {
  assert.deepEqual(contextualInspector("brush", "raster"), {
    panel: "properties",
    section: "pro-brush-settings",
  });
  assert.deepEqual(contextualInspector("text", "raster"), {
    panel: "properties",
    section: "pro-text-settings",
  });
  assert.equal(contextualInspector("crop", "raster").panel, "geometry");
  assert.equal(contextualInspector("transform", "raster").panel, "transform");
  assert.equal(contextualInspector("pen", "raster").panel, "paths");
  assert.equal(contextualInspector("pen", "vector").panel, "properties");
  assert.equal(contextualInspector("artboard", "raster").panel, "properties");
  assert.equal(contextualInspector("pen", "raster", true).panel, "properties");
});
test("inspector keyboard navigation wraps and handles missing buttons safely", () => {
  assert.equal(inspectorKeyIndex("ArrowLeft", 0, 13), 12);
  assert.equal(inspectorKeyIndex("ArrowRight", 12, 13), 0);
  assert.equal(inspectorKeyIndex("Home", 8, 13), 0);
  assert.equal(inspectorKeyIndex("End", 0, 13), 12);
  assert.equal(inspectorKeyIndex("ArrowDown", 1, 13), undefined);
  assert.equal(inspectorKeyIndex("Home", -1, 13), undefined);
  assert.equal(inspectorKeyIndex("Home", 0, 0), undefined);
});
