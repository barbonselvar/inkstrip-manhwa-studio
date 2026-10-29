import { RASTER_MAX_AREA, RASTER_MAX_SIDE } from "../raster-limits.ts";
import type { Point, ProDocument } from "./model.ts";
export type Resampling = "nearest" | "bilinear" | "bicubic" | "lanczos";
export type Crop = { x: number; y: number; width: number; height: number; rotation: number };
export type ImageSize = { width: number; height: number; resampling: Resampling };
export const CROP_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type CropHandle = (typeof CROP_HANDLES)[number] | "move" | "draw";
export const fullCrop = (d: Pick<ProDocument, "width" | "height">): Crop => ({
  x: 0,
  y: 0,
  width: d.width,
  height: d.height,
  rotation: 0,
});
export function cropPoint(c: Crop, p: Point): Point {
  const a = (c.rotation * Math.PI) / 180,
    x = p.x - c.width / 2,
    y = p.y - c.height / 2;
  return {
    x: c.x + c.width / 2 + x * Math.cos(a) - y * Math.sin(a),
    y: c.y + c.height / 2 + x * Math.sin(a) + y * Math.cos(a),
  };
}
export function cropLocal(c: Crop, p: Point): Point {
  const a = (c.rotation * Math.PI) / 180,
    x = p.x - c.x - c.width / 2,
    y = p.y - c.y - c.height / 2;
  return {
    x: c.width / 2 + x * Math.cos(a) + y * Math.sin(a),
    y: c.height / 2 - x * Math.sin(a) + y * Math.cos(a),
  };
}
export function cropHandlePoint(c: Crop, h: string): Point {
  return cropPoint(c, {
    x: h.includes("w") ? 0 : h.includes("e") ? c.width : c.width / 2,
    y: h.includes("n") ? 0 : h.includes("s") ? c.height : c.height / 2,
  });
}
/** Resize about the opposite edge/corner in the rotated crop frame. Width/height are output pixels. */
export function dragCrop(c: Crop, handle: CropHandle, start: Point, p: Point, ratio = 0): Crop {
  if (handle === "move") return { ...c, x: c.x + p.x - start.x, y: c.y + p.y - start.y };
  if (handle === "draw") {
    let w = Math.max(1, Math.round(Math.abs(p.x - start.x))),
      h = Math.max(1, Math.round(Math.abs(p.y - start.y)));
    if (ratio > 0) {
      w = Math.max(w, Math.round(h * ratio));
      h = Math.max(1, Math.round(w / ratio));
    }
    return {
      x: p.x < start.x ? start.x - w : start.x,
      y: p.y < start.y ? start.y - h : start.y,
      width: w,
      height: h,
      rotation: 0,
    };
  }
  const q = cropLocal(c, p),
    s = cropLocal(c, start),
    west = handle.includes("w"),
    east = handle.includes("e"),
    north = handle.includes("n"),
    south = handle.includes("s");
  let w = Math.max(1, Math.round(c.width + (east ? 1 : west ? -1 : 0) * (q.x - s.x))),
    h = Math.max(1, Math.round(c.height + (south ? 1 : north ? -1 : 0) * (q.y - s.y)));
  if (ratio > 0) {
    if (
      (east || west) &&
      (!(north || south) || Math.abs(w - c.width) >= Math.abs(h - c.height) * ratio)
    )
      h = Math.max(1, Math.round(w / ratio));
    else w = Math.max(1, Math.round(h * ratio));
  }
  const anchor = {
      x: west ? c.width : east ? 0 : c.width / 2,
      y: north ? c.height : south ? 0 : c.height / 2,
    },
    fixed = cropPoint(c, anchor),
    result = { ...c, width: w, height: h },
    changed = cropPoint(result, {
      x: west ? w : east ? 0 : w / 2,
      y: north ? h : south ? 0 : h / 2,
    });
  return { ...result, x: result.x + fixed.x - changed.x, y: result.y + fixed.y - changed.y };
}
export function outputSize(d: Pick<ProDocument, "width" | "height" | "crop" | "imageSize">) {
  return d.imageSize ?? d.crop ?? d;
}
/** Canvas stays in source coordinates. This final affine stage applies equally to every layer/mask. */
export function outputMatrix(d: ProDocument): [number, number, number, number, number, number] {
  const c = d.crop ?? fullCrop(d),
    size = outputSize(d),
    sx = size.width / c.width,
    sy = size.height / c.height,
    angle = (c.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    cx = c.x + c.width / 2,
    cy = c.y + c.height / 2;
  return [
    sx * cos,
    -sy * sin,
    sx * sin,
    sy * cos,
    sx * (c.width / 2 - cx * cos - cy * sin),
    sy * (c.height / 2 + cx * sin - cy * cos),
  ];
}
export function validateGeometry(d: ProDocument) {
  const size = (s: { width: number; height: number }) =>
    s &&
    Number.isInteger(s.width) &&
    Number.isInteger(s.height) &&
    s.width >= 1 &&
    s.height >= 1 &&
    s.width <= RASTER_MAX_SIDE &&
    s.height <= RASTER_MAX_SIDE &&
    s.width * s.height <= RASTER_MAX_AREA;
  if (
    d.crop !== undefined &&
    (!size(d.crop) ||
      !Number.isFinite(d.crop.x) ||
      !Number.isFinite(d.crop.y) ||
      Math.abs(d.crop.x) > 100000 ||
      Math.abs(d.crop.y) > 100000 ||
      !Number.isFinite(d.crop.rotation) ||
      Math.abs(d.crop.rotation) > 180)
  )
    throw new Error("Invalid crop (up to 16.8 megapixels / 16384px per side / ±180°).");
  if (
    d.imageSize !== undefined &&
    (!size(d.imageSize) ||
      !["nearest", "bilinear", "bicubic", "lanczos"].includes(d.imageSize.resampling))
  )
    throw new Error("Invalid output image size or resampling method.");
}
