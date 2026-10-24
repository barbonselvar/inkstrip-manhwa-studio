import {
  validateDocument,
  type ProDocument,
  type Selection,
  type Transform,
  type Point,
} from "./model.ts";
import { affine, compose, inverse, fromAffine, type Matrix } from "./transform.ts";
import { maskWorld } from "./masks.ts";
import { isLocked } from "./operations.ts";
import { translateLayers } from "./layers.ts";
import { documentSources } from "./raster-budget.ts";

export const CANVAS_ANCHORS = ["nw", "n", "ne", "w", "center", "e", "sw", "s", "se"] as const;
export type CanvasAnchor = (typeof CANVAS_ANCHORS)[number];
const move = (p: Point): Matrix => [1, 0, 0, 1, p.x, p.y];
export const contentAngle = (angle: number) => (((angle % 360) + 540) % 360) - 180;

/** Rebase a selection's OUTPUT frame; captured source coverage is never resampled. */
export function shiftSelection(s: Selection, delta: Point): Selection {
  if (!s.frame)
    return {
      ...s,
      regions: s.regions.map((r) => ({
        ...r,
        points: r.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
      })),
    };
  return {
    ...s,
    frame: {
      ...s.frame,
      matrix: compose(s.frame.matrix ?? [1, 0, 0, 1, 0, 0], move({ x: -delta.x, y: -delta.y })),
    },
  };
}

/** Canvas resizing changes the document origin, including locked artwork, exactly once.
 * Linked masks/local stroke and clone frames move with their owner; independent masks
 * and document-space review/selection/layout metadata need their own translation. */
export function resizeCanvas(
  doc: ProDocument,
  width: number,
  height: number,
  anchor: CanvasAnchor = "nw",
  maxArea = 16_777_216,
): ProDocument {
  if (
    !CANVAS_ANCHORS.includes(anchor) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > Math.min(maxArea, 16_777_216)
  )
    throw Error("Canvas size exceeds the integer dimensions or device memory budget.");
  const x = (CANVAS_ANCHORS.indexOf(anchor) % 3) / 2,
    y = Math.floor(CANVAS_ANCHORS.indexOf(anchor) / 3) / 2,
    delta = { x: (width - doc.width) * x, y: (height - doc.height) * y },
    matrix = move(delta),
    next: ProDocument = {
      ...doc,
      width,
      height,
      layers: doc.layers.map((l) => ({
        ...l,
        transform:
          l.kind === "group"
            ? l.transform
            : { ...l.transform, x: l.transform.x + delta.x, y: l.transform.y + delta.y },
        ...(l.mask && (l.mask.linked === false || l.kind === "group")
          ? {
              mask: {
                ...l.mask,
                placement:
                  l.mask.linked === false
                    ? compose(matrix, maskWorld(l))
                    : compose(inverse(affine(l.transform)), compose(matrix, maskWorld(l))),
              },
            }
          : {}),
      })),
      ...(doc.crop
        ? { crop: { ...doc.crop, x: doc.crop.x + delta.x, y: doc.crop.y + delta.y } }
        : {}),
      ...(doc.selection ? { selection: shiftSelection(doc.selection, delta) } : {}),
      ...(doc.savedSelections
        ? {
            savedSelections: doc.savedSelections.map((s) => ({
              ...s,
              selection: shiftSelection(s.selection, delta),
            })),
          }
        : {}),
      ...(doc.artboards
        ? { artboards: doc.artboards.map((b) => ({ ...b, x: b.x + delta.x, y: b.y + delta.y })) }
        : {}),
      ...(doc.layout
        ? {
            layout: {
              ...doc.layout,
              guides: doc.layout.guides.map((g) => ({
                ...g,
                position: g.position + (g.axis === "x" ? delta.x : delta.y),
              })),
            },
          }
        : {}),
      ...(doc.dialogue
        ? {
            dialogue: {
              ...doc.dialogue,
              regions: doc.dialogue.regions.map((r) => ({
                ...r,
                x: r.x + delta.x,
                y: r.y + delta.y,
              })),
            },
          }
        : {}),
    };
  validateDocument(next);
  documentSources(next, maxArea);
  return next;
}

/** Affine mask placement is stored using the existing native matrix representation. */
export function maskFrame(doc: ProDocument, id: string) {
  const l = doc.layers.find((l) => l.id === id);
  if (!l?.mask || isLocked(doc, id)) throw Error("Select an unlocked layer with a mask.");
  if (l.transform.deform)
    throw Error("Mask-only transforms require an affine layer. Reset Perspective or Warp first.");
  return {
    width: l.mask.width ?? l.width,
    height: l.mask.height ?? l.height,
    transform: fromAffine(maskWorld(l), { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }),
  };
}
export function transformMask(doc: ProDocument, id: string, value: Transform): ProDocument {
  maskFrame(doc, id);
  if (value.deform) throw Error("Mask-only transforms support affine geometry only.");
  const next = {
    ...doc,
    layers: doc.layers.map((l) =>
      l.id !== id
        ? l
        : {
            ...l,
            mask: {
              ...l.mask!,
              placement:
                l.mask!.linked === false
                  ? affine(value)
                  : compose(inverse(affine(l.transform)), affine(value)),
            },
          },
    ),
  };
  validateDocument(next);
  return next;
}
export function nudgeDocument(doc: ProDocument, ids: string[], delta: Point, maskOnly = false) {
  if (![delta.x, delta.y].every(Number.isFinite)) throw Error("Invalid nudge distance.");
  if (!maskOnly) return translateLayers(doc, ids, delta);
  if (ids.length !== 1) throw Error("Choose one mask to nudge.");
  const frame = maskFrame(doc, ids[0]!);
  return transformMask(doc, ids[0]!, {
    ...frame.transform,
    x: frame.transform.x + delta.x,
    y: frame.transform.y + delta.y,
  });
}
