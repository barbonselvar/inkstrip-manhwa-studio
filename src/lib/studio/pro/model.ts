import { mapping, validateTransform, type Deformation } from "./transform.ts";
import { validateGeometry, type Crop, type ImageSize } from "./geometry.ts";
import type { Adjustments } from "../editor/adjustments";
import { NEUTRAL, validateAdjustments } from "../editor/adjustments.ts";
import { validateColor, type ColorAdjustments } from "./color.ts";
export type Point = { x: number; y: number };
export type Transform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  shearX?: number;
  shearY?: number;
  flipX?: boolean;
  flipY?: boolean;
  pivot?: Point;
  deform?: Deformation;
};
export type Anchor = Point & { incoming?: Point; outgoing?: Point };
export type Region = {
  kind: "rectangle" | "ellipse" | "lasso" | "pixels";
  inverted?: boolean;
  /** Row-bounded RLE coverage; points define the affine image frame. */
  pixels?: { width: number; height: number; runs: number[] };
  points: Point[];
  operation: "add" | "subtract" | "intersect";
};
export type Selection = {
  regions: Region[];
  inverted: boolean;
  feather: number;
  /** Selection captured in document space; map the completed mask into this layer. */
  frame?: { width: number; height: number; transform: Transform };
};
export type CloneSource = {
  assetId: string;
  width: number;
  height: number;
  point: Point;
  aligned: boolean;
};
export type Stroke = {
  points: (Point & { pressure?: number })[];
  sizePressure?: boolean;
  smoothing?: number;
  /** Patch footprint in the target layer; normal strokes continue using brush dabs. */
  patch?: Selection;
  /** New repair strokes embed their processed native-size donor texture. */
  repair?: {
    kind: "spot" | "patch" | "heal";
    source: Point;
    destination: Point;
    algorithm: "spatial-v1";
  };
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  color: string;
  erase: boolean;
  /** Square, hard-edged tip used by the pencil tool. Older native strokes default to round. */
  tip?: "round" | "square";
  clip?: Selection;
  /** Immutable merged-document snapshot sampled for Clone Stamp. */
  clone?: {
    assetId: string;
    width: number;
    height: number;
    source: Point;
    destination: Point;
    /** Mapping captured when the texture is painted; later layer transforms move its pixels. */
    targetTransform?: Transform;
    /** Color-match sampled texture to the target neighborhood (traditional healing). */
    mode?: "clone" | "heal";
  };
};
export type Mask = {
  selection: Selection;
  strokes: Stroke[];
  enabled: boolean;
  inverted?: boolean;
};
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
  /** Consecutive clipped siblings share the nearest unclipped base below. */
  clipped?: boolean;
  /** Members translate together; no pixel or artwork data is shared. */
  linkId?: string;
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
  /** Optional additive v1 color pipeline; absent in older native documents. */
  color?: ColorAdjustments;
  colorSelection?: Selection;
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
export type SourceReference = { assetId: string; width: number; height: number };
export type ProDocument = {
  /** Non-destructive output frame in full canvas coordinates. */
  crop?: Crop;
  /** Final composite resampling; source layers and masks retain native coordinates. */
  imageSize?: ImageSize;
  selection?: Selection;
  source?: SourceReference;
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
    source: { assetId, width: panel.width, height: panel.height },
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
  if (s.frame) {
    const { width, height, transform: t } = s.frame;
    validateTransform(t);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      !finite(width, 1, 16384) ||
      !finite(height, 1, 16384) ||
      width * height > 16_000_000 ||
      !t ||
      !point(t) ||
      !finite(t.scaleX, 0.01, 100) ||
      !finite(t.scaleY, 0.01, 100) ||
      !finite(t.rotation, -360, 360)
    )
      throw new Error("Invalid selection coordinate frame.");
  }
  for (const r of s.regions) {
    if (
      !r ||
      !["rectangle", "ellipse", "lasso", "pixels"].includes(r.kind) ||
      !["add", "subtract", "intersect"].includes(r.operation) ||
      (r.inverted !== undefined && typeof r.inverted !== "boolean") ||
      !Array.isArray(r.points) ||
      r.points.length < 2 ||
      r.points.length > 5000 ||
      !r.points.every(point)
    )
      throw new Error("Invalid selection region.");
    if (r.kind === "pixels") {
      const p = r.pixels;
      if (
        !p ||
        r.points.length !== 3 ||
        !Number.isInteger(p.width) ||
        !Number.isInteger(p.height) ||
        !finite(p.width, 1, 16384) ||
        !finite(p.height, 1, 16384) ||
        p.width * p.height > 16_000_000 ||
        !Array.isArray(p.runs) ||
        p.runs.length % 3 ||
        p.runs.length > 600_000
      )
        throw new Error("Invalid pixel selection.");
      const [a, b, c] = r.points;
      if (Math.abs((b!.x - a!.x) * (c!.y - a!.y) - (c!.x - a!.x) * (b!.y - a!.y)) < 1e-10)
        throw new Error("Invalid pixel selection frame.");
      let end = 0;
      for (let i = 0; i < p.runs.length; i += 3) {
        const start = p.runs[i]!,
          length = p.runs[i + 1]!,
          alpha = p.runs[i + 2]!;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(length) ||
          !Number.isInteger(alpha) ||
          start < end ||
          length < 1 ||
          start + length > p.width * p.height ||
          Math.floor(start / p.width) !== Math.floor((start + length - 1) / p.width) ||
          alpha < 1 ||
          alpha > 255
        )
          throw new Error("Invalid pixel selection runs.");
        end = start + length;
      }
    } else if (r.pixels !== undefined) throw new Error("Unexpected pixel selection data.");
  }
}
function validateStroke(s: Stroke) {
  if (
    !s ||
    !Array.isArray(s.points) ||
    s.points.length < 1 ||
    s.points.length > 10000 ||
    !s.points.every((p) => point(p) && (p.pressure === undefined || finite(p.pressure, 0.05, 1))) ||
    (s.sizePressure !== undefined && typeof s.sizePressure !== "boolean") ||
    (s.smoothing !== undefined && !finite(s.smoothing, 0, 0.95)) ||
    !finite(s.size, 1, 1000) ||
    !finite(s.hardness, 0, 1) ||
    !finite(s.opacity, 0, 1) ||
    !finite(s.flow, 0.01, 1) ||
    !validColor(s.color) ||
    typeof s.erase !== "boolean" ||
    (s.tip !== undefined && s.tip !== "round" && s.tip !== "square")
  )
    throw new Error("Invalid brush stroke.");
  if (s.clip) validateSelection(s.clip);
  if (s.patch) {
    validateSelection(s.patch);
    if (!s.clone) throw new Error("Patch repair texture is missing.");
  }
  if (
    s.repair &&
    (!s.clone ||
      !["spot", "patch", "heal"].includes(s.repair.kind) ||
      s.repair.algorithm !== "spatial-v1" ||
      !point(s.repair.source) ||
      !point(s.repair.destination))
  )
    throw new Error("Invalid repair metadata.");
  if (
    s.clone &&
    (typeof s.clone.assetId !== "string" ||
      !s.clone.assetId ||
      !finite(s.clone.width, 1, 16384) ||
      !Number.isInteger(s.clone.width) ||
      !finite(s.clone.height, 1, 16384) ||
      !Number.isInteger(s.clone.height) ||
      s.clone.width * s.clone.height > 16_000_000 ||
      !point(s.clone.source) ||
      !point(s.clone.destination) ||
      (s.clone.mode !== undefined && s.clone.mode !== "clone" && s.clone.mode !== "heal"))
  )
    throw new Error("Invalid Clone Stamp source.");
  if (s.clone?.targetTransform !== undefined) {
    const t = s.clone.targetTransform;
    validateTransform(t);
    if (
      !t ||
      !point(t) ||
      !finite(t.scaleX, 0.01, 100) ||
      !finite(t.scaleY, 0.01, 100) ||
      !finite(t.rotation, -360, 360)
    )
      throw new Error("Invalid sampled texture transform.");
  }
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
  if (
    d.source !== undefined &&
    (!d.source ||
      typeof d.source.assetId !== "string" ||
      !d.source.assetId ||
      !finite(d.source.width, 1, 16384) ||
      !finite(d.source.height, 1, 16384) ||
      d.source.width * d.source.height > 16_000_000)
  )
    throw new Error("Invalid original source reference.");
  validateGeometry(d);
  if (d.selection !== undefined) validateSelection(d.selection);
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
      (l.clipped !== undefined && typeof l.clipped !== "boolean") ||
      (l.linkId !== undefined &&
        (typeof l.linkId !== "string" || !l.linkId || l.linkId.length > 128)) ||
      !finite(l.opacity, 0, 1) ||
      !["source-over", "multiply", "screen", "overlay", "darken", "lighten"].includes(l.blend) ||
      !finite(l.width, 1, 16384) ||
      !finite(l.height, 1, 16384) ||
      l.width * l.height > 16_000_000
    )
      throw new Error("Invalid or oversized layer.");
    ids.add(l.id);
    const t = l.transform;
    validateTransform(t);
    if (t.deform && (t.deform.width !== l.width || t.deform.height !== l.height))
      throw new Error("Deformation dimensions must match the layer source geometry.");
    if (
      !t ||
      !point(t) ||
      !finite(t.scaleX, 0.01, 100) ||
      !finite(t.scaleY, 0.01, 100) ||
      !finite(t.rotation, -360, 360)
    )
      throw new Error("Invalid layer transform.");
    if (!l.adjustments) throw new Error("Layer adjustments are missing.");
    validateAdjustments(l.adjustments);
    if (l.color !== undefined) validateColor(l.color);
    if (l.colorSelection !== undefined) validateSelection(l.colorSelection);
    if (
      l.kind === "group" &&
      (l.mask ||
        l.color ||
        l.colorSelection ||
        l.transform.x ||
        l.transform.y ||
        l.transform.rotation ||
        l.transform.shearX ||
        l.transform.shearY ||
        l.transform.flipX ||
        l.transform.flipY ||
        l.transform.pivot ||
        l.transform.deform ||
        l.transform.scaleX !== 1 ||
        l.transform.scaleY !== 1 ||
        Object.values(l.adjustments).some((n) => n !== 0) ||
        l.hue ||
        l.black ||
        l.white !== 255 ||
        l.gamma !== 1 ||
        (Array.isArray(l.curve) && l.curve.some((n, i) => n !== [0, 64, 128, 192, 255][i])))
    )
      throw new Error(
        "Group transforms, masks and adjustments are not supported; edit the child layers instead.",
      );
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
        typeof l.mask.enabled !== "boolean" ||
        (l.mask.inverted !== undefined && typeof l.mask.inverted !== "boolean")
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
  if (Object.keys(session.assets).length > 64)
    throw new Error("A Pro document supports at most 64 raster assets.");
  for (const [id, b] of Object.entries(session.assets)) {
    if (!id || !(b instanceof Blob) || !["image/png", "image/jpeg", "image/webp"].includes(b.type))
      throw new Error("Only PNG, JPEG and WebP raster assets are supported.");
    total += b.size;
  }
  if (total > MAX_ASSET_BYTES) throw new Error("Pro assets exceed the 48MB document limit.");
  const original = sourceReference(session.document);
  if (
    original &&
    (!Object.hasOwn(session.assets, original.assetId) ||
      !(session.assets[original.assetId] instanceof Blob))
  )
    throw new Error("The original Pro source is missing.");
  for (const l of session.document.layers)
    if (
      l.kind === "raster" &&
      (!l.assetId ||
        !Object.hasOwn(session.assets, l.assetId) ||
        !(session.assets[l.assetId] instanceof Blob))
    )
      throw new Error("A raster source is missing; existing artwork is unchanged.");
  for (const l of session.document.layers)
    for (const stroke of [...l.strokes, ...(l.mask?.strokes ?? [])])
      if (stroke.clone && !Object.hasOwn(session.assets, stroke.clone.assetId))
        throw new Error("A Clone Stamp source is missing; existing artwork is unchanged.");
}
export function localPoint(p: Point, l: Pick<Layer, "transform">): Point {
  return mapping(l.transform).backward(p);
}
export function worldPoint(p: Point, l: Pick<Layer, "transform">): Point {
  return mapping(l.transform).forward(p);
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
export function toLocalSelection(
  s: Selection,
  l: Layer,
  bounds?: { width: number; height: number },
): Selection {
  // Rasterize booleans and feather in document space before applying the inverse
  // layer transform. This preserves the world-space radius under nonuniform scale.
  if (bounds) return { ...s, frame: { ...bounds, transform: { ...l.transform } } };
  return {
    ...s,
    regions: s.regions.map((r) => {
      let points = r.points;
      const first = points[0]!,
        last = points.at(-1)!;
      if (r.kind === "rectangle")
        points = [
          { x: first.x, y: first.y },
          { x: last.x, y: first.y },
          { x: last.x, y: last.y },
          { x: first.x, y: last.y },
        ];
      else if (r.kind === "ellipse")
        points = Array.from({ length: 96 }, (_, i) => {
          const angle = (i / 96) * Math.PI * 2;
          return {
            x: (first.x + last.x) / 2 + (Math.abs(last.x - first.x) / 2) * Math.cos(angle),
            y: (first.y + last.y) / 2 + (Math.abs(last.y - first.y) / 2) * Math.sin(angle),
          };
        });
      return {
        ...r,
        kind: r.kind === "pixels" ? "pixels" : "lasso",
        points: points.map((p) => localPoint(p, l)),
      };
    }),
  };
}

export function sourceReference(d: ProDocument): SourceReference | undefined {
  if (d.source) return d.source;
  const original = d.layers.find((l) => l.kind === "raster" && l.assetId === "source");
  return original?.assetId
    ? { assetId: original.assetId, width: original.width, height: original.height }
    : undefined;
}
