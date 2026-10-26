/** R9 rulers: zoom/pan/rotation-aware tick placement. Pure presentation math built on
 * the canvas's own document → viewport transform; nothing here touches the document. */
import type { Frame } from "./artboards.ts";
import type { Point } from "./model.ts";
import { documentToViewport, type CanvasView } from "./viewport.ts";

export const RULER_SIZE = 20;
export type RulerUnit = "px" | "%";
export type RulerEdge = "top" | "left";
/** Linear map along one ruler: screen = offset + scale · document value (CSS px from the
 * viewport's top-left). `axis` is the document axis the ruler measures. */
export type RulerMap = { axis: "x" | "y"; offset: number; scale: number };
export type Tick = { at: number; value: number; major: boolean; label?: string };

/** Rulers need a view in quarter turns; any other rotation has no single document axis
 * along a screen edge, so `null` is returned and the rulers hide. */
export function rulerMap(
  edge: RulerEdge,
  viewport: { width: number; height: number },
  frame: Frame,
  fit: number,
  view: CanvasView,
): RulerMap | null {
  const origin = documentToViewport({ x: 0, y: 0 }, frame, fit, view),
    ux = documentToViewport({ x: 1, y: 0 }, frame, fit, view),
    uy = documentToViewport({ x: 0, y: 1 }, frame, fit, view),
    screen = edge === "top" ? "x" : "y",
    center = edge === "top" ? viewport.width / 2 : viewport.height / 2,
    alongX = ux[screen] - origin[screen],
    alongY = uy[screen] - origin[screen];
  const eps = 1e-9 * Math.max(1, Math.abs(alongX), Math.abs(alongY));
  if (Math.abs(alongX) > eps && Math.abs(alongY) > eps) return null;
  const axis = Math.abs(alongX) > eps ? "x" : "y";
  return { axis, offset: center + origin[screen], scale: axis === "x" ? alongX : alongY };
}
export const rulerToDocument = (m: RulerMap, screen: number) => (screen - m.offset) / m.scale;
export const documentToRuler = (m: RulerMap, value: number) => m.offset + m.scale * value;

/** 1-2-5 steps: labelled ticks at least `labelPx` apart, minor ticks subdividing them. */
export function niceStep(pxPerUnit: number, labelPx = 64) {
  const raw = labelPx / Math.abs(pxPerUnit),
    power = 10 ** Math.floor(Math.log10(raw));
  for (const f of [1, 2, 5, 10]) if (f * power >= raw) return f * power;
  return 10 * power;
}
function label(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Ticks for a ruler `length` px long. Percentages are of the document width/height. */
export function rulerTicks(m: RulerMap, length: number, extent: number, unit: RulerUnit) {
  const perUnit = unit === "%" ? (m.scale * extent) / 100 : m.scale,
    step = niceStep(perUnit),
    minor = step / (String(step).startsWith("2") ? 4 : 5),
    toValue = (screen: number) => {
      const v = rulerToDocument(m, screen);
      return unit === "%" ? (v / extent) * 100 : v;
    },
    a = toValue(0),
    b = toValue(length),
    lo = Math.min(a, b),
    hi = Math.max(a, b),
    ticks: Tick[] = [];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo > minor * 4000) return ticks;
  for (let i = Math.ceil(lo / minor); i * minor <= hi; i++) {
    const value = i * minor,
      doc = unit === "%" ? (value / 100) * extent : value,
      major = Math.abs(value / step - Math.round(value / step)) < 1e-6;
    ticks.push({
      at: documentToRuler(m, doc),
      value,
      major,
      ...(major ? { label: label(value) } : {}),
    });
  }
  return ticks;
}

/** Document position of a pointer over the viewport, along the ruler's axis. */
export function guidePosition(m: RulerMap, screen: Point, edge: RulerEdge) {
  return Math.round(rulerToDocument(m, edge === "top" ? screen.x : screen.y) * 100) / 100;
}
