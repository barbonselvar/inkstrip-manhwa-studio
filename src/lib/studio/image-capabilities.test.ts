import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilityBudgets, imageCapabilities } from "./image-capabilities.ts";
import { fromPanel } from "./pro/model.ts";
import { validateOpeningSession } from "./pro/opening.ts";
import { enhancementSize } from "./enhance/types.ts";
import { validateSmartWork } from "./pro/smart-filters.ts";
test("preflight uses actual independent import, Raster, AI and filter policies", () => {
  const desktop = capabilityBudgets(8, false),
    touch = capabilityBudgets(8, true),
    low = capabilityBudgets(2, false);
  assert.equal(desktop.import.maxPixels, 32_000_000);
  assert.equal(desktop.raster, 16_777_216);
  assert.equal(touch.raster, 4_000_000);
  assert.equal(touch.import.maxPixels, 32_000_000);
  assert.equal(low.import.maxPixels, 16_000_000);
  for (const height of [1920, 5000, 10000, 20000])
    for (const budgets of [desktop, touch, low]) {
      const r = imageCapabilities(1080, height, budgets),
        session = {
          document: fromPanel({ id: "long", name: "long", width: 1080, height }),
          assets: { source: new Blob(["x"], { type: "image/png" }) },
          revision: 0,
          updatedAt: 0,
          acceptedBlobId: "x",
        };
      let editable = true,
        ai = true,
        filter = true;
      try {
        validateOpeningSession(session, budgets.raster);
      } catch {
        editable = false;
      }
      try {
        enhancementSize(1080, height, 2);
      } catch {
        ai = false;
      }
      try {
        validateSmartWork(1080, height, [
          { id: "a", enabled: true, operation: { kind: "gaussian", radius: 1 } },
        ]);
      } catch {
        filter = false;
      }
      assert.equal(r.rasterEdit, editable);
      assert.equal(r.enhancement, ai);
      assert.equal(r.smartFilters, editable && filter);
      assert.equal(r.baseRgbaBytes, 1080 * height * 4);
    }
});
test("dimension preflight rejects invalid numbers without allocating artwork", () => {
  for (const [w, h] of [
    [NaN, 1],
    [Infinity, 1],
    [0, 20],
    [2.5, 1],
    [Number.MAX_SAFE_INTEGER, 10],
  ])
    assert.throws(() => imageCapabilities(w!, h!, capabilityBudgets(8, false)));
});
