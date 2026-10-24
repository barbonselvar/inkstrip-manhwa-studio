import test from "node:test";
import assert from "node:assert/strict";
import {
  BUBBLE_PRESETS,
  DEFAULT_LETTERING,
  validateBubble,
  validateDialogue,
  validateLettering,
  type BubbleSpec,
} from "../dialogue/types.ts";
import { bubbleContours } from "../dialogue/bubbles.ts";
import { layoutLettering, wrapLettering } from "../dialogue/lettering.ts";
import { fromPanel, layer, validateDocument, type Layer } from "./model.ts";
import { nativeFile, readNative } from "./files.ts";
const spec = (preset: BubbleSpec["preset"] = "speech"): BubbleSpec => ({
  version: 1,
  preset,
  padding: 12,
  tails: [],
});
const tail = (id = "tail1", attachment = 0.42) => ({
  id,
  attachment,
  width: 20,
  tip: { x: 240, y: 180 },
  curvature: 0.3,
  kind: "point" as const,
});
const text = (value: string): Layer => ({
  ...layer("text", 200, 100),
  text: value,
  fontSize: 20,
  lettering: { ...DEFAULT_LETTERING, padding: 0 },
  align: "left",
});
const measure = (s: string, size: number) => Array.from(s).length * size * 0.5;
for (const preset of BUBBLE_PRESETS)
  test(`bubble ${preset} produces a bounded editable closed cubic contour`, () => {
    const contours = bubbleContours(spec(preset), 240, 100);
    assert.equal(contours.length, 1);
    assert.equal(contours[0]!.closed, true);
    assert.ok(contours[0]!.anchors.length >= 4 && contours[0]!.anchors.length < 100);
    for (const a of contours[0]!.anchors)
      for (const p of [a, a.incoming!, a.outgoing!])
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });
test("pointed tails replace body intervals with continuous editable cubic geometry", () => {
  const base = spec(),
    withTail = { ...base, tails: [tail()] };
  const original = bubbleContours(base, 240, 100)[0]!,
    changed = bubbleContours(withTail, 240, 100)[0]!;
  assert.deepEqual(changed.anchors[0], original.anchors[0]);
  assert.ok(changed.anchors.some((a) => a.x === 240 && a.y === 180));
  assert.ok(changed.anchors.length > original.anchors.length);
  const multiple = bubbleContours(
    { ...base, tails: [tail(), { ...tail("tail2", 0.75), tip: { x: -80, y: 130 } }] },
    240,
    100,
  )[0]!;
  assert.ok(multiple.anchors.some((a) => a.x === -80 && a.y === 130));
  assert.ok(multiple.anchors.some((a) => a.x === 240 && a.y === 180));
});
test("thought trails are real vector contours in the parent's coordinate system", () => {
  const result = bubbleContours(
    { ...spec("thought"), tails: [{ ...tail(), kind: "dots" }] },
    240,
    100,
  );
  assert.equal(result.length, 4);
  assert.ok(result[3]!.anchors.some((p) => p.x >= 240));
});
test("overlapping attachments and invalid dimensions fail without modifying input", () => {
  const input = { ...spec(), tails: [tail(), tail("other", 0.42)] },
    before = JSON.stringify(input);
  assert.throws(() => bubbleContours(input, 240, 100), /overlap/);
  assert.equal(JSON.stringify(input), before);
  for (const [width, height] of [
    [NaN, 2],
    [2, Infinity],
    [0, 20],
    [20000, 3],
  ])
    assert.throws(() => bubbleContours(spec(), width!, height!));
  assert.throws(() =>
    validateBubble({ ...spec(), tails: Array.from({ length: 9 }, (_, i) => tail(String(i))) }),
  );
});
test("word wrapping and manual paragraph breaks preserve complete text", () => {
  const settings = { ...DEFAULT_LETTERING, fit: false };
  const lines = wrapLettering("alpha beta\ngamma", 50, 20, settings, measure);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["alpha", "beta", "gamma"],
  );
  assert.deepEqual(
    lines.map((l) => l.paragraphEnd),
    [false, true, true],
  );
});
test("grapheme-safe wrapping never splits combining or joined emoji clusters", () => {
  const lines = wrapLettering("Á👩‍👩‍👧‍👧", 1, 20, DEFAULT_LETTERING, measure);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["Á", "👩‍👩‍👧‍👧"],
  );
});
test("Arabic lines remain intact for native contextual shaping and bidi layout", () => {
  const l = text("مرحبا بالعالم");
  l.width = 500;
  l.lettering = { ...DEFAULT_LETTERING, language: "ar", direction: "rtl", padding: 4 };
  const out = layoutLettering(l, measure);
  assert.equal(out.runs.length, 1);
  assert.equal(out.runs[0]!.text, l.text);
});
test("fit-to-box decreases size and keeps explicit overflow when even minimum cannot fit", () => {
  const l = text("Many words to fit inside a small speech bubble");
  l.width = 80;
  l.height = 40;
  const out = layoutLettering(l, measure);
  assert.ok(out.fontSize < 20);
  assert.equal(out.overflow, false);
  l.height = 1;
  l.width = 1;
  assert.equal(layoutLettering(l, measure).overflow, true);
});
test("Japanese vertical columns progress from right to left and preserve source text", () => {
  const l = text("あいうえお");
  l.height = 65;
  l.lettering = {
    ...DEFAULT_LETTERING,
    language: "ja",
    writing: "vertical",
    fit: false,
    padding: 0,
  };
  const before = l.text,
    out = layoutLettering(l, measure);
  assert.equal(out.runs.length, 5);
  assert.ok(out.runs[2]!.x < out.runs[0]!.x);
  assert.equal(l.text, before);
  assert.throws(
    () => validateLettering({ ...DEFAULT_LETTERING, language: "ar", writing: "vertical" }),
    /Japanese/,
  );
});
test("new metadata rejects unsafe fonts, malformed OCR and duplicate presets", () => {
  assert.throws(() =>
    validateLettering({ ...DEFAULT_LETTERING, font: "url(https://evil.invalid/font)" }),
  );
  assert.throws(() =>
    validateDialogue({ version: 1, regions: [{ id: "bad" }] as never, presets: [] }),
  );
  assert.throws(() => validateDocument(null as never), /Unsupported/);
});
test("dialogue emits guarded native v7, restores editable metadata and leaves legacy v1 alone", async () => {
  const document = fromPanel({
    id: "dialogue-page",
    name: "Dialogue test",
    width: 240,
    height: 180,
  });
  document.layers = [];
  const l = text("Hello 세계");
  l.dialogueRole = "text";
  document.layers.push(l);
  document.dialogue = { version: 1, regions: [], presets: [] };
  document.source = undefined;
  const s = { document, assets: {}, revision: 0, acceptedBlobId: "source", updatedAt: 1 };
  validateDocument(document);
  const blob = await nativeFile(s),
    encoded = JSON.parse(await blob.text());
  assert.equal(encoded.version, 7);
  const restored = await readNative(blob, "reopened-page", "source");
  assert.deepEqual(restored.document.layers[0]!.lettering, l.lettering);
  assert.equal(restored.document.layers[0]!.text, l.text);
  assert.equal(restored.document.panelId, "reopened-page");
  const old = { ...document, dialogue: undefined, layers: [] };
  const legacy = JSON.parse(await (await nativeFile({ ...s, document: old })).text());
  assert.equal(legacy.version, 1);
});

test("bubble groups share real native layers, duplicate associations and clean export visibility", async () => {
  const { createBubble, cleanView, updateBubble, textFor } =
    await import("../dialogue/operations.ts");
  const { duplicateLayers } = await import("./layers.ts");
  const d = fromPanel({ id: "page", name: "page", width: 1000, height: 800 });
  const result = createBubble(d, "speech"),
    body = result.document.layers.find((l) => l.bubble)!,
    attached = textFor(result.document, result.id)!;
  assert.equal(d.layers.length, 1);
  assert.equal(result.document.layers.length, 4);
  assert.equal(body.bubble!.textId, attached.id);
  assert.ok(body.anchors.some((a) => a.y > body.height));
  const duplicated = duplicateLayers(result.document, [result.id]);
  const copied = duplicated.document.layers.find((l) => l.id !== body.id && l.bubble)!;
  assert.notEqual(copied.bubble!.textId, attached.id);
  assert.ok(duplicated.document.layers.some((l) => l.id === copied.bubble!.textId));
  const updated = updateBubble(result.document, body.id, { width: 400 });
  assert.equal(updated.layers.find((l) => l.id === body.id)!.width, 400);
  assert.notEqual(updated.layers.find((l) => l.id === attached.id)!.width, attached.width);
  const clean = cleanView(result.document);
  assert.equal(clean.layers[0]!.visible, true);
  assert.ok(
    clean.layers
      .filter((l) => l.dialogueRole === "bubble" || l.dialogueRole === "text")
      .every((l) => !l.visible),
  );
  assert.equal(result.document.layers.find((l) => l.id === body.id)!.visible, true);
});
test("direct outline editing and deleting attached text reconcile safely without losing other objects", async () => {
  const { createBubble, reconcileDialogue } = await import("../dialogue/operations.ts");
  const d = fromPanel({ id: "page", name: "page", width: 1000, height: 800 });
  const { document } = createBubble(d, "speech");
  const body = document.layers.find((l) => l.bubble)!;
  const next = structuredClone(document);
  next.layers.find((l) => l.id === body.id)!.anchors[0]!.x += 3;
  const custom = reconcileDialogue(document, next);
  assert.equal(custom.layers.find((l) => l.id === body.id)!.bubble, undefined);
  assert.equal(custom.layers.length, document.layers.length);
  const removed = reconcileDialogue(document, {
    ...document,
    layers: document.layers.filter((l) => l.id !== body.bubble!.textId),
  });
  assert.equal(removed.layers.find((l) => l.id === body.id)!.bubble!.textId, undefined);
  validateDocument(removed);
});
test("flat cleanup samples real boundary pixels, rejects texture and preserves protected source", async () => {
  const { flatBackground, cleanupProposal } = await import("../dialogue/cleanup.ts");
  const data = new Uint8ClampedArray(32 * 32 * 4).fill(255);
  for (let y = 10; y < 20; y++)
    for (let x = 10; x < 20; x++) data.set([0, 0, 0, 255], (y * 32 + x) * 4);
  const original = data.slice();
  assert.equal(flatBackground({ width: 32, height: 32, data }).color, "#ffffff");
  assert.deepEqual(data, original);
  const d = fromPanel({ id: "page", name: "page", width: 100, height: 100 }),
    frame = { x: 15, y: 25, width: 32, height: 32 };
  const p = cleanupProposal(d, frame, "#ffffff");
  assert.equal(d.layers.length, 1);
  assert.equal(p.document.layers.length, 2);
  assert.equal(p.document.layers.at(-1)!.transform.x, 15);
  assert.equal(p.document.source!.assetId, d.source!.assetId);
  data[3] = 0;
  assert.throws(() => flatBackground({ width: 32, height: 32, data }), /opaque/);
  for (let i = 0; i < data.length; i += 4) data.set([i % 256, (i * 7) % 256, 10, 255], i);
  assert.throws(() => flatBackground({ width: 32, height: 32, data }), /textured/);
});
test("unreleased AI provenance is explicitly protected rather than silently serialized by the older integration baseline", async () => {
  const { validateAssets } = await import("./model.ts");
  const document = fromPanel({ id: "p", name: "p", width: 32, height: 32 });
  Object.assign(document.layers[0]!, { ai: { sourceAssetId: "source" } });
  assert.throws(
    () =>
      validateAssets({
        document,
        assets: { source: new Blob(["x"], { type: "image/png" }) },
        revision: 0,
        acceptedBlobId: "s",
        updatedAt: 1,
      }),
    /unreleased AI Studio/,
  );
});

test("dangling bubble text references are rejected before a native document is installed", async () => {
  const { createBubble } = await import("../dialogue/operations.ts");
  const d = createBubble(
    fromPanel({ id: "page", name: "Source", width: 640, height: 480 }),
    "speech",
  ).document;
  const body = d.layers.find((l) => l.bubble)!;
  body.bubble!.textId = "missing";
  assert.throws(() => validateDocument(d), /missing text layer/);
});

test("custom dialogue presets preserve editable opacity, dashes, effects and text styling", async () => {
  const { createBubble } = await import("../dialogue/operations.ts"),
    { presetStyles } = await import("../dialogue/types.ts"),
    { defaultEffect } = await import("./effects.ts");
  const original = createBubble(
    fromPanel({ id: "p", name: "Page", width: 640, height: 480 }),
    "speech",
  ).document;
  const body = original.layers.find((l) => l.bubble)!,
    text = original.layers.find((l) => l.lettering)!;
  Object.assign(body, {
    opacity: 0.6,
    fillOpacity: 0.4,
    dash: [7, 4],
    effects: [defaultEffect("dropShadow")],
  });
  Object.assign(text, {
    opacity: 0.8,
    stroke: "#336699",
    strokeWidth: 2,
    fontWeight: 700,
    lineHeight: 1.7,
    letterSpacing: 2,
  });
  const preset = {
    id: "preset",
    name: "Styled speech",
    width: body.width,
    height: body.height,
    bubble: structuredClone(body.bubble!),
    fill: body.fill,
    stroke: body.stroke,
    strokeWidth: body.strokeWidth,
    textColor: text.fill,
    fontSize: text.fontSize,
    lettering: text.lettering!,
    ...presetStyles(body, text),
  };
  validateDialogue({ version: 1, regions: [], presets: [preset] });
  const next = createBubble(original, "speech", preset).document,
    cloned = next.layers.at(-2)!,
    lettering = next.layers.at(-1)!;
  assert.equal(cloned.width, body.width);
  assert.equal(cloned.height, body.height);
  assert.equal(cloned.opacity, 0.6);
  assert.equal(cloned.fillOpacity, 0.4);
  assert.deepEqual(cloned.dash, [7, 4]);
  assert.deepEqual(cloned.effects, body.effects);
  assert.equal(lettering.fontWeight, 700);
  assert.equal(lettering.stroke, "#336699");
  assert.equal(lettering.lineHeight, 1.7);
  assert.notEqual(cloned.effects, body.effects);
  assert.throws(() =>
    validateDialogue({
      version: 1,
      regions: [],
      presets: [{ ...preset, bodyStyle: { opacity: Infinity } }],
    }),
  );
});

test("bubble and text editing respect own and inherited layer locks without changing the source", async () => {
  const { createBubble, updateBubble, updateLettering } = await import("../dialogue/operations.ts");
  const r = createBubble(fromPanel({ id: "p", name: "Page", width: 640, height: 480 }), "speech"),
    locked = {
      ...r.document,
      layers: r.document.layers.map((l) => (l.id === r.id ? { ...l, locked: true } : l)),
    },
    before = JSON.stringify(locked);
  assert.throws(() => updateBubble(locked, r.id, { fill: "#000000" }), /Unlock/);
  assert.throws(() => updateLettering(locked, r.id, { text: "Changed" }), /Unlock/);
  assert.equal(JSON.stringify(locked), before);
});

test("explicit rasterization retains dialogue classification but removes obsolete parametric controls", async () => {
  const { createBubble, reconcileDialogue } = await import("../dialogue/operations.ts");
  const original = createBubble(
    fromPanel({ id: "p", name: "Page", width: 640, height: 480 }),
    "speech",
  ).document;
  const body = original.layers.find((l) => l.bubble)!;
  const next = reconcileDialogue(original, {
    ...original,
    layers: original.layers.map((l) => (l.id === body.id ? { ...l, kind: "raster" as const } : l)),
  });
  assert.equal(next.layers.find((l) => l.id === body.id)!.bubble, undefined);
  assert.equal(next.layers.find((l) => l.id === body.id)!.dialogueRole, "bubble");
});

test("review approval matches actual lettering and manual text edits return the region to review", async () => {
  const { createText, canApproveRegion, reconcileDialogue } =
    await import("../dialogue/operations.ts");
  const result = createText(
      fromPanel({ id: "p", name: "Page", width: 640, height: 480 }),
      "Approved text",
    ),
    r = {
      id: "region",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      sourceLanguage: "en" as const,
      targetLanguage: "en" as const,
      original: "Source",
      corrected: "Source",
      replacement: "Approved text",
      status: "lettered" as const,
      layerId: result.id,
    };
  const d = { ...result.document, dialogue: { version: 1 as const, regions: [r], presets: [] } };
  assert.equal(canApproveRegion(d, r), true);
  assert.equal(canApproveRegion(d, { ...r, replacement: "Not applied" }), false);
  const edited = reconcileDialogue(d, {
    ...d,
    layers: d.layers.map((l) => (l.id === result.id ? { ...l, text: "Manual edit" } : l)),
  });
  assert.equal(edited.dialogue!.regions[0]!.replacement, "Manual edit");
  assert.equal(edited.dialogue!.regions[0]!.status, "corrected");
  assert.equal(canApproveRegion(edited, edited.dialogue!.regions[0]!), false);
});
