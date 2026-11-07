import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUBBLE_SHAPES,
  baseOutline,
  bubbleGeometry,
  bubbleOverflow,
  detectDirection,
  detectLanguage,
  layoutBubbleText,
  nearestAttachment,
  outlineAt,
  traceOutline,
  validateBubbleObject,
  type Bubble,
} from "./bubble.ts";
import { BUBBLE_PRESETS, bubble, applyStyle, TEXT_STYLE_KEYS } from "./bubble-presets.ts";
import {
  createComposition,
  validateComposition,
  validateCompositionPreferences,
  layout,
} from "./model.ts";
import { objectBounds, rotateAboutCenter, reanchor, alignObjects } from "./geometry.ts";
import { detailGrid, suggestPlacements, iou } from "./placement.ts";
import type { Chapter, Panel } from "../types.ts";

const chapter = {
  id: "c",
  projectId: "p",
  title: "Chapter",
  createdAt: 0,
  updatedAt: 0,
  width: 800,
  seam: 0,
} as Chapter;
const panel = (id: string, order: number, height = 1200) =>
  ({
    id,
    chapterId: "c",
    name: id,
    order,
    createdAt: order,
    blobId: `blob-${id}`,
    width: 800,
    height,
  }) as Panel;
const measure = (s: string, size: number) => [...s].length * size * 0.55;

test("every built-in bubble preset is valid, editable and stored in a valid composition", () => {
  const panels = [panel("a", 0), panel("b", 1)];
  const d = createComposition(chapter, panels);
  d.objects = BUBBLE_PRESETS.map((p, i) => ({ ...bubble(p), owner: i % 2 ? "b" : "a" }));
  assert.equal(d.objects.length, BUBBLE_PRESETS.length);
  assert.ok(BUBBLE_PRESETS.length >= 12);
  validateComposition({ version: 1, revision: 0, document: d });
  const roundtrip = JSON.parse(JSON.stringify({ version: 1, revision: 1, document: d }));
  validateComposition(roundtrip);
  assert.deepEqual(roundtrip.document.objects[0], d.objects[0]);
});

test("bubble presets save as reusable project styles; invalid values are rejected", () => {
  const b = bubble("Shouting");
  validateCompositionPreferences({
    presets: [{ id: "x", name: "My shout", category: "bubble", value: b }],
    favorites: ["bubble:Shouting"],
  });
  assert.throws(() => validateBubbleObject({ ...b, fill: "red" } as Bubble), /speech bubble/);
  assert.throws(() => validateBubbleObject({ ...b, shape: "Heart" } as never), /speech bubble/);
  assert.throws(
    () => validateBubbleObject({ ...b, font: "x;}</style>" } as Bubble),
    /speech bubble/,
  );
  assert.throws(() =>
    validateCompositionPreferences({
      presets: [
        { id: "y", name: "bad", category: "bubble", value: { ...b, kind: "sfx" } as never },
      ],
      favorites: [],
    }),
  );
});

test("each shape yields a closed outline near its box; None has no outline", () => {
  for (const shape of BUBBLE_SHAPES) {
    const b = { ...bubble(), shape, tails: [], roughness: 0.4 } as Bubble;
    const points = baseOutline(b);
    if (shape === "None") {
      assert.equal(points.length, 0);
      continue;
    }
    assert.ok(points.length >= 12, shape);
    const slack = Math.min(b.width, b.height) * 0.2;
    for (const p of points) {
      assert.ok(p.x >= -slack && p.x <= b.width + slack, `${shape} x ${p.x}`);
      assert.ok(p.y >= -slack && p.y <= b.height + slack, `${shape} y ${p.y}`);
    }
    // Deterministic for the same seed (stable rendering across segments and reloads).
    assert.deepEqual(baseOutline(b), points);
  }
  const rect = baseOutline({ ...bubble("Narration"), roughness: 0 });
  assert.deepEqual(
    rect.filter((p) => p.sharp).map((p) => [p.x, p.y]),
    [
      [360, 0],
      [360, 140],
      [0, 140],
      [0, 0],
    ],
  );
});

test("pointed tails merge into the outline; dots tails become separate circles", () => {
  const b = bubble("Standard dialogue");
  const g = bubbleGeometry(b);
  const tip = b.tails[0]!.tip;
  assert.ok(g.outline.some((p) => p.x === tip.x && p.y === tip.y && p.sharp));
  assert.ok(g.outline.length > baseOutline(b).length - 4);
  const thought = bubbleGeometry(bubble("Thought"));
  assert.equal(thought.dots.length, 3);
  assert.ok(thought.dots[0]!.r > thought.dots[2]!.r);
  // Overlapping tails are skipped rather than corrupting the shape.
  const twin = {
    ...b,
    tails: [b.tails[0]!, { ...b.tails[0]!, id: "t2", tip: { x: 300, y: 320 } }],
  };
  const tips = bubbleGeometry(twin).outline.filter(
    (p) => (p.x === 300 && p.y === 320) || (p.x === tip.x && p.y === tip.y),
  );
  assert.equal(tips.length, 1);
  // Two separate tails both appear.
  const two = { ...twin, tails: [twin.tails[0]!, { ...twin.tails[1]!, attachment: 0.1 }] };
  assert.equal(
    bubbleGeometry(two).outline.filter(
      (p) => (p.x === 300 && p.y === 320) || (p.x === tip.x && p.y === tip.y),
    ).length,
    2,
  );
});

test("tail base handle maps a point back to its perimeter attachment", () => {
  const b = { ...bubble("Standard dialogue"), tails: [] };
  const points = baseOutline(b);
  for (const t of [0.05, 0.3, 0.5, 0.77]) {
    const p = outlineAt(points, t);
    assert.ok(Math.abs(nearestAttachment(b, p) - t) < 0.01, `t=${t}`);
  }
});

test("path tracing keeps sharp corners and smooth curves", () => {
  const ops: string[] = [];
  const sink = {
    moveTo: () => ops.push("M"),
    lineTo: () => ops.push("L"),
    quadraticCurveTo: () => ops.push("Q"),
    closePath: () => ops.push("Z"),
  };
  traceOutline(sink, baseOutline({ ...bubble("Narration") }));
  assert.equal(ops[0], "M");
  assert.equal(ops.at(-1), "Z");
  assert.ok(ops.filter((o) => o === "L").length >= 3);
  ops.length = 0;
  traceOutline(sink, baseOutline({ ...bubble(), tails: [] }));
  assert.ok(ops.filter((o) => o === "Q").length >= 90);
});

test("lettering wraps inside the padded text box and shrinks to fit when enabled", () => {
  const b = {
    ...bubble("Narration"),
    text: "This sentence is long enough to need several lines inside the caption box.",
  };
  const fitted = layoutBubbleText(b, measure);
  assert.ok(fitted.runs.length >= 2);
  for (const r of fitted.runs)
    assert.ok(measure(r.text, fitted.fontSize) <= fitted.box.width + 0.01);
  assert.ok(!fitted.overflow);
  assert.ok(fitted.fontSize < b.size);
  const fixed = layoutBubbleText({ ...b, fit: false }, measure);
  assert.equal(fixed.fontSize, b.size);
  // Elliptical shapes keep text inside the inscribed area.
  const oval = layoutBubbleText(bubble(), measure);
  assert.ok(oval.box.x > 0 && oval.box.y > 0);
  // Vertical Japanese produces upright CJK columns; Latin rotates.
  const vertical = layoutBubbleText({ ...bubble("Japanese vertical"), text: "今夜A" }, measure);
  assert.equal(vertical.runs[0]!.rotation, 0);
  assert.equal(vertical.runs.at(-1)!.rotation, Math.PI / 2);
  // Korean lines break at word boundaries without splitting syllables.
  const ko = layoutBubbleText(
    { ...bubble("Korean dialogue"), width: 220, text: "지금 당장 떠나야 해 여기는 위험해" },
    measure,
  );
  assert.ok(ko.runs.length >= 2);
  assert.equal(
    ko.runs
      .map((r) => r.text)
      .join("")
      .replace(/\s/g, ""),
    "지금당장떠나야해여기는위험해",
  );
});

test("script detection picks direction and language for multilingual lettering", () => {
  assert.equal(detectDirection("يجب أن نغادر"), "rtl");
  assert.equal(detectDirection("123 hello مرحبا"), "ltr");
  assert.equal(detectDirection("עברית"), "rtl");
  assert.equal(detectLanguage("지금 당장"), "ko");
  assert.equal(detectLanguage("こんにちは"), "ja");
  assert.equal(detectLanguage("你好"), "zh");
  assert.equal(detectLanguage("مرحبا"), "ar");
  assert.equal(detectLanguage("Hello!"), "en");
  assert.equal(detectLanguage("Привет"), "other");
});

test("overflow covers tails, stroke and shadow so segmented export never culls them", () => {
  const b = bubble("Standard dialogue");
  const overflow = bubbleOverflow(b);
  assert.ok(overflow >= b.tails[0]!.tip.y - b.height);
  assert.ok(bubbleOverflow({ ...b, shadowBlur: 20 }) > overflow + 50);
});

test("chapter and focus share one coordinate: panel-local bubbles follow their panel", () => {
  const panels = [panel("a", 0, 1000), panel("b", 1, 600)];
  const d = createComposition(chapter, panels);
  const b = { ...bubble(), owner: "b", x: 100, y: -40 };
  d.objects = [b];
  const before = objectBounds(b, layout(d, panels).frames, d.objects);
  d.panels.a = { ...d.panels.a, bottom: { ...d.panels.a.bottom, height: 300 } };
  const after = objectBounds(b, layout(d, panels).frames, d.objects);
  assert.equal(after.y - before.y, 300);
  assert.equal(after.x, before.x);
});

test("text and bubble styles transfer between bubbles", () => {
  const target = bubble("Standard dialogue"),
    source = bubble("Dramatic");
  const next = applyStyle(target, source, TEXT_STYLE_KEYS);
  assert.equal(next.textColor, "#ffffff");
  assert.equal(next.shape, "Oval");
  assert.equal(next.text, target.text);
});

test("smart placement prefers empty areas, avoids faces and existing dialogue", () => {
  const width = 100,
    height = 200,
    rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  // Busy checkerboard art in the lower half.
  for (let y = 100; y < 200; y++)
    for (let x = 0; x < 100; x++) {
      const v = (x + y) % 2 ? 0 : 255;
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }
  const grid = detailGrid(rgba, width, height, { x: 0, y: 0, width: 800, height: 1600 }, 4);
  const [best] = suggestPlacements(grid, { width: 300, height: 200 });
  assert.ok(best && best.y + best.height <= 800, "top half is empty");
  assert.equal(best.reason, "empty area");
  // A face in the top-left pushes the suggestion away from it.
  const face = { x: 0, y: 0, width: 400, height: 500 };
  const withFace = suggestPlacements(grid, { width: 300, height: 200 }, { faces: [face] });
  assert.ok(withFace.every((s) => iou(s, face) === 0 || s.cost > 1));
  assert.equal(iou(withFace[0]!, face), 0);
  // Existing dialogue: avoid collision and continue reading order below/after it.
  const existing = { x: 16, y: 16, width: 300, height: 200 };
  const next = suggestPlacements(grid, { width: 300, height: 200 }, { occupied: [existing] });
  assert.equal(iou(next[0]!, existing), 0);
  assert.ok(next[0]!.x >= existing.x + existing.width - 1 || next[0]!.y >= existing.y);
  // Suggestions are distinct.
  assert.ok(next.length === 3 && iou(next[0]!, next[1]!) < 0.25);
  // Deterministic.
  assert.deepEqual(
    suggestPlacements(grid, { width: 300, height: 200 }),
    suggestPlacements(grid, { width: 300, height: 200 }),
  );
});

test("rotation keeps the visual center; re-anchoring keeps world position across panels", () => {
  const panels = [panel("a", 0, 1000), panel("b", 1, 600)];
  const d = createComposition(chapter, panels);
  const frames = layout(d, panels).frames;
  const b = { ...bubble(), owner: "a", x: 200, y: 300 };
  const center = (o: typeof b) => {
    const r = objectBounds(o, frames, [o]);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const turned = rotateAboutCenter(b, 30, frames, [b]) as typeof b;
  assert.equal(turned.rotation, 30);
  assert.ok(Math.abs(center(turned).x - center(b).x) < 1e-6);
  assert.ok(Math.abs(center(turned).y - center(b).y) < 1e-6);
  // Dragged so its center sits inside panel b: owner changes, world bounds do not.
  const moved = { ...b, y: 1100 };
  const anchored = reanchor(moved, frames, [moved]);
  assert.equal(anchored.owner, "b");
  assert.deepEqual(
    objectBounds(anchored, frames, [anchored]),
    objectBounds(moved, frames, [moved]),
  );
  assert.equal(reanchor(b, frames, [b]), b);
});

test("multi-object alignment and distribution use world bounds", () => {
  const panels = [panel("a", 0, 2000)];
  const d = createComposition(chapter, panels);
  const frames = layout(d, panels).frames;
  const objs = [
    { ...bubble(), id: "1", owner: "a", x: 10, y: 0 },
    { ...bubble(), id: "2", owner: "a", x: 300, y: 500 },
    { ...bubble(), id: "3", owner: "a", x: 100, y: 1500 },
  ];
  const left = alignObjects(["1", "2", "3"], "left", frames, objs);
  assert.deepEqual(
    left.map((o) => o.x),
    [10, 10, 10],
  );
  const spread = alignObjects(["1", "2", "3"], "spread-y", frames, objs);
  const ys = spread.map((o) => o.y).sort((a, b) => a - b);
  assert.equal(ys[1]! - ys[0]!, ys[2]! - ys[1]!);
  // Locked objects never move.
  const locked = alignObjects(["1", "2"], "right", frames, [
    objs[0]!,
    { ...objs[1]!, locked: true },
  ]);
  assert.equal(locked[1]!.x, 300);
});
