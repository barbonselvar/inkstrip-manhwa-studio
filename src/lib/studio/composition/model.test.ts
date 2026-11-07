import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createComposition,
  layout,
  space,
  panelComposition,
  mergeGap,
  reconcile,
  transitionActive,
  validateComposition,
  readComposition,
  compositionBlobIds,
  validateCompositionPreferences,
  fade,
  type Transition,
} from "./model.ts";
import { sfx, fx, common, SFX_CATEGORIES, FX_CATEGORIES } from "./library.ts";
import { objectMatrix, reparent, hitObject } from "./geometry.ts";
import { applyMatrix } from "../pro/transform.ts";
import { segmentRows } from "./segments.ts";
import { fadeCoverage, noise, stopValue } from "./masks.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { validateChapterRecord, partitionLibrary } from "../records.ts";
import { encodeBackup, decodeBackup, projectBlobIds } from "../backup.ts";
import { bubble } from "./bubble-presets.ts";
import type { Panel, Chapter, Project } from "../types.ts";
const project: Project = {
  id: "project",
  title: "Infinity Regression",
  createdAt: 0,
  updatedAt: 0,
};
const chapter: Chapter = {
  id: "chapter",
  projectId: project.id,
  title: "Chapter 1",
  createdAt: 0,
  updatedAt: 0,
  width: 800,
  seam: 20,
  format: "image/png",
  strip: null,
};
const panels: Panel[] = [0, 1, 2].map((i) => ({
  id: `p${i}`,
  chapterId: chapter.id,
  name: `Panel ${i + 1}`,
  mime: "image/png",
  width: 1600,
  height: 800 + 800 * i,
  blobId: `blob${i}`,
  thumbId: `thumb${i}`,
  order: i,
  createdAt: i,
}));
const scene = () => createComposition(chapter, panels);
const transition = (a = "p0", b = "p1"): Transition => ({
  id: "transition",
  a,
  b,
  type: "Crossfade",
  height: 350,
  softness: 0.6,
  opacity: 1,
  angle: 0,
  color: "#ffffff",
  visible: true,
  locked: false,
  seed: 123,
  stops: [
    { position: 0, opacity: 0 },
    { position: 1, opacity: 1 },
  ],
});
const validate = (d = scene()) => validateComposition({ version: 1, revision: 0, document: d });
test("old chapters initialize without rewriting chapter or source images", () => {
  const before = JSON.stringify({ chapter, panels });
  const d = scene();
  assert.equal(d.width, 800);
  validate(d);
  assert.equal(JSON.stringify({ chapter, panels }), before);
  assert.equal("composition" in chapter, false);
});
test("all source aspect ratios and canonical reading order are retained", () => {
  const l = layout(scene(), panels);
  assert.deepEqual(
    l.frames.map((f) => f.imageHeight),
    [400, 800, 1200],
  );
  assert.deepEqual(
    l.frames.map((f) => f.imageY),
    [0, 420, 1240],
  );
  assert.equal(l.height, 2440);
});
test("scenario A: top 300 and bottom 500 are exact chapter pixels", () => {
  const d = scene();
  d.panels.p1.top = space(300);
  d.panels.p1.bottom = space(500);
  const l = layout(d, panels);
  assert.equal(l.frames[1].imageY, 720);
  assert.equal(l.frames[1].gapY - l.frames[1].top, 1600);
  assert.equal(l.frames[2].imageY, 2040);
});
test("opening and ending space preserve exact total height", () => {
  const d = scene();
  d.opening = space(111);
  d.ending = space(333);
  const l = layout(d, panels);
  assert.equal(l.frames[0].imageY, 111);
  assert.equal(l.height, 2884);
});
test("transparent and hidden fills keep layout dimensions", () => {
  const d = scene();
  d.panels.p0.top = { ...space(275), fill: "transparent", visible: false };
  assert.equal(layout(d, panels).frames[0].imageY, 275);
});
test("bottom + between + next top add without silent merging", () => {
  const d = scene();
  d.panels.p0.bottom.height = 200;
  d.panels.p1.top.height = 300;
  const l = layout(d, panels);
  assert.equal(l.frames[1].imageY - l.frames[0].bottomY, 520);
});
test("explicit merge preserves total while selecting one shared fill", () => {
  const d = scene();
  d.panels.p0.bottom.height = 200;
  d.panels.p1.top.height = 300;
  const merged = mergeGap(d, "p0", "p1", "#000000");
  assert.equal(merged.panels.p0.after.height, 520);
  assert.equal(merged.panels.p0.after.color, "#000000");
  assert.equal(merged.panels.p0.bottom.height, 0);
  assert.equal(merged.panels.p1.top.height, 0);
  assert.equal(layout(merged, panels).height, layout(d, panels).height);
  assert.equal(d.panels.p0.bottom.height, 200);
});
test("last panel does not receive an accidental trailing between-panel gap", () => {
  const d = scene();
  d.panels.p2.after.height = 999;
  assert.equal(layout(d, panels).height, 2440);
});
test("native snapshot dimensions only change the composition source", () => {
  const d = scene();
  d.panels.p1.snapshot = { blobId: "snapshot", width: 1000, height: 500, revision: 4 };
  assert.equal(layout(d, panels).frames[1].imageHeight, 400);
  assert.equal(panels[1].height, 1600);
  assert.deepEqual(compositionBlobIds({ document: d }), ["snapshot"]);
});
test("local SFX follows reorder while global SFX retains its coordinates", () => {
  const d = scene(),
    local = { ...sfx(), owner: "p1", y: -80 },
    global = { ...sfx(), y: 330 };
  d.objects = [local, global];
  const a = layout(d, panels).frames,
    b = layout(d, [panels[1], panels[0], panels[2]]).frames;
  assert.equal(objectMatrix(local, a, d.objects)[5], 340);
  assert.equal(objectMatrix(local, b, d.objects)[5], -80);
  assert.equal(objectMatrix(global, a, d.objects)[5], objectMatrix(global, b, d.objects)[5]);
});
test("transitions are inactive rather than rebound silently after reorder", () => {
  const t = transition();
  assert.equal(transitionActive(t, panels), true);
  assert.equal(transitionActive(t, [panels[0], panels[2], panels[1]]), false);
  assert.equal(t.b, "p1");
});
test("deletion reconciliation removes owners and their pair references", () => {
  const d = scene();
  d.objects = [{ ...sfx(), owner: "p1" }, sfx()];
  d.transitions = [transition()];
  const r = reconcile(d, [panels[0], panels[2]]);
  assert.equal(r.panels.p1, undefined);
  assert.equal(r.objects.length, 1);
  assert.equal(r.transitions.length, 0);
  validate(r);
});
test("new imports inherit configurable default gaps", () => {
  const d = scene();
  delete d.panels.p2;
  d.defaultGap = 150;
  assert.equal(reconcile(d, panels).panels.p2.after.height, 150);
});
test("future or damaged scene versions return an error without throwing away artwork", () => {
  assert.equal(readComposition({ version: 99 }).record, null);
  assert.ok(readComposition({ version: 1, revision: NaN }).error);
  const c = { ...chapter, composition: { version: 99 } };
  assert.equal(validateChapterRecord(c), c);
  const l = partitionLibrary({ projects: [project], chapters: [c], panels });
  assert.equal(l.chapters.length, 1);
  assert.equal(l.quarantined.length, 0);
});
test("NaN geometry, oversized spaces and injected font strings are rejected", () => {
  const d = scene(),
    o = sfx();
  o.x = NaN;
  d.objects = [o];
  assert.throws(() => validate(d), /geometry/);
  o.x = 0;
  o.font = "url(evil)";
  assert.throws(() => validate(d), /lettering/);
  d.objects = [];
  d.opening.height = 100001;
  assert.throws(() => validate(d), /spacing/);
});
test("duplicate object identifiers and missing owners are rejected", () => {
  const d = scene(),
    o = sfx();
  d.objects = [o, { ...o }];
  assert.throws(() => validate(d), /duplicate/);
  d.objects = [{ ...o, owner: "missing" }];
  assert.throws(() => validate(d), /owner/);
});
test("cyclic groups and cross-scope parents are rejected", () => {
  const d = scene(),
    group = { ...common("Group"), kind: "group" as const };
  group.parentId = group.id;
  d.objects = [group];
  assert.throws(() => validate(d), /cycle/);
  group.parentId = undefined;
  group.owner = "p0";
  d.objects = [group, { ...sfx(), parentId: group.id, owner: "p1" }];
  assert.throws(() => validate(d), /scope/);
});
test("reparenting transformed lettering preserves all world corner positions", () => {
  const d = scene(),
    o = { ...sfx(), owner: "p1", rotation: -15, skew: 12 },
    g = {
      ...common("Group"),
      kind: "group" as const,
      owner: "p1",
      x: 90,
      y: 140,
      rotation: 20,
      scaleX: 1.5,
      scaleY: 0.8,
    };
  d.objects = [o, g];
  const frames = layout(d, panels).frames,
    next = reparent(o, g.id, o.owner, frames, d.objects);
  for (const p of [
    { x: 0, y: 0 },
    { x: 400, y: 240 },
  ]) {
    const a = applyMatrix(objectMatrix(o, frames, d.objects), p),
      b = applyMatrix(objectMatrix(next, frames, [next, g]), p);
    assert.ok(Math.abs(a.x - b.x) < 1e-7);
    assert.ok(Math.abs(a.y - b.y) < 1e-7);
  }
});
test("inverse-transform hit testing selects rotated text outside source bounds", () => {
  const d = scene(),
    o = { ...sfx(), owner: "p1", y: -150, rotation: 25 };
  d.objects = [o];
  const frames = layout(d, panels).frames,
    p = applyMatrix(objectMatrix(o, frames, d.objects), { x: 100, y: 100 });
  assert.ok(hitObject(o, p, frames, d.objects));
  assert.equal(o.clip, false);
});
test("region row intervals have no gaps, overlap or lost final row", () => {
  const rows = segmentRows(10003, 2048);
  assert.equal(rows[0].start, 0);
  assert.equal(rows.at(-1)!.end, 10003);
  assert.equal(
    rows.reduce((sum, r) => sum + r.end - r.start, 0),
    10003,
  );
  rows.slice(1).forEach((r, i) => assert.equal(r.start, rows[i].end));
});
test("segmentation rejects invalid dimensions before allocation", () => {
  assert.throws(() => segmentRows(Infinity, 512));
  assert.throws(() => segmentRows(50, 0));
});
test("350 px bottom fade retains its exact start, midpoint and edge", () => {
  const f = fade();
  assert.equal(fadeCoverage(f, 100, 650, 800, 1000), 0);
  assert.equal(fadeCoverage(f, 100, 825, 800, 1000), 0.5);
  assert.equal(fadeCoverage(f, 100, 1000, 800, 1000), 1);
});
test("fade direction, length, start, opacity and curve affect mask coverage", () => {
  const f = fade("Top Fade");
  f.length = 200;
  assert.equal(fadeCoverage(f, 50, 0, 800, 1000), 1);
  assert.equal(fadeCoverage(f, 50, 200, 800, 1000), 0);
  f.start = 100;
  assert.equal(fadeCoverage(f, 50, 100, 800, 1000), 1);
  f.opacity = 0.5;
  f.curve = 2;
  assert.equal(fadeCoverage(f, 50, 200, 800, 1000), 0.125);
});
test("left/right/multi-edge fades use the selected image edges", () => {
  assert.equal(fadeCoverage(fade("Left Fade"), 0, 500, 800, 1000), 1);
  assert.equal(fadeCoverage(fade("Right Fade"), 800, 500, 800, 1000), 1);
  assert.equal(fadeCoverage(fade("Multi-edge Fade"), 400, 500, 800, 1000), 0);
});
test("custom mask stops interpolate deterministically", () => {
  assert.ok(
    Math.abs(
      stopValue(
        [
          { position: 0, opacity: 0 },
          { position: 0.5, opacity: 0.2 },
          { position: 1, opacity: 1 },
        ],
        0.75,
      ) - 0.6,
    ) < 1e-12,
  );
  assert.equal(noise(10, 20, 3), noise(10, 20, 3));
  assert.notEqual(noise(10, 20, 3), noise(10, 20, 4));
});
test("preset masks must be ordered and bounded", () => {
  const d = scene(),
    f = fade();
  f.stops = [
    { position: 0.5, opacity: 0 },
    { position: 0.1, opacity: 1 },
  ];
  d.panels.p0.fades = [f];
  assert.throws(() => validate(d), /stops/);
});
test("brush drags and batch changes share one undo transaction across modes", () => {
  const d = scene();
  let h = createHistory(d);
  h = record(h, { ...d, opening: space(100) }, "drag");
  h = record(h, { ...d, opening: space(300) }, "drag");
  assert.equal(h.past.length, 1);
  h = undo(h);
  assert.equal(h.present.opening.height, 0);
  assert.equal(redo(h).present.opening.height, 300);
});
test("project backups enumerate composition snapshots and overlays once", () => {
  const d = scene();
  d.panels.p0.snapshot = { blobId: "shared", width: 1600, height: 800, revision: 2 };
  d.objects = [{ ...common("Overlay"), kind: "overlay", blobId: "shared" }];
  assert.equal(
    projectBlobIds(
      [{ ...chapter, composition: { version: 1, revision: 1, document: d } }],
      panels,
    ).filter((id) => id === "shared").length,
    1,
  );
});
test("editable package v3 round-trips complete scenes and source references", async () => {
  const d = scene();
  d.panels.p1.top.height = 300;
  d.objects = [{ ...sfx("SWISH"), owner: "p1", y: -80, rotation: 30 }, fx("Rain")];
  d.transitions = [transition()];
  const c = { ...chapter, composition: { version: 1, revision: 7, document: d } },
    blobs = new Map(
      panels.flatMap(
        (p) =>
          [
            [p.blobId, new Blob(["art"])],
            [p.thumbId, new Blob(["thumbnail"])],
          ] as [string, Blob][],
      ),
    );
  const restored = await decodeBackup(encodeBackup({ project, chapters: [c], panels, blobs }));
  assert.deepEqual(restored.chapters[0].composition, c.composition);
  assert.deepEqual(restored.panels, panels);
  assert.equal(restored.blobs.size, 6);
});
test("presets survive serialization and reject unsafe references", () => {
  const value = {
    presets: [
      { id: "preset", name: "White space", category: "spacing" as const, value: space(300) },
    ],
    favorites: ["sfx:Sharp Slash"],
  };
  validateCompositionPreferences(JSON.parse(JSON.stringify(value)));
  assert.throws(() =>
    validateCompositionPreferences({ ...value, favorites: [null] as unknown as string[] }),
  );
});
test("multilingual SFX preserve Unicode and choose script fonts and RTL direction", () => {
  for (const text of ["SWISH", "슉", "スッ", "حفيف", "💥"]) {
    const o = sfx(text);
    assert.equal(o.text, text);
    const d = scene();
    d.objects = [o];
    validate(d);
  }
  assert.equal(sfx("حفيف").direction, "rtl");
  assert.match(sfx("슉").font, /KR/);
});
test("requested SFX and FX catalogs are populated with distinct editable objects", () => {
  assert.equal(new Set(Object.values(SFX_CATEGORIES).flat()).size, 31);
  const names = Object.values(FX_CATEGORIES).flat();
  assert.equal(names.length, 38);
  for (const name of names) {
    const d = scene();
    d.objects = [fx(name)];
    validate(d);
  }
});
test("hundreds of tall panels compute layout without raster allocation", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    ...panels[0],
    id: `panel-${i}`,
    height: 32000,
    order: i,
  }));
  const d = createComposition(chapter, many),
    l = layout(d, many);
  assert.equal(l.frames.length, 500);
  assert.equal(l.height, 500 * 16000 + 499 * 20);
});

test("unified stacking moves sources and effects without changing chapter geometry", async () => {
  const { layerStack, moveLayer } = await import("./model.ts");
  const d = scene(),
    o = sfx();
  d.objects = [o];
  const before = layout(d, panels),
    stack = layerStack(d);
  assert.ok(stack.indexOf(`object:${o.id}`) > stack.indexOf("source:p2"));
  const moved = moveLayer(d, "source:p2", 1);
  assert.ok(layerStack(moved).indexOf("source:p2") > layerStack(moved).indexOf(`object:${o.id}`));
  assert.deepEqual(layout(moved, panels), before);
  validate(moved);
});
test("new imports enter the existing structural stack below global creative layers", async () => {
  const { layerStack } = await import("./model.ts");
  const d = scene(),
    o = sfx();
  d.objects = [o];
  d.layerOrder = layerStack(d);
  d.panels.newPanel = panelComposition(200);
  const stack = layerStack(d);
  assert.ok(stack.indexOf("source:newPanel") < stack.indexOf(`object:${o.id}`));
  assert.equal(new Set(stack).size, stack.length);
});

test("oversized export plans fail before allocating millions of segment records", () => {
  assert.throws(() => segmentRows(1e12, 128), /1000 segments/);
});

test("hidden or locked ancestors control all nested creative layers", async () => {
  const { objectFlags } = await import("./geometry.ts");
  const a = { ...common("A"), kind: "group" as const, locked: true },
    b = { ...common("B"), kind: "group" as const, parentId: a.id },
    c = { ...sfx(), parentId: b.id };
  assert.deepEqual(objectFlags(c, [a, b, c]), { visible: true, locked: true });
  a.visible = false;
  assert.deepEqual(objectFlags(c, [a, b, c]), { visible: false, locked: true });
});
test("creative hit testing follows unified stack order and respects parent clipping", async () => {
  const { pickCreative } = await import("./geometry.ts"),
    { layerStack } = await import("./model.ts");
  const d = scene(),
    o = { ...sfx(), x: 0, y: 0, owner: "p0" };
  d.objects = [o];
  const frames = layout(d, panels).frames;
  assert.equal(pickCreative(d, frames, { x: 100, y: 100 }, layerStack(d))?.id, o.id);
  d.layerOrder = [...layerStack(d).filter((k) => k !== "source:p0"), "source:p0"];
  assert.equal(
    pickCreative(d, frames, { x: 100, y: 100 }, d.layerOrder, d.layerOrder.length - 1),
    null,
  );
  o.y = -150;
  o.clip = true;
  assert.equal(pickCreative(d, frames, { x: 100, y: -50 }, layerStack(d)), null);
});
test("editable packages round-trip chapter lettering and saved bubble/text styles", async () => {
  const d = scene();
  const speech = { ...bubble("Standard dialogue"), owner: "p1", y: -60, rotation: 12 },
    vertical = { ...bubble("Japanese vertical"), x: 300, y: 40 },
    arabic = { ...bubble("Arabic dialogue"), owner: "p0" };
  d.objects = [speech, vertical, arabic];
  const preferences = {
    presets: [
      {
        id: "style",
        name: "Shout style",
        category: "bubble" as const,
        collection: "Bubble style",
        value: bubble("Shouting"),
      },
    ],
    favorites: ["bubble:Thought"],
  };
  const c = { ...chapter, composition: { version: 1, revision: 3, document: d } },
    blobs = new Map(
      panels.flatMap(
        (p) =>
          [
            [p.blobId, new Blob(["art"])],
            [p.thumbId, new Blob(["thumbnail"])],
          ] as [string, Blob][],
      ),
    );
  const restored = await decodeBackup(
    encodeBackup({
      project: { ...project, compositionPreferences: preferences },
      chapters: [c],
      panels,
      blobs,
    }),
  );
  assert.deepEqual(restored.chapters[0].composition, c.composition);
  assert.deepEqual(restored.project.compositionPreferences, preferences);
  // Bubbles carry no media, so no extra blobs are referenced.
  assert.equal(restored.blobs.size, panels.length * 2);
});
