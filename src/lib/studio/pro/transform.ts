import type { Point, Transform } from "./model.ts";
export type Matrix = [number, number, number, number, number, number];
export type Homography = [number, number, number, number, number, number, number, number, number];
export type Deformation = {
  kind: "perspective" | "warp";
  width: number;
  height: number;
  points: Point[];
};
export const QUAD: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
export const MESH: Point[] = Array.from({ length: 9 }, (_, i) => ({
  x: (i % 3) / 2,
  y: Math.floor(i / 3) / 2,
}));
export const TRANSFORM_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type TransformMode = "affine" | "perspective" | "warp";
export const applyMatrix = (m: Matrix, p: Point): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
export function compose(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverse(m: Matrix): Matrix {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-10) throw new Error("Singular transform.");
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
/** T(position) T(pivot) R ShearY ShearX Scale Flip T(-pivot). Legacy pivot is zero. */
export function affine(t: Transform): Matrix {
  const r = (t.rotation * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r),
    x = Math.tan(((t.shearX ?? 0) * Math.PI) / 180),
    y = Math.tan(((t.shearY ?? 0) * Math.PI) / 180),
    sx = t.scaleX * (t.flipX ? -1 : 1),
    sy = t.scaleY * (t.flipY ? -1 : 1),
    p = t.pivot ?? { x: 0, y: 0 },
    a = (c - s * y) * sx,
    b = (s + c * y) * sx,
    e = (c * x - s * (1 + x * y)) * sy,
    f = (s * x + c * (1 + x * y)) * sy;
  return [a, b, e, f, t.x + p.x - a * p.x - e * p.y, t.y + p.y - b * p.x - f * p.y];
}
export function withPivot(t: Transform, pivot: Point): Transform {
  const old = affine(t),
    next = { ...t, pivot },
    m = affine(next);
  return { ...next, x: t.x + old[4] - m[4], y: t.y + old[5] - m[5] };
}
/** Exact QR factorization back into editable fields; deformation remains in the source plane. */
export function fromAffine(m: Matrix, original: Transform): Transform {
  const sx = Math.hypot(m[0], m[1]),
    sy = (m[0] * m[3] - m[1] * m[2]) / sx,
    pivot = original.pivot ?? { x: 0, y: 0 },
    result: Transform = {
      ...original,
      x: m[4] - pivot.x + m[0] * pivot.x + m[2] * pivot.y,
      y: m[5] - pivot.y + m[1] * pivot.x + m[3] * pivot.y,
      scaleX: sx,
      scaleY: Math.abs(sy),
      rotation: (Math.atan2(m[1], m[0]) * 180) / Math.PI,
      shearX: (Math.atan((m[0] * m[2] + m[1] * m[3]) / (sx * sy)) * 180) / Math.PI,
      shearY: 0,
      flipX: false,
      flipY: sy < 0,
    };
  validateTransform(result);
  return result;
}
export const pivotWorld = (t: Transform): Point => ({
  x: t.x + (t.pivot?.x ?? 0),
  y: t.y + (t.pivot?.y ?? 0),
});
export function anchored(t: Transform, p: Point, fixed: Point): Transform {
  const q = applyMatrix(affine(t), p);
  return { ...t, x: t.x + fixed.x - q.x, y: t.y + fixed.y - q.y };
}
/** Unit square to convex quadrilateral. Projective division is retained, never triangulated affine. */
export function homography(q: Point[]): Homography {
  const [a, b, c, d] = q as [Point, Point, Point, Point],
    dx1 = b.x - c.x,
    dx2 = d.x - c.x,
    dx3 = a.x - b.x + c.x - d.x,
    dy1 = b.y - c.y,
    dy2 = d.y - c.y,
    dy3 = a.y - b.y + c.y - d.y,
    den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-10) throw new Error("Degenerate perspective quadrilateral.");
  const g = (dx3 * dy2 - dx2 * dy3) / den,
    h = (dx1 * dy3 - dx3 * dy1) / den;
  return [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
    1,
  ];
}
export function inverseHomography(m: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = m,
    A = e * i - f * h,
    B = f * g - d * i,
    C = d * h - e * g,
    D = c * h - b * i,
    E = a * i - c * g,
    F = b * g - a * h,
    G = b * f - c * e,
    H = c * d - a * f,
    I = a * e - b * d,
    det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10)
    throw new Error("Singular perspective matrix.");
  return [A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det];
}
export function project(m: Homography, p: Point): Point {
  const z = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / z, y: (m[3] * p.x + m[4] * p.y + m[5]) / z };
}
const basis = (t: number) => [(1 - t) ** 2, 2 * t * (1 - t), t * t];
/** Tensor-product quadratic Bézier surface. Bounded control offsets guarantee a positive Jacobian. */
export function warp(points: Point[], p: Point): Point {
  const x = basis(p.x),
    y = basis(p.y);
  let a = 0,
    b = 0;
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const w = x[i]! * y[j]!,
        q = points[j * 3 + i]!;
      a += w * q.x;
      b += w * q.y;
    }
  return { x: a, y: b };
}
export function unwarp(points: Point[], p: Point): Point {
  let q = { ...p };
  for (let n = 0; n < 14; n++) {
    const f = warp(points, q),
      dx = f.x - p.x,
      dy = f.y - p.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 1e-10) return q;
    const bx = basis(q.x),
      by = basis(q.y),
      ux = [-2 * (1 - q.x), 2 - 4 * q.x, 2 * q.x],
      uy = [-2 * (1 - q.y), 2 - 4 * q.y, 2 * q.y];
    let a = 0,
      b = 0,
      c = 0,
      d = 0;
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const v = points[j * 3 + i]!;
        a += ux[i]! * by[j]! * v.x;
        b += ux[i]! * by[j]! * v.y;
        c += bx[i]! * uy[j]! * v.x;
        d += bx[i]! * uy[j]! * v.y;
      }
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-10) break;
    q = { x: q.x - (d * dx - c * dy) / det, y: q.y - (-b * dx + a * dy) / det };
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || Math.abs(q.x) > 8 || Math.abs(q.y) > 8)
      break;
  }
  return { x: NaN, y: NaN };
}
/** Compile once for per-pixel inverse mapping and document-space input/selection sampling. */
export function mapping(t: Transform) {
  const m = affine(t),
    inv = inverse(m),
    d = t.deform,
    h = d?.kind === "perspective" ? homography(d.points) : undefined,
    ih = h ? inverseHomography(h) : undefined;
  return {
    forward(p: Point): Point {
      if (d) {
        let q = { x: p.x / d.width, y: p.y / d.height };
        q = h ? project(h, q) : warp(d.points, q);
        p = { x: q.x * d.width, y: q.y * d.height };
      }
      return applyMatrix(m, p);
    },
    backward(p: Point): Point {
      p = applyMatrix(inv, p);
      if (d) {
        let q = { x: p.x / d.width, y: p.y / d.height };
        q = ih ? project(ih, q) : unwarp(d.points, q);
        p = { x: q.x * d.width, y: q.y * d.height };
      }
      return p;
    },
  };
}
export function validateTransform(t: Transform) {
  const n = (x: unknown, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  if (
    !t ||
    !n(t.x, -100000, 100000) ||
    !n(t.y, -100000, 100000) ||
    !n(t.scaleX, 0.01, 100) ||
    !n(t.scaleY, 0.01, 100) ||
    !n(t.rotation, -360, 360) ||
    (t.shearX !== undefined && !n(t.shearX, -75, 75)) ||
    (t.shearY !== undefined && !n(t.shearY, -75, 75)) ||
    (t.flipX !== undefined && typeof t.flipX !== "boolean") ||
    (t.flipY !== undefined && typeof t.flipY !== "boolean") ||
    (t.pivot !== undefined &&
      (!t.pivot || !n(t.pivot.x, -100000, 100000) || !n(t.pivot.y, -100000, 100000)))
  )
    throw new Error("Invalid layer transform.");
  if (t.deform !== undefined) {
    const d = t.deform;
    if (!d || typeof d !== "object") throw new Error("Invalid deformation cage.");
    if (
      !["perspective", "warp"].includes(d.kind) ||
      !n(d.width, 1, 16384) ||
      !n(d.height, 1, 16384) ||
      d.width * d.height > 16_777_216 ||
      !Array.isArray(d.points) ||
      d.points.length !== (d.kind === "warp" ? 9 : 4) ||
      !d.points.every((p) => p && n(p.x, -2, 3) && n(p.y, -2, 3))
    )
      throw new Error("Invalid deformation cage.");
    if (d.kind === "warp") {
      // Each partial derivative differs from identity by at most .4; determinant >= .2.
      if (
        d.points.some(
          (p, i) =>
            Math.abs(p.x - MESH[i]!.x) > 0.100000001 || Math.abs(p.y - MESH[i]!.y) > 0.100000001,
        )
      )
        throw new Error("Warp control offsets are limited to 10% to prevent folds.");
    } else {
      for (let i = 0; i < 4; i++) {
        const a = d.points[i]!,
          b = d.points[(i + 1) % 4]!,
          c = d.points[(i + 2) % 4]!;
        if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < 0.005)
          throw new Error("Perspective corners must form a convex, non-degenerate quadrilateral.");
      }
      const h = homography(d.points);
      inverseHomography(h);
      if (QUAD.some((p) => h[6] * p.x + h[7] * p.y + 1 < 0.02))
        throw new Error("Perspective crosses its vanishing line.");
    }
  }
  inverse(affine(t));
}
/** Exact boundary extrema: projective corners, or quadratic Bézier edges (after affine). */
export function bounds(t: Transform, width: number, height: number) {
  const map = mapping(t);
  let points: Point[];
  if (t.deform?.kind === "warp") {
    const controls = t.deform.points.map((p) =>
      applyMatrix(affine(t), { x: p.x * width, y: p.y * height }),
    );
    points = [];
    for (const ids of [
      [0, 1, 2],
      [2, 5, 8],
      [6, 7, 8],
      [0, 3, 6],
    ]) {
      const [a, b, c] = ids.map((i) => controls[i]!) as [Point, Point, Point];
      points.push(a, c);
      for (const axis of ["x", "y"] as const) {
        const den = a[axis] - 2 * b[axis] + c[axis],
          u = (a[axis] - b[axis]) / den;
        if (u > 0 && u < 1)
          points.push({
            x: (1 - u) ** 2 * a.x + 2 * u * (1 - u) * b.x + u * u * c.x,
            y: (1 - u) ** 2 * a.y + 2 * u * (1 - u) * b.y + u * u * c.y,
          });
      }
    }
  } else points = QUAD.map((p) => map.forward({ x: p.x * width, y: p.y * height }));
  const left = Math.min(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y)),
    right = Math.max(...points.map((p) => p.x)),
    bottom = Math.max(...points.map((p) => p.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function frame(t: Transform, width: number, height: number) {
  const b = bounds(
      {
        ...t,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        shearX: 0,
        shearY: 0,
        flipX: false,
        flipY: false,
        pivot: undefined,
      },
      width,
      height,
    ),
    m = affine(t);
  return {
    local: b,
    points: TRANSFORM_HANDLES.map((h) =>
      applyMatrix(m, {
        x: b.x + (h.includes("w") ? 0 : h.includes("e") ? b.width : b.width / 2),
        y: b.y + (h.includes("n") ? 0 : h.includes("s") ? b.height : b.height / 2),
      }),
    ),
  };
}
export function dragTransform(
  t: Transform,
  width: number,
  height: number,
  handle: string,
  start: Point,
  p: Point,
  lock = false,
  alt = false,
  snap = false,
): Transform {
  const m = affine(t),
    inv = inverse(m),
    b = frame(t, width, height).local;
  let result: Transform = { ...t };
  if (handle === "move") result = { ...t, x: t.x + p.x - start.x, y: t.y + p.y - start.y };
  else if (handle === "pivot") result = withPivot(t, applyMatrix(inv, p));
  else if (handle === "rotate") {
    const c = pivotWorld(t),
      delta =
        ((Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x)) * 180) /
        Math.PI;
    let r = t.rotation + delta;
    if (snap) r = Math.round(r / 15) * 15;
    result = { ...t, rotation: ((r + 540) % 360) - 180 };
  } else if (handle.startsWith("point-")) {
    const d = t.deform!,
      i = Number(handle.slice(6)),
      q = applyMatrix(inv, p),
      points = d.points.map((v) => ({ ...v }));
    let x = q.x / d.width,
      y = q.y / d.height;
    if (d.kind === "warp") {
      x = Math.max(MESH[i]!.x - 0.1, Math.min(MESH[i]!.x + 0.1, x));
      y = Math.max(MESH[i]!.y - 0.1, Math.min(MESH[i]!.y + 0.1, y));
    }
    points[i] = { x, y };
    result = { ...t, deform: { ...d, points } };
  } else {
    const w = handle.includes("w"),
      e = handle.includes("e"),
      n = handle.includes("n"),
      s = handle.includes("s"),
      a = alt
        ? (t.pivot ?? { x: 0, y: 0 })
        : {
            x: b.x + (w ? b.width : e ? 0 : b.width / 2),
            y: b.y + (n ? b.height : s ? 0 : b.height / 2),
          },
      q = applyMatrix(inv, p),
      first = applyMatrix(inv, start);
    let sx = w || e ? 1 + (q.x - first.x) / ((w ? b.x : b.x + b.width) - a.x) : 1,
      sy = n || s ? 1 + (q.y - first.y) / ((n ? b.y : b.y + b.height) - a.y) : 1;
    if (lock) {
      const magnitude =
        (w || e) && (!(n || s) || Math.abs(sx - 1) >= Math.abs(sy - 1))
          ? Math.abs(sx)
          : Math.abs(sy);
      sx = (sx < 0 ? -1 : 1) * magnitude;
      sy = (sy < 0 ? -1 : 1) * magnitude;
    }
    result = anchored(
      {
        ...t,
        scaleX: Math.max(0.01, Math.min(100, t.scaleX * Math.abs(sx))),
        scaleY: Math.max(0.01, Math.min(100, t.scaleY * Math.abs(sy))),
        flipX: !!t.flipX !== sx < 0,
        flipY: !!t.flipY !== sy < 0,
      },
      a,
      applyMatrix(m, a),
    );
  }
  validateTransform(result);
  return result;
}

export function transformHandles(
  d: { value: Transform; mode: TransformMode },
  l: { width: number; height: number },
  screenScale: number,
) {
  const f = frame(d.value, l.width, l.height),
    top = f.points[1]!,
    center = pivotWorld(d.value),
    angle = (d.value.rotation * Math.PI) / 180,
    rotation = {
      x: top.x + (Math.sin(angle) * 28) / screenScale,
      y: top.y - (Math.cos(angle) * 28) / screenScale,
    };
  const handles: { id: string; p: Point }[] =
    d.mode === "affine"
      ? f.points.map((p, i) => ({ id: ["nw", "n", "ne", "e", "se", "s", "sw", "w"][i]!, p }))
      : [];
  if (d.mode !== "affine" && d.value.deform) {
    const deform = d.value.deform;
    handles.push(
      ...deform.points.map((p, i) => ({
        id: `point-${i}`,
        p: applyMatrix(affine(d.value), { x: p.x * deform.width, y: p.y * deform.height }),
      })),
    );
  }
  handles.push({ id: "rotate", p: rotation }, { id: "pivot", p: center });
  return { ...f, handles, rotation, center };
}

/** Captured inverse frames need the complete affine matrix: QR controls with a
 * bounded shear range cannot represent every valid inverse of a layer pose. */
export function validateAffineMatrix(value: unknown): asserts value is Matrix {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    !value.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e12)
  )
    throw Error("Invalid affine coordinate frame.");
  inverse(value as Matrix);
}
