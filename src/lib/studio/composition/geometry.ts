import {
  affine,
  compose,
  applyMatrix,
  inverse,
  fromAffine,
  type Matrix,
} from "../pro/transform.ts";
import type { CompositionObject, PanelFrame } from "./model.ts";
export function objectMatrix(
  object: CompositionObject,
  frames: PanelFrame[],
  objects: CompositionObject[],
): Matrix {
  const local = affine({
    x: object.x,
    y: object.y,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    rotation: object.rotation,
    shearX: object.skew,
  });
  if (object.parentId) {
    const parent = objects.find((o) => o.id === object.parentId);
    if (parent) return compose(objectMatrix(parent, frames, objects), local);
  }
  return compose(
    [
      1,
      0,
      0,
      1,
      0,
      object.owner ? (frames.find((f) => f.panel.id === object.owner)?.imageY ?? 0) : 0,
    ],
    local,
  );
}
export function objectBounds(
  object: CompositionObject,
  frames: PanelFrame[],
  objects: CompositionObject[],
) {
  const m = objectMatrix(object, frames, objects),
    points = [
      { x: 0, y: 0 },
      { x: object.width, y: 0 },
      { x: 0, y: object.height },
      { x: object.width, y: object.height },
    ].map((p) => applyMatrix(m, p));
  return {
    x: Math.min(...points.map((p) => p.x)),
    y: Math.min(...points.map((p) => p.y)),
    width: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    height: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
  };
}
export function hitObject(
  object: CompositionObject,
  point: { x: number; y: number },
  frames: PanelFrame[],
  objects: CompositionObject[],
) {
  const p = applyMatrix(inverse(objectMatrix(object, frames, objects)), point);
  return p.x >= 0 && p.y >= 0 && p.x <= object.width && p.y <= object.height;
}
export function reparent(
  object: CompositionObject,
  parentId: string | undefined,
  owner: string | undefined,
  frames: PanelFrame[],
  objects: CompositionObject[],
): CompositionObject {
  const parent = objects.find((o) => o.id === parentId),
    base: Matrix = parent
      ? objectMatrix(parent, frames, objects)
      : [1, 0, 0, 1, 0, owner ? (frames.find((f) => f.panel.id === owner)?.imageY ?? 0) : 0];
  const local = compose(inverse(base), objectMatrix(object, frames, objects));
  const t = fromAffine(local, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  return {
    ...object,
    parentId,
    owner,
    x: t.x,
    y: t.y,
    rotation: t.rotation,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    skew: t.shearX ?? 0,
  };
}

export function objectFlags(
  o: CompositionObject,
  objects: CompositionObject[],
  map = new Map(objects.map((o) => [o.id, o])),
) {
  let visible = o.visible && o.opacity > 0,
    locked = o.locked,
    parent = o.parentId,
    depth = 0;
  while (parent && depth++ < 64) {
    const p = map.get(parent);
    if (!p) return { visible: false, locked: true };
    visible = visible && p.visible && p.opacity > 0;
    locked = locked || p.locked;
    parent = p.parentId;
  }
  return { visible, locked };
}

/** Traverse creative groups in their actual draw order, skipping occluded root layers. */
export function pickCreative(
  document: import("./model.ts").CompositionDocument,
  frames: PanelFrame[],
  point: { x: number; y: number },
  stack: string[],
  above = -1,
): CompositionObject | null {
  const byParent = new Map<string | undefined, CompositionObject[]>();
  for (const o of document.objects) {
    const siblings = byParent.get(o.parentId) ?? [];
    siblings.push(o);
    byParent.set(o.parentId, siblings);
  }
  const hit = (o: CompositionObject): CompositionObject | null => {
    if (!o.visible || o.opacity <= 0) return null;
    if (o.clip && o.owner) {
      const f = frames.find((f) => f.panel.id === o.owner);
      if (
        f &&
        (point.x < 0 || point.x > document.width || point.y < f.imageY || point.y > f.bottomY)
      )
        return null;
    }
    if (o.kind === "group") {
      for (const child of [...(byParent.get(o.id) ?? [])].reverse()) {
        const selected = hit(child);
        if (selected) return selected;
      }
      return null;
    }
    return hitObject(o, point, frames, document.objects) ? o : null;
  };
  const byId = new Map(document.objects.map((o) => [o.id, o]));
  for (let i = stack.length - 1; i > above; i--) {
    if (!stack[i].startsWith("object:")) continue;
    const o = byId.get(stack[i].slice(7));
    if (o) {
      const selected = hit(o);
      if (selected) return selected;
    }
  }
  return null;
}

/** Rotate around the visual center instead of the local origin, preserving the world center. */
export function rotateAboutCenter(
  object: CompositionObject,
  rotation: number,
  frames: PanelFrame[],
  objects: CompositionObject[],
): CompositionObject {
  const c = { x: object.width / 2, y: object.height / 2 },
    before = applyMatrix(objectMatrix(object, frames, objects), c),
    next = { ...object, rotation },
    after = applyMatrix(objectMatrix(next, frames, objects), c);
  let dx = before.x - after.x,
    dy = before.y - after.y;
  const parent = objects.find((o) => o.id === object.parentId);
  if (parent) {
    const inv = inverse(objectMatrix(parent, frames, objects)),
      a = applyMatrix(inv, { x: 0, y: 0 }),
      b = applyMatrix(inv, { x: dx, y: dy });
    dx = b.x - a.x;
    dy = b.y - a.y;
  }
  return { ...next, x: object.x + dx, y: object.y + dy };
}
/** Move an unparented panel-local object to the panel under its center, keeping its world position. */
export function reanchor(
  object: CompositionObject,
  frames: PanelFrame[],
  objects: CompositionObject[],
) {
  if (object.parentId || !object.owner) return object;
  const b = objectBounds(object, frames, objects),
    cy = b.y + b.height / 2,
    target =
      frames.find((f) => cy >= f.top && cy < f.end) ??
      (cy >= (frames.at(-1)?.end ?? 0) ? frames.at(-1) : frames[0]);
  const current = frames.find((f) => f.panel.id === object.owner);
  if (!target || !current || target.panel.id === object.owner) return object;
  return { ...object, owner: target.panel.id, y: object.y + current.imageY - target.imageY };
}
export type Align =
  "left" | "center" | "right" | "top" | "middle" | "bottom" | "spread-x" | "spread-y";
/** Align top-level objects by their world bounds. Locked or grouped objects are left untouched. */
export function alignObjects(
  ids: string[],
  mode: Align,
  frames: PanelFrame[],
  objects: CompositionObject[],
): CompositionObject[] {
  const items = objects
    .filter((o) => ids.includes(o.id) && !o.parentId && !o.locked)
    .map((o) => ({ o, b: objectBounds(o, frames, objects) }));
  if (items.length < 2) return objects;
  const left = Math.min(...items.map((i) => i.b.x)),
    right = Math.max(...items.map((i) => i.b.x + i.b.width)),
    top = Math.min(...items.map((i) => i.b.y)),
    bottom = Math.max(...items.map((i) => i.b.y + i.b.height));
  const delta = new Map<string, { dx: number; dy: number }>();
  if (mode === "spread-x" || mode === "spread-y") {
    const horizontal = mode === "spread-x",
      sorted = [...items].sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y)),
      total = sorted.reduce((v, i) => v + (horizontal ? i.b.width : i.b.height), 0),
      gap = ((horizontal ? right - left : bottom - top) - total) / (sorted.length - 1);
    let cursor = horizontal ? left : top;
    for (const i of sorted) {
      delta.set(i.o.id, horizontal ? { dx: cursor - i.b.x, dy: 0 } : { dx: 0, dy: cursor - i.b.y });
      cursor += (horizontal ? i.b.width : i.b.height) + gap;
    }
  } else
    for (const { o, b } of items)
      delta.set(o.id, {
        dx:
          mode === "left"
            ? left - b.x
            : mode === "right"
              ? right - b.x - b.width
              : mode === "center"
                ? (left + right) / 2 - b.x - b.width / 2
                : 0,
        dy:
          mode === "top"
            ? top - b.y
            : mode === "bottom"
              ? bottom - b.y - b.height
              : mode === "middle"
                ? (top + bottom) / 2 - b.y - b.height / 2
                : 0,
      });
  return objects.map((o) => {
    const d = delta.get(o.id);
    return d ? { ...o, x: Math.round(o.x + d.dx), y: Math.round(o.y + d.dy) } : o;
  });
}
