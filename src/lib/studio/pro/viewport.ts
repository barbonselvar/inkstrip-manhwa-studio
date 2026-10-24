import type { Point } from "./model.ts";
import type { Frame } from "./artboards.ts";
import { CROP_HANDLES, cropHandlePoint, type CropHandle } from "./geometry.ts";

/** Presentation only. Never serialize this into layer/document geometry. */
export type CanvasView = { zoom: number; x: number; y: number; rotation: number };
type Size = { width: number; height: number };
export function viewAngle(degrees: number) {
  if (!Number.isFinite(degrees)) throw Error("Invalid canvas view angle.");
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}
export function rotatePoint(p: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
export function viewFit(size: Size, frame: Size, rotation = 0) {
  const a = (rotation * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a));
  return Math.min(
    Math.max(1, size.width - 64) / (frame.width * c + frame.height * s),
    Math.max(1, size.height - 64) / (frame.width * s + frame.height * c),
  );
}
/** Coordinates relative to the viewport center, in CSS pixels. */
export function documentToViewport(p: Point, frame: Frame, fit: number, view: CanvasView): Point {
  const q = rotatePoint(
    { x: p.x - frame.x - frame.width / 2, y: p.y - frame.y - frame.height / 2 },
    view.rotation,
  );
  return { x: view.x + q.x * fit * view.zoom, y: view.y + q.y * fit * view.zoom };
}
export function viewportToDocument(p: Point, frame: Frame, fit: number, view: CanvasView): Point {
  const q = rotatePoint(
    { x: (p.x - view.x) / (fit * view.zoom), y: (p.y - view.y) / (fit * view.zoom) },
    -view.rotation,
  );
  return { x: frame.x + frame.width / 2 + q.x, y: frame.y + frame.height / 2 + q.y };
}
/** Actual CSS layout quantizes the two board dimensions independently. For the
 * quarter-turn UI, recover both local axis lengths from the measured bounds,
 * then undo rotation. This avoids low-zoom subpixel errors and rotated AABB mapping. */
export function canvasPoint(
  p: Point,
  rect: { left: number; top: number; width: number; height: number },
  frame: Frame,
  rotation: number,
): Point {
  const quarter = Math.abs(viewAngle(rotation)) === 90;
  const q = rotatePoint(
    { x: p.x - rect.left - rect.width / 2, y: p.y - rect.top - rect.height / 2 },
    -rotation,
  );
  return {
    x: frame.x + frame.width / 2 + (q.x * frame.width) / (quarter ? rect.height : rect.width),
    y: frame.y + frame.height / 2 + (q.y * frame.height) / (quarter ? rect.width : rect.height),
  };
}
/** Rotate around the viewport center, retaining the source point under it. */
export function rotateCanvasView(
  view: CanvasView,
  rotation: number,
  size: Size,
  frame: Frame,
): CanvasView {
  rotation = viewAngle(rotation);
  const ratio = viewFit(size, frame, rotation) / viewFit(size, frame, view.rotation);
  const pan = rotatePoint(view, rotation - view.rotation);
  return { ...view, rotation, x: pan.x * ratio, y: pan.y * ratio };
}
/** Touch hit boxes overlap at low zoom. Choose geometric proximity instead of
 * SVG paint order, reserving the center for movement on very small boards. */
export function frameHandleAt(frame: Frame, point: Point, pixelsPerUnit: number): CropHandle {
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) return "move";
  const centerDistance =
    Math.hypot(point.x - frame.x - frame.width / 2, point.y - frame.y - frame.height / 2) *
    pixelsPerUnit;
  const closest = CROP_HANDLES.map((handle) => {
    const p = cropHandlePoint({ ...frame, rotation: 0 }, handle);
    return { handle, distance: Math.hypot(point.x - p.x, point.y - p.y) * pixelsPerUnit };
  }).sort((a, b) => a.distance - b.distance)[0]!;
  return closest.distance <= 22 && closest.distance < centerDistance ? closest.handle : "move";
}
