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
