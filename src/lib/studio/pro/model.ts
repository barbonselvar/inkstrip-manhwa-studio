import type { Adjustments } from "../editor/adjustments";
import { NEUTRAL, validateAdjustments } from "../editor/adjustments.ts";
export type Point = { x: number; y: number };
export type Transform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
export type Anchor = Point & { incoming?: Point; outgoing?: Point };
export type Region = {
  kind: "rectangle" | "ellipse" | "lasso";
  points: Point[];
  operation: "add" | "subtract" | "intersect";
};
export type Selection = { regions: Region[]; inverted: boolean; feather: number };
export type Stroke = {
  points: Point[];
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  color: string;
  erase: boolean;
  clip?: Selection;
};
export type Mask = { selection: Selection; strokes: Stroke[]; enabled: boolean };
export type Shape =
  | "rectangle"
  | "ellipse"
  | "line"
  | "polygon"
  | "path"
  | "bubble"
  | "thought"
  | "shout"
  | "caption";
export type Layer = {
  id: string;
  name: string;
  kind: "raster" | "paint" | "shape" | "text" | "group";
  parentId?: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: "source-over" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
  width: number;
  height: number;
  transform: Transform;
  mask?: Mask;
  assetId?: string;
  strokes: Stroke[];
  adjustments: Adjustments;
  hue: number;
  black: number;
  white: number;
  gamma: number;
  curve: number[];
  shape: Shape;
  fill: string;
  stroke: string;
  strokeWidth: number;
  anchors: Anchor[];
  closed: boolean;
  pathData?: string;
  tail: Point;
  text: string;
  fontFamily: "Arial" | "Georgia" | "monospace";
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  align: "left" | "center" | "right";
};
export type ProDocument = {
  version: 1;
  id: string;
  name: string;
  panelId: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
};
export type ProSession = {
  document: ProDocument;
  assets: Record<string, Blob>;
  revision: number;
  acceptedBlobId: string;
  updatedAt: number;
};
export const TRANSFORM: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
export const EMPTY_SELECTION: Selection = { regions: [], inverted: false, feather: 0 };
export const MAX_LAYERS = 48,
  MAX_ASSET_BYTES = 48_000_000;
export function layer(
  kind: Layer["kind"],
  width: number,
  height: number,
  id: string = crypto.randomUUID(),
): Layer {
  return {
    id,
    kind,
    name: `${kind[0]!.toUpperCase()}${kind.slice(1)}`,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "source-over",
    width,
    height,
    transform: { ...TRANSFORM },
    strokes: [],
    adjustments: { ...NEUTRAL },
    hue: 0,
    black: 0,
    white: 255,
    gamma: 1,
    curve: [0, 64, 128, 192, 255],
    shape: "rectangle",
    fill: "#f3efe6",
    stroke: "#172420",
    strokeWidth: 3,
    anchors: [],
    closed: false,
    tail: { x: width * 0.72, y: height * 1.3 },
    text: "Your story begins here.",
    fontFamily: "Arial",
    fontSize: 32,
    fontWeight: 400,
    lineHeight: 1.3,
    letterSpacing: 0,
    align: "left",
  };
}
export function fromPanel(
  panel: { id: string; name: string; width: number; height: number },
  assetId = "source",
): ProDocument {
  const base = layer("raster", panel.width, panel.height);
  base.name = "Imported artwork";
  base.assetId = assetId;
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: panel.name,
    panelId: panel.id,
    width: panel.width,
    height: panel.height,
    background: "transparent",
    layers: [base],
  };
}
const finite = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const point = (p: Point) => p && finite(p.x, -100000, 100000) && finite(p.y, -100000, 100000);
export const validColor = (s: unknown) =>
  typeof s === "string" && /^(?:#[0-9a-f]{6}|transparent)$/i.test(s);
export function validateSelection(s: Selection) {
  if (
    !s ||
    !Array.isArray(s.regions) ||
    s.regions.length > 100 ||
    typeof s.inverted !== "boolean" ||
    !finite(s.feather, 0, 100)
  )
    throw new Error("Invalid selection.");
  for (const r of s.regions)
    if (
      !r ||
      !["rectangle", "ellipse", "lasso"].includes(r.kind) ||
      !["add", "subtract", "intersect"].includes(r.operation) ||
      !Array.isArray(r.points) ||
      r.points.length < 2 ||
      r.points.length > 5000 ||
      !r.points.every(point)
    )
      throw new Error("Invalid selection region.");
}
function validateStroke(s: Stroke) {
  if (
    !s ||
    !Array.isArray(s.points) ||
    s.points.length < 1 ||
    s.points.length > 10000 ||
    !s.points.every(point) ||
    !finite(s.size, 1, 1000) ||
    !finite(s.hardness, 0, 1) ||
    !finite(s.opacity, 0, 1) ||
    !finite(s.flow, 0.01, 1) ||
    !validColor(s.color) ||
    typeof s.erase !== "boolean"
  )
    throw new Error("Invalid brush stroke.");
  if (s.clip) validateSelection(s.clip);
}
export function validateDocument(d: ProDocument) {
  if (
    !d ||
    d.version !== 1 ||
    typeof d.id !== "string" ||
    !d.id ||
    typeof d.panelId !== "string" ||
    typeof d.name !== "string" ||
    d.name.length > 200 ||
    !finite(d.width, 1, 16384) ||
    !Number.isInteger(d.width) ||
    !finite(d.height, 1, 16384) ||
    !Number.isInteger(d.height) ||
    d.width * d.height > 16_000_000 ||
    !validColor(d.background) ||
    !Array.isArray(d.layers) ||
    d.layers.length > MAX_LAYERS
  )
    throw new Error(
      "Unsupported or oversized Pro document (up to 48 layers / 16 megapixels / 16384px per side).",
    );
  const ids = new Set<string>();
  let commands = 0;
  for (const l of d.layers) {
    if (
      !l ||
      typeof l.id !== "string" ||
      !l.id ||
      ids.has(l.id) ||
      typeof l.name !== "string" ||
      l.name.length > 100 ||
      !["raster", "paint", "shape", "text", "group"].includes(l.kind) ||
      typeof l.visible !== "boolean" ||
      typeof l.locked !== "boolean" ||
      !finite(l.opacity, 0, 1) ||
      !["source-over", "multiply", "screen", "overlay", "darken", "lighten"].includes(l.blend) ||
      !finite(l.width, 1, 16384) ||
      !finite(l.height, 1, 16384) ||
      l.width * l.height > 16_000_000
    )
      throw new Error("Invalid or oversized layer.");
    ids.add(l.id);
    const t = l.transform;
    if (
      !t ||
      !point(t) ||
      !finite(t.scaleX, 0.01, 100) ||
      !finite(t.scaleY, 0.01, 100) ||
      !finite(t.rotation, -360, 360)
    )
      throw new Error("Invalid layer transform.");
    validateAdjustments(l.adjustments);
    if (
      !finite(l.hue, -180, 180) ||
      !finite(l.black, 0, 254) ||
      !finite(l.white, 1, 255) ||
      l.black >= l.white ||
      !finite(l.gamma, 0.1, 5) ||
      !Array.isArray(l.curve) ||
      l.curve.length !== 5 ||
      !l.curve.every((n) => finite(n, 0, 255))
    )
      throw new Error("Invalid levels or tone curve.");
    if (
      !Array.isArray(l.strokes) ||
      l.strokes.length > 1000 ||
      !Array.isArray(l.anchors) ||
      l.anchors.length > 1000
    )
      throw new Error("Too many editing commands.");
    for (const s of l.strokes) {
      validateStroke(s);
      commands += s.points.length;
    }
    if (l.mask) {
      validateSelection(l.mask.selection);
      if (
        !Array.isArray(l.mask.strokes) ||
        l.mask.strokes.length > 1000 ||
        typeof l.mask.enabled !== "boolean"
      )
        throw new Error("Invalid layer mask.");
      for (const s of l.mask.strokes) {
        validateStroke(s);
        commands += s.points.length;
      }
    }
    for (const a of l.anchors)
      if (!point(a) || (a.incoming && !point(a.incoming)) || (a.outgoing && !point(a.outgoing)))
        throw new Error("Invalid path anchor.");
    if (
      ![
        "rectangle",
        "ellipse",
        "line",
        "polygon",
        "path",
        "bubble",
        "thought",
        "shout",
        "caption",
      ].includes(l.shape) ||
      !validColor(l.fill) ||
      !validColor(l.stroke) ||
      !finite(l.strokeWidth, 0, 100) ||
      !point(l.tail) ||
      typeof l.closed !== "boolean" ||
      (l.pathData !== undefined &&
        (typeof l.pathData !== "string" ||
          l.pathData.length > 100000 ||
          !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]*$/.test(l.pathData)))
    )
      throw new Error("Invalid vector geometry.");
    if (
      typeof l.text !== "string" ||
      l.text.length > 5000 ||
      !["Arial", "Georgia", "monospace"].includes(l.fontFamily) ||
      !finite(l.fontSize, 1, 1000) ||
      !finite(l.fontWeight, 100, 900) ||
      !finite(l.lineHeight, 0.5, 3) ||
      !finite(l.letterSpacing, -20, 100) ||
      !["left", "center", "right"].includes(l.align)
    )
      throw new Error("Invalid text properties.");
  }
  if (commands > 100000)
    throw new Error(
      "Document brush history is too large; export a composite or use fewer strokes.",
    );
  for (const l of d.layers) {
    let parent = l.parentId,
      depth = 0;
    const seen = new Set([l.id]);
    while (parent) {
      const p = d.layers.find((x) => x.id === parent);
      if (!p || p.kind !== "group" || seen.has(parent) || ++depth > 3)
        throw new Error("Invalid or excessively nested layer group.");
      seen.add(parent);
      parent = p.parentId;
    }
  }
}
export function validateAssets(session: ProSession) {
  validateDocument(session.document);
  let total = 0;
  for (const [id, b] of Object.entries(session.assets)) {
    if (!id || !(b instanceof Blob) || !["image/png", "image/jpeg", "image/webp"].includes(b.type))
      throw new Error("Only PNG, JPEG and WebP raster assets are supported.");
    total += b.size;
  }
  if (total > MAX_ASSET_BYTES) throw new Error("Pro assets exceed the 48MB document limit.");
  for (const l of session.document.layers)
    if (l.kind === "raster" && (!l.assetId || !session.assets[l.assetId]))
      throw new Error("A raster source is missing; existing artwork is unchanged.");
}
export function localPoint(p: Point, l: Layer): Point {
  const r = (-l.transform.rotation * Math.PI) / 180,
    x = p.x - l.transform.x,
    y = p.y - l.transform.y;
  return {
    x: (x * Math.cos(r) - y * Math.sin(r)) / l.transform.scaleX,
    y: (x * Math.sin(r) + y * Math.cos(r)) / l.transform.scaleY,
  };
}
export function worldPoint(p: Point, l: Layer): Point {
  const r = (l.transform.rotation * Math.PI) / 180,
    x = p.x * l.transform.scaleX,
    y = p.y * l.transform.scaleY;
  return {
    x: l.transform.x + x * Math.cos(r) - y * Math.sin(r),
    y: l.transform.y + x * Math.sin(r) + y * Math.cos(r),
  };
}
export function pathData(l: Layer): string {
  if (l.pathData) return l.pathData;
  const a = l.anchors;
  if (!a.length) return "";
  let result = `M${a[0]!.x} ${a[0]!.y}`;
  for (let i = 1; i < a.length + (l.closed ? 1 : 0); i++) {
    const previous = a[(i - 1) % a.length]!,
      next = a[i % a.length]!,
      c1 = previous.outgoing ?? previous,
      c2 = next.incoming ?? next;
    result += ` C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${next.x} ${next.y}`;
  }
  return result + (l.closed ? " Z" : "");
}
export function moveLayer(d: ProDocument, id: string, direction: -1 | 1): ProDocument {
  const current = d.layers.find((l) => l.id === id);
  if (!current) return d;
  const siblings = d.layers.filter((l) => l.parentId === current.parentId),
    i = siblings.findIndex((l) => l.id === id),
    other = siblings[i + direction];
  if (!other) return d;
  const layers = [...d.layers],
    a = layers.indexOf(current),
    b = layers.indexOf(other);
  [layers[a], layers[b]] = [layers[b]!, layers[a]!];
  return { ...d, layers };
}
export function removeLayer(d: ProDocument, id: string): ProDocument {
  const ids = new Set([id]);
  for (let n = 0; n < 4; n++)
    for (const l of d.layers) if (l.parentId && ids.has(l.parentId)) ids.add(l.id);
  return { ...d, layers: d.layers.filter((l) => !ids.has(l.id)) };
}
export function toLocalSelection(s: Selection, l: Layer): Selection {
  return {
    ...s,
    regions: s.regions.map((r) => ({ ...r, points: r.points.map((p) => localPoint(p, l)) })),
  };
}
