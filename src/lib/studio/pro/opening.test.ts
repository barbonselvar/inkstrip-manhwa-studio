import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, type ProSession } from "./model.ts";
import { validateOpeningSession } from "./opening.ts";

const session = (width: number, height: number): ProSession => ({
  document: fromPanel({ id: "page", name: "Original", width, height }),
  assets: { source: new Blob(["unchanged original"], { type: "image/png" }) },
  acceptedBlobId: "accepted",
  revision: 3,
  updatedAt: 1,
});
test("opening refuses globally valid artwork beyond the actual device area before history/autosave", () => {
  const s = session(1080, 5000),
    before = structuredClone(s);
  assert.throws(() => validateOpeningSession(s, 4_000_000), /device.*memory budget/);
  assert.deepEqual(s, before);
  validateOpeningSession(s, 16_777_216);
});
test("opening accepts exact desktop/touch boundaries and refuses excessive canvas/output/crop", () => {
  validateOpeningSession(session(2000, 2000), 4_000_000);
  validateOpeningSession(session(4096, 4096), 16_777_216);
  assert.throws(() => validateOpeningSession(session(4096, 4097), 16_777_216), /oversized/);
  for (const key of ["crop", "imageSize"] as const) {
    const s = session(64, 64);
    if (key === "crop") s.document.crop = { x: 0, y: 0, width: 2100, height: 2000, rotation: 0 };
    else s.document.imageSize = { width: 2100, height: 2000, resampling: "bicubic" };
    assert.throws(() => validateOpeningSession(s, 4_000_000), /device.*memory budget/);
  }
});
test("opening checks hidden retained sources and invalid device budgets without mutation", () => {
  const s = session(1080, 5000);
  s.document.width = 64;
  s.document.height = 64;
  s.document.layers[0]!.visible = false;
  assert.throws(() => validateOpeningSession(s, 4_000_000), /memory budget/);
  for (const budget of [NaN, 0, Infinity, 16_777_217])
    assert.throws(() => validateOpeningSession(session(64, 64), budget), /pixel budget/);
});
