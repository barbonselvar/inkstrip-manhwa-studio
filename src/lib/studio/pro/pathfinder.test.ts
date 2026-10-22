import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pathfinder,
  PATHFINDER_OPERATIONS,
  pathfinderSelection,
  type PathfinderOperation,
} from "./pathfinder.ts";
import { contours, fromPanel, layer, worldPoint, type Layer, type ProDocument } from "./model.ts";
import { nativePath, releaseCompound } from "./compound.ts";
import { editAnchor } from "./anchor-edit.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { nativeFile, readNative, vectorSvg } from "./files.ts";
const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
function rect(x = 0, y = 0, w = 20, h = 20, fill = "#ff0000") {
  const l = layer("shape", w, h);
  l.fill = fill;
  l.strokeWidth = 0;
  l.transform.x = x;
  l.transform.y = y;
  return l;
}
function doc(...layers: Layer[]): ProDocument {
  return {
    ...fromPanel({ id: "p", name: "Boolean", width: 128, height: 96 }),
    layers,
    source: undefined,
  };
}
function run(d: ProDocument, operation: PathfinderOperation, allowEmpty = false, tolerance = 0.1) {
  return pathfinder(
    d,
    d.layers.filter((l) => !l.parentId).map((l) => l.id),
    operation,
    { allowEmpty, tolerance },
  ).document;
}
function polygons(l: Layer) {
  return contours(nativePath(l)).map((c) => c.anchors.map((a) => worldPoint(a, l)));
}
function area(d: ProDocument) {
  return d.layers
    .filter((l) => l.kind === "shape")
    .reduce(
      (total, l) =>
        total +
        Math.abs(
          polygons(l).reduce(
            (sum, p) =>
              sum +
              p.reduce((s, a, i) => {
                const b = p[(i + 1) % p.length]!;
                return s + a.x * b.y - b.x * a.y;
              }, 0) /
                2,
            0,
          ),
        ),
      0,
    );
}
function inside(l: Layer, x: number, y: number) {
  let winding = 0,
    crossings = 0;
  for (const p of polygons(l))
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!,
        b = p[(i + 1) % p.length]!;
      if ((a.y <= y && b.y > y) || (a.y > y && b.y <= y)) {
        const at = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (at > x) {
          crossings++;
          winding += b.y > a.y ? 1 : -1;
        }
      }
    }
  return l.fillRule === "evenodd" ? crossings % 2 === 1 : winding !== 0;
}
const contains = (d: ProDocument, x: number, y: number) =>
  d.layers.some((l) => l.kind === "shape" && inside(l, x, y));
function contour(points: [number, number][]) {
  return { closed: true, anchors: points.map(([x, y]) => ({ x, y })) };
}
for (const [operation, expected] of [
  ["unite", 600],
  ["subtract", 200],
  ["intersect", 200],
  ["exclude", 400],
  ["divide", 600],
  ["trim", 600],
  ["merge", 600],
] as const)
  test(`${operation}: overlapping rectangle area and independent point coverage`, () => {
    const d = doc(rect(), rect(10)),
      before = structuredClone(d),
      r = run(d, operation);
    near(area(r), expected);
    assert.deepEqual(d, before);
    for (let x = 1; x < 30; x += 2)
      for (let y = 1; y < 20; y += 2) {
        const a = x < 20,
          b = x > 10;
        const expected =
          operation === "subtract"
            ? a && !b
            : operation === "intersect"
              ? a && b
              : operation === "exclude"
                ? a !== b
                : a || b;
        assert.equal(contains(r, x, y), expected, `${x},${y}`);
      }
    assert.ok(r.layers.every((l) => l.shape === "path" && l.closed && !l.pathData));
  });
test("Subtract is stack-ordered and subtracts every front cutter", () => {
  const d = doc(rect(0, 0, 60, 20), rect(10), rect(40));
  near(area(run(d, "subtract")), 400);
  assert.ok(!contains(run(d, "subtract"), 15, 5));
});
test("Divide creates separate coverage cells; Trim removes occluded geometry; Merge joins compatible fills", () => {
  const d = doc(rect(), rect(10, 0, 20, 20, "#00ff00")),
    divide = run(d, "divide"),
    trim = run(d, "trim"),
    merge = run(d, "merge");
  assert.equal(divide.layers.length, 3);
  assert.equal(trim.layers.length, 2);
  assert.equal(merge.layers.length, 2);
  for (const result of [divide, trim, merge]) {
    for (let x = 1; x < 30; x += 2) {
      const covered = result.layers.filter((l) => inside(l, x, 5));
      assert.equal(covered.length, 1);
      assert.equal(covered[0]!.fill, x < 10 ? "#ff0000" : "#00ff00");
    }
    assert.ok(result.layers.every((l) => l.strokeWidth === 0));
  }
  const same = doc(rect(), rect(10, 0, 20, 20, "#FF0000"));
  assert.equal(run(same, "merge").layers.length, 1);
});
test("three-object Exclude uses odd parity; Intersect requires all operands", () => {
  const d = doc(rect(0, 0, 40, 20), rect(10, 0, 40, 20), rect(20, 0, 40, 20));
  near(area(run(d, "intersect")), 400);
  const r = run(d, "exclude");
  assert.ok(contains(r, 25, 5));
  assert.ok(!contains(r, 15, 5));
  near(area(r), 800);
});
test("disjoint shapes form editable compounds; empty intersection is explicit and undoable", () => {
  const d = doc(rect(), rect(40));
  assert.equal(run(d, "unite").layers[0]!.subpaths!.length, 1);
  assert.throws(() => run(d, "intersect"), /Empty/);
  const r = run(d, "intersect", true);
  assert.equal(r.layers.length, 0);
  const h = record(createHistory(d), r);
  assert.deepEqual(undo(h).present, d);
  assert.deepEqual(redo(undo(h)).present, r);
});
test("identical and reversed coincident operands normalize safely", () => {
  const a = rect(),
    b = rect();
  for (const op of ["unite", "intersect", "divide", "trim", "merge"] as const)
    near(area(run(doc(a, b), op)), 400);
  for (const op of ["subtract", "exclude"] as const)
    assert.equal(run(doc(a, b), op, true).layers.length, 0);
  const reverse = nativePath(b);
  reverse.anchors.reverse();
  near(area(run(doc(a, reverse), "intersect")), 400);
});
test("edge tangencies, vertex tangencies, near-coincident edges and concavity", () => {
  near(area(run(doc(rect(), rect(20)), "unite")), 800);
  assert.equal(run(doc(rect(), rect(20)), "intersect", true).layers.length, 0);
  near(area(run(doc(rect(), rect(20, 20)), "unite")), 800);
  near(area(run(doc(rect(), rect(19.99996)), "intersect", true)), 0, 0.002);
  const concave = rect();
  Object.assign(concave, {
    shape: "path",
    ...contour([
      [0, 0],
      [20, 0],
      [20, 5],
      [5, 5],
      [5, 20],
      [0, 20],
    ]),
  });
  near(area(run(doc(concave, rect(3, 3, 10, 10)), "intersect")), 36);
});
test("compound evenodd/nonzero holes, reversed winding and nested islands", () => {
  const outer = rect(0, 0, 60, 60);
  Object.assign(outer, {
    shape: "path",
    ...contour([
      [0, 0],
      [60, 0],
      [60, 60],
      [0, 60],
    ]),
    subpaths: [
      contour([
        [10, 10],
        [50, 10],
        [50, 50],
        [10, 50],
      ]),
      contour([
        [20, 20],
        [40, 20],
        [40, 40],
        [20, 40],
      ]),
    ],
    fillRule: "evenodd",
  });
  const r = run(doc(outer, rect(80)), "unite");
  assert.ok(!contains(r, 15, 15));
  assert.ok(contains(r, 25, 25));
  near(area(r), 2800);
  outer.fillRule = "nonzero";
  assert.ok(contains(run(doc(outer, rect(80)), "unite"), 15, 15));
  outer.subpaths![0]!.anchors.reverse();
  outer.subpaths![1]!.anchors.reverse();
  assert.ok(!contains(run(doc(outer, rect(80)), "unite"), 15, 15));
});
test("self-crossing bowties are resolved by filled winding; collinear degeneracy is rejected atomically", () => {
  const bow = rect();
  Object.assign(bow, {
    shape: "path",
    ...contour([
      [0, 0],
      [20, 20],
      [0, 20],
      [20, 0],
    ]),
  });
  near(area(run(doc(bow, rect(40)), "unite")), 600);
  const flat = rect();
  Object.assign(flat, {
    shape: "path",
    ...contour([
      [0, 0],
      [10, 0],
      [20, 0],
    ]),
  });
  const d = doc(flat, rect(40)),
    before = structuredClone(d);
  assert.throws(() => run(d, "unite"), /filled|resolved/);
  assert.deepEqual(d, before);
});
test("reflected, rotated, sheared and nonuniformly scaled operands match affine areas", () => {
  const a = rect(50, 30);
  a.transform = {
    ...a.transform,
    scaleX: 2,
    scaleY: 1.5,
    rotation: 31,
    shearX: 20,
    flipX: true,
    pivot: { x: 10, y: 10 },
  };
  const b = structuredClone(a);
  b.id = rect().id;
  const r = run(doc(a, b), "intersect");
  near(area(r), 1200, 0.02);
  for (const p of polygons(a)[0]!)
    assert.ok(
      r.layers.some((l) =>
        polygons(l).some((ps) => ps.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.0002)),
      ),
    );
});
test("legacy editing-frame clipping is retained; new overflowing paths retain their full region", () => {
  const a = rect();
  Object.assign(a, {
    shape: "path",
    ...contour([
      [-10, 0],
      [30, 0],
      [30, 20],
      [-10, 20],
    ]),
  });
  near(area(run(doc(a, rect(50)), "unite")), 800);
  a.vectorOverflow = true;
  near(area(run(doc(a, rect(50)), "unite")), 1200);
});
test("neutral nested groups flatten only the selected forest and preserve outside hierarchy", () => {
  const group = layer("group", 128, 96),
    nested = layer("group", 128, 96),
    a = rect(),
    b = rect(10),
    untouched = rect(80);
  nested.parentId = group.id;
  a.parentId = nested.id;
  b.parentId = nested.id;
  const d = doc(group, nested, a, b, untouched),
    r = pathfinder(d, [a.id, b.id], "unite").document;
  assert.deepEqual(
    r.layers.filter((l) => l.kind === "group"),
    [group, nested],
  );
  assert.equal(r.layers.find((l) => l.name === "Pathfinder unite")!.parentId, nested.id);
  assert.deepEqual(r.layers.at(-1), untouched);
  const flat = pathfinder(d, [group.id, untouched.id], "unite").document;
  assert.equal(flat.layers.length, 1);
  assert.equal(flat.layers[0]!.parentId, undefined);
});
for (const radius of [12, 40, 160])
  test(`circle Boolean lens/area and tangency at radius ${radius} stay within approximation error`, () => {
    const a = rect(0, 0, radius * 2, radius * 2);
    a.shape = "ellipse";
    const b = rect(radius, 0, radius * 2, radius * 2);
    b.shape = "ellipse";
    const lens =
        2 * radius * radius * Math.acos(0.5) - (radius / 2) * Math.sqrt(3 * radius * radius),
      r = run(doc(a, b), "intersect");
    near(area(r), lens, Math.PI * radius * 0.35);
    const outside = run(doc(a, b), "unite");
    for (let x = 1; x < radius * 3; x += 2)
      for (let y = 1; y < radius * 2; y += 3) {
        const da = Math.hypot(x - radius, y - radius) - radius,
          db = Math.hypot(x - 2 * radius, y - radius) - radius;
        if (Math.min(Math.abs(da), Math.abs(db)) > 0.2)
          assert.equal(contains(outside, x, y), da < 0 || db < 0);
      }
    b.transform.x = radius * 2;
    near(area(run(doc(a, b), "unite")), 2 * Math.PI * radius * radius, Math.PI * radius * 0.7);
  });
test("cubic boundaries have controlled approximation and editable line/handle results", () => {
  const a = rect(0, 0, 100, 80);
  a.shape = "path";
  a.closed = true;
  a.anchors = [
    { x: 0, y: 40, outgoing: { x: 0, y: 0 } },
    { x: 100, y: 40, incoming: { x: 100, y: 0 }, outgoing: { x: 100, y: 80 } },
    { x: 0, y: 40, incoming: { x: 0, y: 80 } },
  ];
  const r = run(doc(a, rect(120, 0, 5, 5)), "unite", false, 0.02);
  assert.ok(r.layers[0]!.anchors.length > 16);
  assert.ok(r.layers[0]!.anchors.every((a) => !a.incoming && !a.outgoing));
  // Analytic symmetric cubic lobes enclose 4800 square pixels.
  near(area(r), 4825, 10);
  const edited = editAnchor(r, r.layers[0]!.id, 0, {
    kind: "handle",
    part: "outgoing",
    point: { x: 5, y: 5 },
  });
  assert.ok(edited.layers[0]!.anchors[0]!.outgoing);
});
test("all operation results survive native roundtrip/history and expose safe editable SVG", async () => {
  const d = doc(rect(), rect(10));
  for (const operation of PATHFINDER_OPERATIONS) {
    const r = run(d, operation),
      h = record(createHistory(d), r);
    assert.deepEqual(undo(h).present, d);
    assert.deepEqual(redo(undo(h)).present, r);
    const blob = await nativeFile({
      document: r,
      assets: {},
      revision: 0,
      acceptedBlobId: "b",
      updatedAt: 0,
    });
    const s = await readNative(blob, r.panelId, "b");
    assert.deepEqual(s.document, JSON.parse(JSON.stringify(r)));
    const svg = vectorSvg(r);
    assert.ok(svg.includes("<path"));
    assert.ok(!svg.includes("<image"));
    assert.ok(svg.includes('fill-rule="nonzero"'));
  }
});
test("results retain compound release, anchor editing and source metadata", () => {
  const d = doc(rect(), rect(40)),
    r = run(d, "unite"),
    released = releaseCompound(r, r.layers[0]!.id).document;
  assert.equal(released.layers.length, 2);
  near(area(released), 800);
  assert.equal(r.width, d.width);
  assert.equal(r.height, d.height);
});
test("unsupported selections fail before any source changes", () => {
  for (const mutate of [
    (l: Layer) => {
      l.locked = true;
    },
    (l: Layer) => {
      l.visible = false;
    },
    (l: Layer) => {
      l.opacity = 0.5;
    },
    (l: Layer) => {
      l.fillOpacity = 0.5;
    },
    (l: Layer) => {
      l.fill = "transparent";
    },
    (l: Layer) => {
      l.blend = "multiply";
    },
    (l: Layer) => {
      l.linkId = "linked";
    },
    (l: Layer) => {
      l.mask = {
        enabled: true,
        strokes: [],
        selection: { regions: [], inverted: false, feather: 0 },
      };
    },
    (l: Layer) => {
      l.kind = "text";
    },
    (l: Layer) => {
      l.shape = "line";
    },
    (l: Layer) => {
      Object.assign(l, {
        shape: "path",
        closed: false,
        anchors: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ],
      });
    },
  ]) {
    const d = doc(rect(), rect(10));
    mutate(d.layers[0]!);
    const before = structuredClone(d);
    assert.throws(() => run(d, "unite"));
    assert.deepEqual(d, before);
  }
  const d = doc(rect(), rect(30), rect(60));
  assert.throws(() => pathfinderSelection(d, [d.layers[0]!.id, d.layers[2]!.id]), /consecutive/);
  assert.throws(() => pathfinderSelection(d, [d.layers[0]!.id, d.layers[0]!.id]));
});
test("invalid tolerances, coordinates, region/layer and geometry budgets reject atomically", () => {
  const d = doc(rect(), rect(10));
  for (const tolerance of [0, 0.01, 1.01, NaN, Infinity])
    assert.throws(() => run(d, "unite", false, tolerance), /tolerance/);
  const bad = structuredClone(d);
  bad.layers[0]!.transform.x = NaN;
  assert.throws(() => run(bad, "unite"));
  const many = doc(...Array.from({ length: 17 }, (_, i) => rect(i)));
  assert.throws(() => run(many, "unite"), /2–16/);
  const huge = rect(0, 0, 16000, 1),
    off = rect(20000);
  assert.throws(() => run(doc(huge, off), "unite"), /oversized|layer/);
  const busy = rect(0, 0, 100, 100);
  busy.shape = "path";
  busy.closed = true;
  busy.anchors = Array.from({ length: 999 }, (_, i) => ({ x: (i % 2) * 100, y: i % 100 }));
  assert.throws(() => run(doc(busy, rect(110)), "unite"), /complexity/);
});

test("seeded multi-object Boolean regions agree with an independent rectangle coverage oracle", () => {
  let state = 173;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let trial = 0; trial < 12; trial++) {
    const shapes = Array.from({ length: 3 + (trial % 3) }, (_, i) =>
      rect(
        Math.floor(random() * 35),
        Math.floor(random() * 30),
        5 + Math.floor(random() * 30),
        5 + Math.floor(random() * 25),
        i % 2 ? "#00ff00" : "#ff0000",
      ),
    );
    const d = doc(...shapes);
    for (const operation of PATHFINDER_OPERATIONS) {
      const r = run(d, operation, true);
      for (let y = 0.37; y < 60; y += 3)
        for (let x = 0.23; x < 70; x += 3) {
          const coverage = shapes.map(
              (l) =>
                x > l.transform.x &&
                x < l.transform.x + l.width &&
                y > l.transform.y &&
                y < l.transform.y + l.height,
            ),
            n = coverage.filter(Boolean).length;
          const expected =
            operation === "subtract"
              ? coverage[0] && !coverage.slice(1).some(Boolean)
              : operation === "intersect"
                ? n === shapes.length
                : operation === "exclude"
                  ? n % 2 === 1
                  : n > 0;
          assert.equal(contains(r, x, y), expected, `${trial} ${operation} ${x},${y}`);
          if (["divide", "trim", "merge"].includes(operation)) {
            const found = r.layers.filter((l) => inside(l, x, y));
            assert.equal(found.length, expected ? 1 : 0);
            if (found.length)
              assert.equal(found[0]!.fill, shapes[coverage.lastIndexOf(true)]!.fill);
          }
        }
    }
  }
});
