import { INK_STYLES } from "./ink-catalog.ts";
import { BOUNDARY_SHAPES, type Boundary } from "./boundaries.ts";
import type { Chapter, Panel } from "../types.ts";
import { isBlendMode, type BlendMode } from "../pro/blend.ts";
import { validateBubbleObject, type Bubble } from "./bubble.ts";
export type { Bubble } from "./bubble.ts";

export type Fill = "solid" | "transparent" | "gradient" | "blur" | "mirror";
export type Space = {
  name?: string;
  blend?: BlendMode;
  height: number;
  fill: Fill;
  color: string;
  color2: string;
  blur: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
};
export const space = (height = 0, color = "#ffffff"): Space => ({
  height,
  fill: "solid",
  color,
  color2: "#000000",
  blur: 24,
  visible: true,
  locked: false,
  opacity: 1,
});
export const FADE_TYPES = [
  "Top Fade",
  "Bottom Fade",
  "Left Fade",
  "Right Fade",
  "Linear Fade",
  "Multi-edge Fade",
  "Radial Fade",
  "Elliptical Fade",
  "Soft Feather",
  "Blur Fade",
  "Fog Fade",
  "Directional Fade",
  "Custom Gradient Fade",
] as const;
export type Fade = {
  boundary?: Boundary;
  /** Left edge of a narrowed fade, in chapter pixels relative to the image (default 0). */
  x?: number;
  /** Horizontal extent; undefined = the full image width. */
  width?: number;
  /** Mask edge softness: a true blur of the coverage mask, in pixels. */
  softness?: number;
  /** Paint the fade band beyond the image into spacing and gutters. */
  extend?: boolean;
  id: string;
  name: string;
  type: (typeof FADE_TYPES)[number];
  edges: ("top" | "bottom" | "left" | "right")[];
  length: number;
  start: number;
  opacity: number;
  color: string;
  curve: number;
  feather: number;
  blur: number;
  angle: number;
  visible: boolean;
  locked: boolean;
  blend: BlendMode;
  stops: { position: number; opacity: number }[];
};
export function fade(type: Fade["type"] = "Bottom Fade"): Fade {
  const edge = type.startsWith("Top")
    ? "top"
    : type.startsWith("Left")
      ? "left"
      : type.startsWith("Right")
        ? "right"
        : "bottom";
  return {
    id: crypto.randomUUID(),
    name: type,
    type,
    edges:
      type === "Multi-edge Fade" || type === "Soft Feather"
        ? ["top", "bottom", "left", "right"]
        : [edge],
    length: 350,
    start: 0,
    opacity: 1,
    color: "#ffffff",
    curve: 1,
    feather: 0,
    blur: type === "Blur Fade" ? 16 : 0,
    angle: 90,
    visible: true,
    locked: false,
    blend: "source-over",
    stops: [
      { position: 0, opacity: 0 },
      { position: 1, opacity: 1 },
    ],
  };
}
export type Snapshot = { blobId: string; width: number; height: number; revision: number };
export type PanelComposition = {
  name?: string;
  blend?: BlendMode;
  top: Space;
  bottom: Space;
  after: Space;
  visible: boolean;
  locked: boolean;
  opacity: number;
  fades: Fade[];
  snapshot?: Snapshot;
};
export const panelComposition = (gap = 0): PanelComposition => ({
  top: space(),
  bottom: space(),
  after: space(gap),
  visible: true,
  locked: false,
  opacity: 1,
  fades: [],
});
export type CommonObject = {
  id: string;
  name: string;
  owner?: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skew: number;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  locked: boolean;
  clip: boolean;
};
export type Sfx = CommonObject & {
  ink?: string;
  kind: "sfx";
  text: string;
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  direction: "ltr" | "rtl";
  spacing: number;
  lineHeight: number;
  fill: string;
  fill2: string;
  gradient: boolean;
  strokes: { color: string; width: number }[];
  shadow: number;
  glow: number;
  texture: number;
};
export type Fx = CommonObject & {
  kind: "fx";
  effect: string;
  color: string;
  color2: string;
  amount: number;
  density: number;
  seed: number;
  angle: number;
  radius: number;
};
export type Overlay = CommonObject & { kind: "overlay"; blobId: string };
export type Group = CommonObject & { kind: "group" };
export type CompositionObject = Sfx | Fx | Overlay | Group | Bubble;
export const TRANSITION_TYPES = [
  "White Transition",
  "Black Transition",
  "Crossfade",
  "Gradient Blend",
  "Fog Transition",
  "Blur Transition",
  "Dissolve",
  "Color Wash",
  "Atmospheric Transition",
  "Custom Mask Transition",
] as const;
export type Transition = {
  name?: string;
  blend?: BlendMode;
  id: string;
  a: string;
  b: string;
  type: (typeof TRANSITION_TYPES)[number];
  height: number;
  softness: number;
  opacity: number;
  angle: number;
  color: string;
  visible: boolean;
  locked: boolean;
  seed: number;
  stops: { position: number; opacity: number }[];
};
export type CompositionDocument = {
  layerOrder?: string[];
  version: 1;
  width: number;
  background: string;
  opening: Space;
  ending: Space;
  defaultGap: number;
  panels: Record<string, PanelComposition>;
  objects: CompositionObject[];
  transitions: Transition[];
};
export type CompositionRecord = { version: 1; revision: number; document: CompositionDocument };
export type CompositionPreset = {
  id: string;
  name: string;
  category: "spacing" | "fade" | "transition" | "sfx" | "fx" | "asset" | "bubble";
  collection?: string;
  value: Space | Fade | Transition | Sfx | Fx | Overlay | Bubble;
};
export type CompositionPreferences = { presets: CompositionPreset[]; favorites: string[] };
export function createComposition(chapter: Chapter, panels: Panel[]): CompositionDocument {
  return {
    version: 1,
    width: chapter.width,
    background: "#ffffff",
    opening: space(),
    ending: space(),
    defaultGap: chapter.seam,
    panels: Object.fromEntries(panels.map((p) => [p.id, panelComposition(chapter.seam)])),
    objects: [],
    transitions: [],
  };
}
export type PanelFrame = {
  panel: Panel;
  settings: PanelComposition;
  top: number;
  imageY: number;
  imageHeight: number;
  bottomY: number;
  gapY: number;
  end: number;
};
export type SpaceFrame = {
  key: string;
  panelId?: string;
  slot: "top" | "bottom" | "after" | "opening" | "ending";
  y: number;
  height: number;
  settings: Space;
  neighbor?: PanelFrame;
};
export function layout(document: CompositionDocument, panels: Panel[]) {
  let y = document.opening.height;
  const frames: PanelFrame[] = [],
    spaces: SpaceFrame[] = [];
  if (document.opening.height)
    spaces.push({
      key: "opening",
      slot: "opening",
      y: 0,
      height: document.opening.height,
      settings: document.opening,
    });
  panels.forEach((panel, index) => {
    const settings = document.panels[panel.id] ?? panelComposition(document.defaultGap);
    const source = settings.snapshot ?? panel;
    const imageHeight = (source.height * document.width) / source.width;
    const imageY = y + settings.top.height,
      bottomY = imageY + imageHeight,
      gapY = bottomY + settings.bottom.height;
    const end = gapY + (index < panels.length - 1 ? settings.after.height : 0);
    const frame = { panel, settings, top: y, imageY, imageHeight, bottomY, gapY, end };
    frames.push(frame);
    for (const [slot, sy] of [
      ["top", y],
      ["bottom", bottomY],
      ["after", gapY],
    ] as const) {
      if (slot === "after" && index === panels.length - 1) continue;
      const s = settings[slot];
      if (s.height)
        spaces.push({
          key: `${panel.id}:${slot}`,
          panelId: panel.id,
          slot,
          y: sy,
          height: s.height,
          settings: s,
          neighbor: frame,
        });
    }
    y = end;
  });
  if (document.ending.height)
    spaces.push({
      key: "ending",
      slot: "ending",
      y,
      height: document.ending.height,
      settings: document.ending,
    });
  y += document.ending.height;
  return { width: document.width, height: Math.max(1, y), frames, spaces };
}
export function orderedPanels(panels: Panel[]) {
  return [...panels].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}
export function objectOrigin(object: CompositionObject, frames: PanelFrame[]) {
  return {
    x: object.x,
    y:
      object.y +
      (object.owner ? (frames.find((f) => f.panel.id === object.owner)?.imageY ?? 0) : 0),
  };
}
export function transitionActive(t: Transition, panels: Panel[]) {
  const i = panels.findIndex((p) => p.id === t.a);
  return i >= 0 && panels[i + 1]?.id === t.b;
}
export function mergeGap(
  document: CompositionDocument,
  a: string,
  b: string,
  color: string,
): CompositionDocument {
  const left = document.panels[a],
    right = document.panels[b];
  if (!left || !right) return document;
  return {
    ...document,
    panels: {
      ...document.panels,
      [a]: {
        ...left,
        bottom: { ...left.bottom, height: 0 },
        after: { ...space(left.bottom.height + left.after.height + right.top.height, color) },
      },
      [b]: { ...right, top: { ...right.top, height: 0 } },
    },
  };
}
export function reconcile(document: CompositionDocument, panels: Panel[]) {
  const ids = new Set(panels.map((p) => p.id));
  const objects = document.objects.filter((o) => !o.owner || ids.has(o.owner));
  const objectIds = new Set(objects.map((o) => o.id));
  return {
    ...document,
    panels: Object.fromEntries(
      panels.map((p) => [p.id, document.panels[p.id] ?? panelComposition(document.defaultGap)]),
    ),
    objects: objects.map((o) =>
      o.parentId && !objectIds.has(o.parentId) ? { ...o, parentId: undefined } : o,
    ),
    transitions: document.transitions.filter((t) => ids.has(t.a) && ids.has(t.b)),
  };
}
export function compositionBlobIds(value: unknown): string[] {
  // Only structurally recognizable refs are retained. Unknown versions stay opaque.
  if (!value || typeof value !== "object") return [];
  const d = (value as CompositionRecord).document;
  if (!d || !Array.isArray(d.objects) || !d.panels || typeof d.panels !== "object") return [];
  return [
    ...new Set(
      [
        ...d.objects.filter((o) => o?.kind === "overlay").map((o) => (o as Overlay).blobId),
        ...Object.values(d.panels).map((p) => p?.snapshot?.blobId),
      ].filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
}
const n = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const color = (v: unknown) => typeof v === "string" && /^(#[0-9a-f]{6}|transparent)$/i.test(v);
const ident = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 128;
function assert(v: unknown, message: string): asserts v {
  if (!v) throw Error(`Invalid composition: ${message}.`);
}
export function validateSpace(s: Space) {
  assert(
    s &&
      (s.name === undefined || (typeof s.name === "string" && s.name.length <= 200)) &&
      (s.blend === undefined || isBlendMode(s.blend)),
    "spacing layer",
  );
  assert(
    s &&
      n(s.height, 0, 100000) &&
      ["solid", "transparent", "gradient", "blur", "mirror"].includes(s.fill) &&
      color(s.color) &&
      color(s.color2) &&
      n(s.blur, 0, 100) &&
      n(s.opacity, 0, 1) &&
      typeof s.visible === "boolean" &&
      typeof s.locked === "boolean",
    "spacing",
  );
}
export function validateFade(f: Fade) {
  assert(
    f &&
      ident(f.id) &&
      FADE_TYPES.includes(f.type) &&
      typeof f.name === "string" &&
      f.name.length <= 200,
    "fade type",
  );
  assert(
    Array.isArray(f.edges) &&
      f.edges.length > 0 &&
      f.edges.length <= 4 &&
      f.edges.every((e) => ["top", "bottom", "left", "right"].includes(e)),
    "fade edges",
  );
  assert(
    n(f.length, 1, 100000) &&
      n(f.start, -100000, 100000) &&
      n(f.opacity, 0, 1) &&
      n(f.curve, 0.1, 10) &&
      n(f.feather, 0, 1000) &&
      n(f.blur, 0, 100) &&
      n(f.angle, -360, 360) &&
      color(f.color) &&
      isBlendMode(f.blend) &&
      typeof f.visible === "boolean" &&
      typeof f.locked === "boolean",
    "fade settings",
  );
  assert(
    (f.x === undefined || n(f.x, -100000, 100000)) &&
      (f.width === undefined || n(f.width, 1, 100000)) &&
      (f.softness === undefined || n(f.softness, 0, 1000)) &&
      (f.extend === undefined || typeof f.extend === "boolean"),
    "fade extent",
  );
  if (f.boundary) {
    const b = f.boundary;
    assert(
      BOUNDARY_SHAPES.includes(b.shape) &&
        n(b.amplitude, 0, 100000) &&
        n(b.frequency, 0.1, 20) &&
        [-1, 1].includes(b.direction) &&
        ["Top", "Bottom", "Both"].includes(b.placement) &&
        Array.isArray(b.points) &&
        b.points.length >= 2 &&
        b.points.length <= 128 &&
        b.points.every((p) => n(p.x, 0, 1) && n(p.y, 0, 1)) &&
        (b.shape !== "Bezier" || b.points.length === 4),
      "fade boundary",
    );
  }
  validateStops(f.stops);
}
function validateStops(stops: Fade["stops"]) {
  assert(
    Array.isArray(stops) &&
      stops.length >= 2 &&
      stops.length <= 16 &&
      stops.every(
        (s, i) =>
          s &&
          n(s.position, 0, 1) &&
          n(s.opacity, 0, 1) &&
          (!i || s.position > stops[i - 1].position),
      ),
    "gradient mask stops",
  );
}
export function validateObject(o: CompositionObject) {
  assert(
    o &&
      ["sfx", "fx", "overlay", "group", "bubble"].includes(o.kind) &&
      ident(o.id) &&
      typeof o.name === "string" &&
      o.name.length <= 200,
    "layer",
  );
  assert(
    (o.owner === undefined || ident(o.owner)) && (o.parentId === undefined || ident(o.parentId)),
    "layer association",
  );
  assert(
    n(o.x, -1e8, 1e8) &&
      n(o.y, -1e8, 1e8) &&
      n(o.width, 1, 100000) &&
      n(o.height, 1, 100000) &&
      n(o.rotation, -360, 360) &&
      n(o.scaleX, 0.01, 20) &&
      n(o.scaleY, 0.01, 20) &&
      n(o.skew, -75, 75) &&
      n(o.opacity, 0, 1) &&
      isBlendMode(o.blend),
    "layer geometry",
  );
  assert(
    typeof o.visible === "boolean" && typeof o.locked === "boolean" && typeof o.clip === "boolean",
    "layer flags",
  );
  if (o.kind === "sfx") {
    assert(
      o.ink === undefined || (typeof o.ink === "string" && INK_STYLES.includes(o.ink as never)),
      "ink style",
    );
    assert(
      typeof o.text === "string" &&
        o.text.length <= 10000 &&
        typeof o.font === "string" &&
        o.font.length <= 200 &&
        /^[\p{L}\p{N} _,'"-]+$/u.test(o.font) &&
        n(o.size, 1, 2000) &&
        n(o.weight, 100, 900) &&
        n(o.spacing, -100, 500) &&
        n(o.lineHeight, 0.5, 5) &&
        color(o.fill) &&
        color(o.fill2) &&
        ["ltr", "rtl"].includes(o.direction),
      "lettering",
    );
    assert(
      typeof o.italic === "boolean" &&
        typeof o.gradient === "boolean" &&
        n(o.shadow, 0, 100) &&
        n(o.glow, 0, 100) &&
        n(o.texture, 0, 1) &&
        Array.isArray(o.strokes) &&
        o.strokes.length <= 8 &&
        o.strokes.every((s) => color(s.color) && n(s.width, 0, 100)),
      "lettering appearance",
    );
  }
  if (o.kind === "fx")
    assert(
      typeof o.effect === "string" &&
        o.effect.length <= 100 &&
        color(o.color) &&
        color(o.color2) &&
        n(o.amount, 0, 1) &&
        n(o.density, 1, 500) &&
        n(o.seed, 0, 0xffffffff) &&
        n(o.angle, -360, 360) &&
        n(o.radius, 0, 100),
      "effect",
    );
  if (o.kind === "overlay") assert(ident(o.blobId), "overlay image");
  if (o.kind === "bubble") validateBubbleObject(o);
}
export function validateTransition(t: Transition) {
  assert(
    t &&
      (t.name === undefined || (typeof t.name === "string" && t.name.length <= 200)) &&
      (t.blend === undefined || isBlendMode(t.blend)),
    "transition layer",
  );
  assert(
    t &&
      ident(t.id) &&
      ident(t.a) &&
      ident(t.b) &&
      t.a !== t.b &&
      TRANSITION_TYPES.includes(t.type) &&
      n(t.height, 1, 100000) &&
      n(t.softness, 0.01, 1) &&
      n(t.opacity, 0, 1) &&
      n(t.angle, -360, 360) &&
      color(t.color) &&
      n(t.seed, 0, 0xffffffff) &&
      typeof t.visible === "boolean" &&
      typeof t.locked === "boolean",
    "transition",
  );
  validateStops(t.stops);
}
export function validateComposition(value: unknown): asserts value is CompositionRecord {
  const r = value as CompositionRecord;
  assert(
    r && r.version === 1 && Number.isSafeInteger(r.revision) && r.revision >= 0,
    "version/revision",
  );
  const d = r.document;
  if (d?.layerOrder !== undefined)
    assert(
      Array.isArray(d.layerOrder) &&
        d.layerOrder.length <= 50000 &&
        d.layerOrder.every((key) => typeof key === "string" && key.length <= 256) &&
        new Set(d.layerOrder).size === d.layerOrder.length,
      "layer order",
    );
  assert(
    d &&
      d.version === 1 &&
      n(d.width, 320, 4096) &&
      color(d.background) &&
      n(d.defaultGap, 0, 100000),
    "document",
  );
  validateSpace(d.opening);
  validateSpace(d.ending);
  assert(
    d.panels &&
      typeof d.panels === "object" &&
      !Array.isArray(d.panels) &&
      Object.keys(d.panels).length <= 10000,
    "panels",
  );
  for (const [id, p] of Object.entries(d.panels)) {
    assert(
      p &&
        (p.name === undefined || (typeof p.name === "string" && p.name.length <= 200)) &&
        (p.blend === undefined || isBlendMode(p.blend)),
      "source layer",
    );
    assert(
      ident(id) &&
        p &&
        typeof p.visible === "boolean" &&
        typeof p.locked === "boolean" &&
        n(p.opacity, 0, 1),
      "panel settings",
    );
    validateSpace(p.top);
    validateSpace(p.bottom);
    validateSpace(p.after);
    assert(Array.isArray(p.fades) && p.fades.length <= 32, "fades");
    p.fades.forEach(validateFade);
    if (p.snapshot)
      assert(
        ident(p.snapshot.blobId) &&
          n(p.snapshot.width, 1, 65535) &&
          n(p.snapshot.height, 1, 65535) &&
          n(p.snapshot.revision, 0, 1e12),
        "native snapshot",
      );
  }
  assert(
    Array.isArray(d.objects) &&
      d.objects.length <= 10000 &&
      Array.isArray(d.transitions) &&
      d.transitions.length <= 10000,
    "layers",
  );
  d.objects.forEach(validateObject);
  d.transitions.forEach(validateTransition);
  const ids = new Set<string>();
  for (const o of d.objects) {
    assert(!ids.has(o.id), "duplicate layer");
    ids.add(o.id);
    assert(!o.owner || !!d.panels[o.owner], "missing owner");
  }
  const objectMap = new Map(d.objects.map((o) => [o.id, o]));
  for (const o of d.objects) {
    let parent = o.parentId;
    const visited = new Set([o.id]);
    while (parent) {
      const p = objectMap.get(parent);
      assert(
        p &&
          p.kind === "group" &&
          p.owner === o.owner &&
          !visited.has(parent) &&
          visited.size <= 64,
        "group cycle, depth or scope",
      );
      visited.add(parent);
      parent = p.parentId;
    }
  }
  for (const t of d.transitions)
    assert(!!d.panels[t.a] && !!d.panels[t.b], "transition references");
}
export function readComposition(value: unknown) {
  try {
    validateComposition(value);
    return { record: value, error: null };
  } catch (error) {
    return {
      record: null,
      error: error instanceof Error ? error.message : "Composition unavailable",
    };
  }
}
export function validateCompositionPreferences(value: CompositionPreferences) {
  assert(
    value &&
      Array.isArray(value.favorites) &&
      value.favorites.length <= 10000 &&
      value.favorites.every(ident) &&
      Array.isArray(value.presets) &&
      value.presets.length <= 1000,
    "presets",
  );
  for (const p of value.presets) {
    assert(
      ident(p.id) && typeof p.name === "string" && p.name.length > 0 && p.name.length <= 200,
      "preset",
    );
    assert(
      p.collection === undefined || (typeof p.collection === "string" && p.collection.length <= 80),
      "preset collection",
    );
    if (p.category === "spacing") validateSpace(p.value as Space);
    else if (p.category === "fade") validateFade(p.value as Fade);
    else if (p.category === "transition") validateTransition(p.value as Transition);
    else {
      assert(
        p.category === "sfx" ||
          p.category === "fx" ||
          p.category === "asset" ||
          p.category === "bubble",
        "preset category",
      );
      if (p.category === "asset") assert((p.value as Overlay).kind === "overlay", "asset preset");
      if (p.category === "bubble")
        assert((p.value as CompositionObject).kind === "bubble", "bubble preset");
      validateObject(p.value as CompositionObject);
    }
  }
}
export const AI_EXTENSION = {
  available: false,
  reason:
    "No compatible image-extension backend is configured. Solid, gradient, blur and mirrored extensions work offline.",
} as const;

/** Structural and creative layers share one compositing stack; masks stay attached to sources. */
export function layerStack(d: CompositionDocument, order = Object.keys(d.panels)) {
  const defaults = [
    "space:opening",
    ...order.flatMap((id) => ["top", "bottom", "after"].map((slot) => `space:${id}:${slot}`)),
    "space:ending",
    ...order.map((id) => `source:${id}`),
    ...d.transitions.map((t) => `transition:${t.id}`),
    ...d.objects.filter((o) => !o.parentId).map((o) => `object:${o.id}`),
  ];
  const known = new Set(defaults),
    stored = (d.layerOrder ?? []).filter((key) => known.has(key)),
    seen = new Set(stored);
  if (!stored.length) return defaults;
  const before = new Map<string | undefined, string[]>();
  let anchor: string | undefined;
  for (let i = defaults.length - 1; i >= 0; i--) {
    const key = defaults[i];
    if (seen.has(key)) anchor = key;
    else {
      const list = before.get(anchor) ?? [];
      list.push(key);
      before.set(anchor, list);
    }
  }
  return [
    ...stored.flatMap((key) => [...(before.get(key) ?? []).reverse(), key]),
    ...(before.get(undefined) ?? []).reverse(),
  ];
}
export function moveLayer(
  d: CompositionDocument,
  key: string,
  direction: -1 | 1,
  order?: string[],
) {
  const stack = layerStack(d, order),
    index = stack.indexOf(key),
    target = index + direction;
  if (index < 0 || target < 0 || target >= stack.length) return d;
  [stack[index], stack[target]] = [stack[target], stack[index]];
  return { ...d, layerOrder: stack };
}

export function presetBlobIds(p?: CompositionPreferences) {
  return (p?.presets ?? []).flatMap((x) =>
    x.category === "asset" ? [(x.value as Overlay).blobId] : [],
  );
}
