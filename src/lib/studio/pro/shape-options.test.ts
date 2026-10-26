import test from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, validateDocument, type Layer } from "./model.ts";
import { shapePath } from "./paths.ts";
import { parseSvgPath } from "./svg-path.ts";
import { anchorCurve, cubicPoint } from "./bezier.ts";
import { nativePath } from "./compound.ts";

/** Area of a native path via its exact cubic segments, sampled densely. */
function area(l: Layer) {
  let total = 0;
  for (const c of parseSvgPath(shapePath(l), 0.001).contours) {
    const n = c.anchors.length,
      pts = [];
    for (let i = 0; i < n; i++) {
      const curve = anchorCurve(c.anchors[i]!, c.anchors[(i + 1) % n]!);
      for (let k = 0; k < 64; k++) pts.push(cubicPoint(curve, k / 64));
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!,
        b = pts[(i + 1) % pts.length]!;
      total += a.x * b.y - b.x * a.y;
    }
  }
  return Math.abs(total) / 2;
}
const shape = (
  kind: Layer["shape"],
  w: number,
  h: number,
  shapeOptions?: Layer["shapeOptions"],
) => {
  const l = layer("shape", w, h);
  l.shape = kind;
  if (shapeOptions) l.shapeOptions = shapeOptions;
  return l;
};

test("documents without shape options keep the exact pre-R9 geometry", () => {
  assert.equal(shapePath(shape("rectangle", 40, 20)), "M0 0 H40 V20 H0 Z");
  const hexagon = shapePath(shape("polygon", 60, 60));
  assert.equal(hexagon.split("L").length, 6);
  assert.equal(shapePath(shape("rectangle", 40, 20, { radius: 0 })), "M0 0 H40 V20 H0 Z");
});

test("rounded rectangle area matches w·h − (4 − π)r², radius clamps to half the short side", () => {
  const r = 10,
    rounded = shape("rectangle", 100, 60, { radius: r });
  assert.ok(Math.abs(area(rounded) - (100 * 60 - (4 - Math.PI) * r * r)) < 0.5);
  const pill = shape("rectangle", 100, 40, { radius: 500 }); // clamps to 20
  assert.ok(Math.abs(area(pill) - (100 * 40 - (4 - Math.PI) * 400)) < 0.5);
  // Native conversion (Pathfinder, anchors, snapping) keeps the curves.
  const native = nativePath(rounded);
  assert.ok(native.anchors.some((a) => a.incoming || a.outgoing));
});

test("polygon sides and star points/inner radius define real geometry", () => {
  const octagon = shape("polygon", 100, 100, { sides: 8 }),
    expected = (8 / 2) * 50 * 50 * Math.sin((2 * Math.PI) / 8);
  assert.ok(Math.abs(area(octagon) - expected) < 0.01);
  const star = shape("star", 100, 100),
    // Default five points, inner radius 0.5: area = n·R·r·sin(π/n).
    starArea = 5 * 50 * 25 * Math.sin(Math.PI / 5);
  assert.ok(Math.abs(area(star) - starArea) < 0.01);
  const sharp = shape("star", 100, 100, { sides: 6, inner: 0.25 });
  assert.ok(Math.abs(area(sharp) - 6 * 50 * 12.5 * Math.sin(Math.PI / 6)) < 0.01);
});

test("shape options validate per shape kind and persist in schema 2", () => {
  const d = fromPanel({ id: "p", name: "p", width: 100, height: 100 });
  d.version = 2;
  d.layers.push(
    shape("rectangle", 40, 40, { radius: 8 }),
    shape("polygon", 40, 40, { sides: 7 }),
    shape("star", 40, 40, { sides: 9, inner: 0.3 }),
  );
  validateDocument(JSON.parse(JSON.stringify(d)));
  const bad = (l: Layer) => {
    const copy = structuredClone(d);
    copy.layers.push(l);
    assert.throws(() => validateDocument(copy), /shape options/);
  };
  bad(shape("ellipse", 10, 10, { radius: 2 }));
  bad(shape("rectangle", 10, 10, { sides: 5 }));
  bad(shape("polygon", 10, 10, { sides: 2 }));
  bad(shape("polygon", 10, 10, { sides: 4.5 }));
  bad(shape("star", 10, 10, { inner: 1 }));
  bad(shape("star", 10, 10, { extra: 1 } as never));
});
