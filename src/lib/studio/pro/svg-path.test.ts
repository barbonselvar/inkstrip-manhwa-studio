import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSvgPath, svgMatrix } from "./svg-path.ts";
import { anchorCurve, cubicPoint } from "./bezier.ts";
import { applyMatrix } from "./transform.ts";
const near = (a: number, b: number, e = 1e-8) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
test("absolute/relative Move Line H V repeated parameters and exponent notation retain contours", () => {
  const a = parseSvgPath("M10 10 30 10 H50 V30 L10 30 Z M70 10 L80 20").contours,
    b = parseSvgPath("m1e1,1e1 20,0 h20 v20 l-40,0 z m60,0 10,10").contours;
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.closed, true);
  assert.equal(a[1]!.closed, false);
});
test("quadratics convert exactly to cubic geometry", () => {
  const c = parseSvgPath("M10 20 Q40 -10 100 30").contours[0]!,
    curve = anchorCurve(c.anchors[0]!, c.anchors[1]!);
  for (let i = 0; i <= 100; i++) {
    const t = i / 100,
      u = 1 - t,
      p = cubicPoint(curve, t);
    near(p.x, u * u * 10 + 2 * u * t * 40 + t * t * 100);
    near(p.y, u * u * 20 + 2 * u * t * -10 + t * t * 30);
  }
});
test("cubic and quadratic shorthand reflect only the matching preceding control", () => {
  assert.deepEqual(
    parseSvgPath("M0 0 C10 20 20 20 30 0 S50 -20 60 0 L70 0 S80 10 90 0").contours,
    parseSvgPath("M0 0 C10 20 20 20 30 0 C40 -20 50 -20 60 0 L70 0 C70 0 80 10 90 0").contours,
  );
  assert.deepEqual(
    parseSvgPath("M0 0q10 20 20 0t20 0l10 0t20 0").contours,
    parseSvgPath("M0 0Q10 20 20 0Q30 -20 40 0L50 0Q50 0 70 0").contours,
  );
});
test("Close preserves the last cubic handles while eliminating a duplicate closing anchor", () => {
  const c = parseSvgPath("M0 0 C10 20 20 20 0 0 Z").contours[0]!;
  assert.equal(c.anchors.length, 1);
  assert.equal(c.closed, true);
  assert.deepEqual(c.anchors[0]!.incoming, { x: 20, y: 20 });
  assert.deepEqual(c.anchors[0]!.outgoing, { x: 10, y: 20 });
});
test("drawing after Close starts a new open contour at the closed start point", () => {
  const cs = parseSvgPath("M10 10L20 20Zl30 0").contours;
  assert.equal(cs.length, 2);
  assert.equal(cs[0]!.closed, true);
  assert.deepEqual(cs[1], {
    closed: false,
    anchors: [
      { x: 10, y: 10 },
      { x: 40, y: 10 },
    ],
  });
});
test("quarter-circle arc interpolation meets its independent analytic error bound", () => {
  const { contours, arcErrorBound } = parseSvgPath("M100 0 A100 100 0 0 1 0 100", 0.001),
    anchors = contours[0]!.anchors,
    n = anchors.length - 1;
  assert.ok(arcErrorBound <= 0.001);
  assert.ok(n > 1);
  for (let k = 0; k < n; k++)
    for (let j = 0; j <= 32; j++) {
      const t = j / 32,
        p = cubicPoint(anchorCurve(anchors[k]!, anchors[k + 1]!), t);
      assert.ok(Math.abs(Math.hypot(p.x, p.y) - 100) <= arcErrorBound + 1e-8);
      const angle = Math.atan2(p.y, p.x);
      assert.ok(
        angle >= ((k / n) * Math.PI) / 2 - 1e-8 && angle <= (((k + 1) / n) * Math.PI) / 2 + 1e-8,
      );
    }
});
for (const large of [0, 1])
  for (const sweep of [0, 1])
    test(`arc flags large=${large} sweep=${sweep} choose genuine ellipse traversal`, () => {
      const a = parseSvgPath(`M100 0A100 100 0 ${large}${sweep}0 100`).contours[0]!.anchors,
        n = a.length - 1,
        mid = cubicPoint(anchorCurve(a[Math.floor(n / 2)]!, a[Math.floor(n / 2) + 1]!), 0.5);
      near(a.at(-1)!.x, 0);
      near(a.at(-1)!.y, 100);
      if (large) assert.ok(n >= 4);
      else assert.ok(n <= 4);
      if (large && sweep) assert.ok(mid.x > 100 || mid.y > 100);
      if (large && !sweep) assert.ok(mid.x < 0 || mid.y < 0);
      if (!large && sweep) assert.ok(mid.x > 0 && mid.y > 0 && mid.x < 100 && mid.y < 100);
    });
test("rotated elliptical arcs retain endpoints and satisfy the implicit ellipse within interpolation error", () => {
  const angle = Math.PI / 6,
    point = (t: number) => ({
      x: 30 + 80 * Math.cos(angle) * Math.cos(t) - 20 * Math.sin(angle) * Math.sin(t),
      y: 40 + 80 * Math.sin(angle) * Math.cos(t) + 20 * Math.cos(angle) * Math.sin(t),
    }),
    start = point(0),
    end = point(Math.PI / 2),
    result = parseSvgPath(`M${start.x} ${start.y}A80 20 30 0 1 ${end.x} ${end.y}`, 0.001),
    a = result.contours[0]!.anchors,
    n = a.length - 1;
  for (let k = 0; k < n; k++)
    for (let j = 0; j <= 16; j++) {
      const p = cubicPoint(anchorCurve(a[k]!, a[k + 1]!), j / 16),
        dx = p.x - 30,
        dy = p.y - 40,
        parameter = Math.atan2(
          (-Math.sin(angle) * dx + Math.cos(angle) * dy) / 20,
          (Math.cos(angle) * dx + Math.sin(angle) * dy) / 80,
        ),
        q = point(parameter);
      assert.ok(
        parameter >= ((k / n) * Math.PI) / 2 - 1e-7 &&
          parameter <= (((k + 1) / n) * Math.PI) / 2 + 1e-7,
      );
      assert.ok(Math.hypot(p.x - q.x, p.y - q.y) <= result.arcErrorBound + 1e-7);
    }
});
test("undersized radii are corrected, zero radii become lines and coincident endpoints are no-op", () => {
  const a = parseSvgPath("M0 0A10 10 0 0 1 100 0").contours[0]!.anchors;
  for (let k = 0; k < a.length - 1; k++) {
    const p = cubicPoint(anchorCurve(a[k]!, a[k + 1]!), 0.5);
    near(Math.hypot(p.x - 50, p.y), 50, 0.02);
  }
  assert.deepEqual(
    parseSvgPath("M0 0A0 10 0 0 1 100 0").contours,
    parseSvgPath("M0 0L100 0").contours,
  );
  assert.equal(parseSvgPath("M0 0A10 10 0 1 1 0 0").contours[0]!.anchors.length, 1);
});
test("relative and absolute arcs agree, including adjacent flags and signed adjacent coordinates", () => {
  assert.deepEqual(
    parseSvgPath("M10 10a40 30 25 01-20-5").contours,
    parseSvgPath("M10 10A40 30 25 0 1 -10 5").contours,
  );
});
test("malformed, oversized, nonfinite and exhausted conversion budgets fail explicitly", () => {
  for (const d of [
    "L1 1",
    "M0",
    "M0 0X1 2",
    "M0 0L1e999 0",
    "M0 0A1 1 0 2 0 2 2",
    "M0 0A1e-310 1e-310 0 0 1 1 0",
    "M0 0A1 1 0 0 1 1e-200 0",
    "M0 0L,1 2",
    "M0 0,",
    "M0 0L1,,2",
    "M0 0LNaN 0",
    "M0 0Z1 2",
  ])
    assert.throws(() => parseSvgPath(d), Error, d);
  assert.throws(() => parseSvgPath("M0 0" + "L1 1".repeat(1000)), /1000/);
  assert.throws(() => parseSvgPath("M0 0 ".repeat(129)), /128/);
  assert.throws(
    () =>
      parseSvgPath(
        "M100000 0" + "A100000 100000 0 1 1 -100000 0A100000 100000 0 1 1 100000 0".repeat(16),
        1e-6,
      ),
    /budget|limit/,
  );
  assert.throws(() => parseSvgPath("M0 0", Number.MIN_VALUE), /precision/);
});
test("SVG affine lists preserve order, reflection, skew and rotation about a pivot", () => {
  const matrix = svgMatrix("translate(10,20) scale(-2,3) skewX(45) rotate(90,4,5)"),
    p = applyMatrix(matrix, { x: 4, y: 5 });
  near(p.x, -8);
  near(p.y, 35);
  assert.deepEqual(svgMatrix("matrix(1 0 .5 1 2 3)"), [1, 0, 0.5, 1, 2, 3]);
  const q = applyMatrix(svgMatrix("translate(4,5)scale(2)"), { x: 1, y: 1 });
  assert.deepEqual(q, { x: 6, y: 7 });
});
test("singular, unsupported and malformed transform lists are rejected", () => {
  for (const s of [
    "scale(0)",
    "matrix(1 2)",
    "translate(1)foo(2)",
    "rotate(1 2)",
    "skewX(Infinity)",
    "translate(1px)",
    "scale(1.2.3)",
    "translate(1,,2)",
    "translate(1,)",
    "translate(1),",
  ])
    assert.throws(() => svgMatrix(s));
});
