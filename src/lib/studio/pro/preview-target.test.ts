import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel } from "./model.ts";
import { previewTarget, samePreviewTarget, type PreviewView } from "./preview-target.ts";
const document = fromPanel({ id: "p", name: "Viewport", width: 128, height: 96 });
const view: PreviewView = {
  mode: "vector",
  before: false,
  frame: { x: -56, y: -32, width: 10120, height: 128 },
  maxArea: 16_777_216,
  assetEpoch: 1,
  ready: 1,
  quick: false,
};
test("fitting a selected 64px board invalidates a ready 1400px workspace bitmap immediately", () => {
  const displayed = previewTarget(document, view),
    requested = previewTarget(document, {
      ...view,
      frame: { x: 10000, y: 0, width: 64, height: 64 },
    });
  assert.equal(samePreviewTarget(displayed, requested), false);
  assert.equal(samePreviewTarget(requested, requested), true);
});
test("switching equal-sized artboards still invalidates pixels when the origin changes", () => {
  const east = previewTarget(document, {
      ...view,
      frame: { x: 10000, y: 0, width: 64, height: 64 },
    }),
    west = previewTarget(document, { ...view, frame: { x: -10000, y: 0, width: 64, height: 64 } });
  assert.equal(samePreviewTarget(east, west), false);
});
test("frame size and artboard background participate in readiness", () => {
  const frame = { x: 0, y: 0, width: 64, height: 64, background: "transparent" };
  const original = previewTarget(document, { ...view, frame });
  for (const f of [
    { ...frame, width: 32 },
    { ...frame, height: 32 },
    { ...frame, background: "#ffffff" },
  ])
    assert.equal(
      samePreviewTarget(original, previewTarget(document, { ...view, frame: f })),
      false,
    );
});
test("new immutable document revisions and original/composite comparison invalidate old replies", () => {
  const original = previewTarget(document, view);
  assert.equal(samePreviewTarget(original, previewTarget({ ...document }, view)), false);
  assert.equal(
    samePreviewTarget(original, previewTarget(document, { ...view, before: true })),
    false,
  );
});
test("worker asset/init epochs and resource/quick-mode changes cannot accept an earlier reply", () => {
  const original = previewTarget(document, view);
  for (const changed of [{ assetEpoch: 2 }, { ready: 0 }, { maxArea: 4_000_000 }, { quick: true }])
    assert.equal(
      samePreviewTarget(original, previewTarget(document, { ...view, ...changed })),
      false,
    );
});
test("raster/vector transitions invalidate the view; unused raster frame changes do not", () => {
  const raster = previewTarget(document, { ...view, mode: "raster" });
  assert.equal(samePreviewTarget(raster, previewTarget(document, view)), false);
  assert.equal(
    samePreviewTarget(
      raster,
      previewTarget(document, {
        ...view,
        mode: "raster",
        frame: { x: 4, y: 5, width: 6, height: 7 },
      }),
    ),
    true,
  );
});
test("frame identity is value-based and captured before later mutable caller changes", () => {
  const frame = { x: 10000, y: 0, width: 64, height: 64 },
    saved = previewTarget(document, { ...view, frame });
  assert.equal(
    samePreviewTarget(saved, previewTarget(document, { ...view, frame: { ...frame } })),
    true,
  );
  frame.x = 0;
  assert.equal(samePreviewTarget(saved, previewTarget(document, { ...view, frame })), false);
});
test("an absent document or absent completed bitmap is never ready", () => {
  assert.equal(samePreviewTarget(null, previewTarget(document, view)), false);
  const empty = previewTarget(undefined, view);
  assert.equal(samePreviewTarget(empty, empty), false);
});
