/** Raster Studio Gradient tool: drag geometry, on-canvas handles and presets for editable
 * gradient layers. The layer stays a parametric `gradient` layer (non-destructive); only
 * its angle, scale, center and stops change, so every edit is one undo step. */
import { GRADIENT_PRESETS, type GradientStop } from "./color.ts";
import { validateGradient, type Gradient } from "./gradient.ts";
import { maskFromSelection } from "./masks.ts";
import { layer, type Point, type ProDocument, type Selection } from "./model.ts";

export type GradientHandle = "start" | "end" | "center";
const MIN_DRAG = 2;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const degrees = (dx: number, dy: number) => {
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Math.round(a * 1000) / 1000;
};
/** Distance over which a linear gradient runs from its first to its last stop. */
const linearSpan = (angle: number, width: number, height: number) => {
  const r = (angle * Math.PI) / 180;
  return Math.abs(width * Math.cos(r)) + Math.abs(height * Math.sin(r));
};

/** Gradient geometry from a drag in layer-local pixels: linear runs start → end; radial
 * is centered on the start with its last stop at the end. Returns null for a click. */
export function gradientFromDrag(
  base: Gradient,
  start: Point,
  end: Point,
  width: number,
  height: number,
): Gradient | null {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    length = Math.hypot(dx, dy);
  if (length < MIN_DRAG || width <= 0 || height <= 0) return null;
  const angle = degrees(dx, dy),
    center =
      base.kind === "linear"
        ? { x: (start.x + end.x) / 2 / width, y: (start.y + end.y) / 2 / height }
        : { x: start.x / width, y: start.y / height },
    scale =
      base.kind === "linear" ? length / linearSpan(angle, width, height) : (2 * length) / width;
  const next: Gradient = {
    ...structuredClone(base),
    angle,
    scale: clamp(scale, 0.01, 10),
    center: { x: clamp(center.x, -2, 3), y: clamp(center.y, -2, 3) },
  };
  validateGradient(next);
  return next;
}

/** Layer-local handle positions matching `gradientField`. */
export function gradientLayerHandles(g: Gradient, width: number, height: number) {
  const r = (g.angle * Math.PI) / 180,
    dir = { x: Math.cos(r), y: Math.sin(r) },
    center = { x: g.center.x * width, y: g.center.y * height };
  if (g.kind === "linear") {
    const half = (linearSpan(g.angle, width, height) * g.scale) / 2;
    return {
      center,
      start: { x: center.x - dir.x * half, y: center.y - dir.y * half },
      end: { x: center.x + dir.x * half, y: center.y + dir.y * half },
    };
  }
  const radius = (g.scale * width) / 2;
  return {
    center,
    start: center,
    end: { x: center.x + dir.x * radius, y: center.y + dir.y * radius },
  };
}

/** Move one handle; the others stay where they are on the canvas. */
export function moveGradientLayerHandle(
  g: Gradient,
  width: number,
  height: number,
  handle: GradientHandle,
  p: Point,
): Gradient | null {
  const h = gradientLayerHandles(g, width, height);
  if (g.kind === "radial" && handle !== "end") {
    const next = {
      ...structuredClone(g),
      center: { x: clamp(p.x / width, -2, 3), y: clamp(p.y / height, -2, 3) },
    };
    validateGradient(next);
    return next;
  }
  if (g.kind === "radial") return gradientFromDrag(g, h.center, p, width, height);
  if (handle === "center") {
    const dx = p.x - h.center.x,
      dy = p.y - h.center.y;
    return gradientFromDrag(
      g,
      { x: h.start.x + dx, y: h.start.y + dy },
      { x: h.end.x + dx, y: h.end.y + dy },
      width,
      height,
    );
  }
  return handle === "start"
    ? gradientFromDrag(g, p, h.end, width, height)
    : gradientFromDrag(g, h.start, p, width, height);
}

export function reverseStops(stops: GradientStop[]): GradientStop[] {
  return stops.map((s) => ({ ...s, position: Math.round((1 - s.position) * 1e6) / 1e6 })).reverse();
}

/** Built-in Gradient tool presets. "Foreground to transparent" follows the brush color. */
export function gradientToolPresets(foreground: string): Record<string, GradientStop[]> {
  const fg = /^#[\da-f]{6}$/i.test(foreground) ? foreground : "#000000";
  return {
    "Foreground to transparent": [
      { position: 0, color: fg, opacity: 1 },
      { position: 1, color: fg, opacity: 0 },
    ],
    "Black to white": structuredClone(GRADIENT_PRESETS.Grayscale!),
    "Black to transparent": [
      { position: 0, color: "#000000", opacity: 1 },
      { position: 1, color: "#000000", opacity: 0 },
    ],
    "White glow": [
      { position: 0, color: "#ffffff", opacity: 1 },
      { position: 0.45, color: "#ffffff", opacity: 0.55 },
      { position: 1, color: "#ffffff", opacity: 0 },
    ],
    Sunset: [
      { position: 0, color: "#2b1055", opacity: 1 },
      { position: 0.45, color: "#d53369", opacity: 1 },
      { position: 1, color: "#fbb03b", opacity: 1 },
    ],
    "Night sky": [
      { position: 0, color: "#050a1f", opacity: 1 },
      { position: 0.6, color: "#1b2a5c", opacity: 1 },
      { position: 1, color: "#5b7bc4", opacity: 1 },
    ],
    "Mint light": [
      { position: 0, color: "#e9fff7", opacity: 1 },
      { position: 1, color: "#3fd0a4", opacity: 1 },
    ],
    Spectrum: [
      { position: 0, color: "#ff0000", opacity: 1 },
      { position: 0.17, color: "#ffff00", opacity: 1 },
      { position: 0.33, color: "#00ff00", opacity: 1 },
      { position: 0.5, color: "#00ffff", opacity: 1 },
      { position: 0.67, color: "#0000ff", opacity: 1 },
      { position: 0.83, color: "#ff00ff", opacity: 1 },
      { position: 1, color: "#ff0000", opacity: 1 },
    ],
    Sepia: structuredClone(GRADIENT_PRESETS.Sepia!),
    Cyanotype: structuredClone(GRADIENT_PRESETS.Cyanotype!),
  };
}

/** New full-canvas gradient layer on top of the stack. An active selection becomes its
 * layer mask, so the gradient fills only the selected area and stays editable. */
export function addGradientLayer(
  d: ProDocument,
  gradient: Gradient,
  selection?: Selection,
): { document: ProDocument; id: string } {
  validateGradient(gradient);
  const object = layer("gradient", d.width, d.height);
  object.name = gradient.kind === "linear" ? "Linear gradient" : "Radial gradient";
  object.gradient = structuredClone(gradient);
  if (selection && (selection.regions.length || selection.inverted))
    object.mask = maskFromSelection(selection, object, d);
  return { document: { ...d, layers: [...d.layers, object] }, id: object.id };
}
