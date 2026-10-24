import { isLocked } from "../pro/operations.ts";
import { layer, validateDocument, type Layer, type ProDocument } from "../pro/model.ts";
import { applyMatrix, affine } from "../pro/transform.ts";
import { bubbleContours } from "./bubbles.ts";
import {
  DEFAULT_LETTERING,
  type BubbleSpec,
  type BubblePreset,
  type DialoguePreset,
  type DialogueRegion,
  type Lettering,
} from "./types.ts";
export function dialogueData(d: ProDocument) {
  return d.dialogue ?? { version: 1 as const, regions: [], presets: [] };
}
export function bubbleLayer(l: Layer): Layer {
  if (!l.bubble) throw Error("Select a parametric speech bubble.");
  const contours = bubbleContours(l.bubble, l.width, l.height),
    first = contours[0]!;
  return {
    ...l,
    shape: "path",
    closed: true,
    anchors: first.anchors,
    subpaths: contours.slice(1),
    vectorOverflow: true,
    pathData: undefined,
  };
}

function textBox(body: Layer) {
  const preset = body.bubble?.preset ?? "custom";
  const ratio = ["rectangle", "square", "narration", "caption", "rounded"].includes(preset)
    ? [0.84, 0.78]
    : ["shout", "scream", "jagged", "burst"].includes(preset)
      ? [0.56, 0.36]
      : ["thought", "cloud"].includes(preset)
        ? [0.68, 0.46]
        : [0.78, 0.5];
  const pad = Math.min(body.bubble?.padding ?? 0, Math.min(body.width, body.height) * 0.1);
  const width = Math.max(1, body.width * ratio[0]! - pad * 2),
    height = Math.max(1, body.height * ratio[1]! - pad * 2);
  return { x: (body.width - width) / 2, y: (body.height - height) / 2, width, height };
}
export function createBubble(d: ProDocument, preset: BubblePreset, custom?: DialoguePreset) {
  const w = Math.max(1, Math.min(d.width * 0.65, Math.max(100, d.width * 0.32))),
    h = Math.max(1, Math.min(d.height * 0.4, w * 0.6));
  const group = layer("group", d.width, d.height),
    body = layer(
      "shape",
      custom?.width ?? (preset === "circle" || preset === "square" ? h : w),
      custom?.height ?? h,
    ),
    text = layer("text", Math.max(1, body.width * 0.78), Math.max(1, h * 0.7));
  group.name = `${preset} dialogue`;
  group.dialogueRole = "group";
  body.name = `${preset} bubble`;
  body.parentId = group.id;
  body.dialogueRole = "bubble";
  body.fill = custom?.fill ?? "#ffffff";
  body.stroke = custom?.stroke ?? "#111111";
  body.strokeWidth = custom?.strokeWidth ?? Math.max(1, Math.min(4, d.width * 0.002));
  const withTail = ![
    "rectangle",
    "rounded",
    "square",
    "circle",
    "oval",
    "caption",
    "narration",
    "custom",
  ].includes(preset);
  if (custom?.bodyStyle) Object.assign(body, structuredClone(custom.bodyStyle));
  body.bubble = custom
    ? structuredClone(custom.bubble)
    : {
        version: 1,
        preset,
        padding: Math.min(12, h * 0.03),
        tails: withTail
          ? [
              {
                id: crypto.randomUUID(),
                attachment: 0.42,
                width: Math.max(2, body.width * 0.1),
                tip: { x: body.width * 0.8, y: h * 1.3 },
                curvature: 0,
                kind: preset === "thought" ? "dots" : "point",
              },
            ]
          : [],
      };
  body.bubble.textId = text.id;
  body.transform.x = (d.width - body.width) / 2;
  body.transform.y = Math.max(0, d.height * 0.1);
  if (preset === "whisper" && custom?.bodyStyle?.dash === undefined) body.dash = [3, 3];
  text.name = "Dialogue text";
  text.parentId = group.id;
  text.dialogueRole = "text";
  text.text = "Your dialogue.";
  text.fill = custom?.textColor ?? "#111111";
  text.strokeWidth = 0;
  text.fontSize = custom?.fontSize ?? Math.max(6, Math.min(36, h * 0.18));
  text.fontWeight = 500;
  text.align = "center";
  text.lettering = custom
    ? structuredClone(custom.lettering)
    : { ...DEFAULT_LETTERING, padding: 2 };
  if (custom?.textStyle) Object.assign(text, structuredClone(custom.textStyle));
  const box = textBox(body);
  text.width = box.width;
  text.height = box.height;
  text.transform.x = body.transform.x + box.x;
  text.transform.y = body.transform.y + box.y;
  let outlined = bubbleLayer(body);
  if (custom?.contours?.length && custom.width && custom.height) {
    const sx = body.width / custom.width,
      sy = body.height / custom.height;
    const contours = custom.contours.map((c) => ({
      ...c,
      anchors: c.anchors.map((a) => ({
        ...a,
        x: a.x * sx,
        y: a.y * sy,
        incoming: a.incoming && { x: a.incoming.x * sx, y: a.incoming.y * sy },
        outgoing: a.outgoing && { x: a.outgoing.x * sx, y: a.outgoing.y * sy },
      })),
    }));
    outlined = {
      ...outlined,
      bubble: undefined,
      anchors: contours[0]!.anchors,
      closed: contours[0]!.closed,
      subpaths: contours.slice(1),
    };
  }
  const next = { ...d, dialogue: dialogueData(d), layers: [...d.layers, group, outlined, text] };
  validateDocument(next);
  return { document: next, id: group.id };
}
export function createText(d: ProDocument, value = "Your text.") {
  const l = layer("text", Math.max(1, d.width * 0.6), Math.max(1, Math.min(d.height * 0.3, 160)));
  l.transform.x = d.width * 0.2;
  l.transform.y = d.height * 0.2;
  l.text = value;
  l.name = "Independent dialogue text";
  l.fill = "#111111";
  l.fontSize = Math.max(6, Math.min(32, d.width * 0.06));
  l.align = "center";
  l.dialogueRole = "text";
  l.lettering = { ...DEFAULT_LETTERING, padding: 4 };
  const next = { ...d, dialogue: dialogueData(d), layers: [...d.layers, l] };
  validateDocument(next);
  return { document: next, id: l.id };
}
export function bubbleFor(d: ProDocument, id: string) {
  const l = d.layers.find((l) => l.id === id);
  return l?.bubble || l?.dialogueRole === "bubble"
    ? l
    : l?.kind === "group"
      ? d.layers.find((v) => v.parentId === id && (v.bubble || v.dialogueRole === "bubble"))
      : l?.parentId
        ? d.layers.find(
            (v) => v.parentId === l.parentId && (v.bubble || v.dialogueRole === "bubble"),
          )
        : undefined;
}
export function textFor(d: ProDocument, id: string) {
  const l = d.layers.find((l) => l.id === id);
  if (l?.kind === "text") return l;
  const body = bubbleFor(d, id);
  return body?.bubble?.textId
    ? d.layers.find((l) => l.id === body.bubble!.textId && l.kind === "text")
    : body?.parentId
      ? d.layers.find(
          (v) => v.parentId === body.parentId && v.kind === "text" && v.dialogueRole === "text",
        )
      : undefined;
}
export function updateBubble(
  d: ProDocument,
  id: string,
  patch: Partial<Layer>,
  spec?: Partial<BubbleSpec>,
) {
  const old = bubbleFor(d, id);
  if (!old?.bubble) throw Error("Select a bubble.");
  if (isLocked(d, old.id)) throw Error("Unlock the bubble in Layers before editing it.");
  if (old.transform.deform && (patch.width !== undefined || patch.height !== undefined))
    throw Error("Use Free Transform to resize this deformed bubble without discarding its mesh.");
  const changed = bubbleLayer({ ...old, ...patch, bubble: { ...old.bubble, ...spec } });
  const layoutChanged =
    changed.width !== old.width ||
    changed.height !== old.height ||
    changed.bubble!.padding !== old.bubble.padding;
  const matrix = affine(changed.transform),
    box = textBox(changed),
    position = applyMatrix(matrix, { x: box.x, y: box.y });
  const layers = d.layers.map((l) =>
    l.id === old.id
      ? changed
      : layoutChanged && l.id === old.bubble!.textId
        ? {
            ...l,
            width: box.width,
            height: box.height,
            transform: { ...l.transform, x: position.x, y: position.y },
          }
        : l,
  );
  const next = { ...d, layers };
  validateDocument(next);
  return next;
}
export function updateLettering(
  d: ProDocument,
  id: string,
  patch: Partial<Layer>,
  settings?: Partial<Lettering>,
) {
  const l = textFor(d, id);
  if (!l) throw Error("Select a text layer.");
  if (isLocked(d, l.id)) throw Error("Unlock the text in Layers before editing it.");
  const next = {
    ...d,
    layers: d.layers.map((v) =>
      v.id === l.id
        ? { ...v, ...patch, lettering: { ...(v.lettering ?? DEFAULT_LETTERING), ...settings } }
        : v,
    ),
  };
  validateDocument(next);
  return next;
}
/** Reconcile intentional direct-anchor edits and layer deletions without losing review text. */
export function reconcileDialogue(previous: ProDocument, next: ProDocument): ProDocument {
  if (!previous.dialogue && !next.dialogue) return next;
  const ids = new Set(next.layers.map((l) => l.id));
  const layers = next.layers.map((l) => {
    if (l.kind !== "shape" && l.bubble) return { ...l, bubble: undefined };
    if (l.kind !== "text" && l.lettering) return { ...l, lettering: undefined };
    if (!l.bubble) return l;
    const old = previous.layers.find((v) => v.id === l.id);
    if (
      old?.bubble &&
      JSON.stringify(old.bubble) === JSON.stringify(l.bubble) &&
      JSON.stringify([old.anchors, old.subpaths]) !== JSON.stringify([l.anchors, l.subpaths])
    )
      return { ...l, bubble: undefined, name: l.name.replace(/ bubble$/, " custom path") };
    if (l.bubble.textId && !ids.has(l.bubble.textId))
      return { ...l, bubble: { ...l.bubble, textId: undefined } };
    return l;
  });
  return {
    ...next,
    layers,
    dialogue: {
      ...dialogueData(next),
      regions: dialogueData(next).regions.map((r) => ({
        ...r,
        ...(() => {
          const current = layers.find((l) => l.id === r.layerId),
            old = previous.layers.find((l) => l.id === r.layerId);
          if (
            current?.kind === "text" &&
            old?.kind === "text" &&
            (current.text !== old.text ||
              current.lettering?.language !== old.lettering?.language) &&
            (r.replacement !== current.text ||
              (current.lettering && r.targetLanguage !== current.lettering.language))
          )
            return {
              replacement: current.text,
              targetLanguage: current.lettering?.language ?? r.targetLanguage,
              status: "corrected" as const,
            };
          return {};
        })(),
        ...(r.layerId && !ids.has(r.layerId)
          ? { layerId: undefined, status: "corrected" as const }
          : {}),
        ...(r.cleanupLayerId && !ids.has(r.cleanupLayerId)
          ? { cleanupLayerId: undefined, status: "corrected" as const }
          : {}),
      })),
    },
  };
}
export function canApproveRegion(d: ProDocument, r: DialogueRegion) {
  const l = d.layers.find((l) => l.id === r.layerId);
  return (
    r.status === "lettered" &&
    !!l &&
    l.kind === "text" &&
    l.text === r.replacement &&
    (l.lettering?.language ?? r.targetLanguage) === r.targetLanguage
  );
}
export function cleanView(d: ProDocument, includeCleanup = true) {
  return {
    ...d,
    layers: d.layers.map((l) =>
      ["bubble", "text"].includes(l.dialogueRole ?? "") ||
      (!includeCleanup && l.dialogueRole === "cleanup")
        ? { ...l, visible: false }
        : l,
    ),
  };
}
