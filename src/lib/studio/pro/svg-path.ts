/** SVG path grammar -> editable cubic contours. No DOM insertion or polyline flattening. */
import type { Contour, Point } from "./model.ts";
import { compose, type Matrix } from "./transform.ts";
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const reflected = (c: Point, p: Point): Point => ({ x: 2 * p.x - c.x, y: 2 * p.y - c.y });
/** A Bernstein convex-hull bound on |r²-1| for a tangent cubic on the unit circle.
 * Radial projection bounds geometric distance, not equal-parameter angular speed.
 * Ellipse/rotation error is at most max(rx,ry) times this unit-circle bound. */
function arcBound(angle: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    k = (4 / 3) * Math.tan(angle / 4),
    p = [
      { x: 1, y: 0 },
      { x: 1, y: k },
      { x: c + k * s, y: s - k * c },
      { x: c, y: s },
    ],
    choose3 = [1, 3, 3, 1],
    choose6 = [1, 6, 15, 20, 15, 6, 1];
  let bound = 0;
  for (let n = 0; n <= 6; n++) {
    let value = 0;
    for (let i = 0; i <= 3; i++) {
      const j = n - i;
      if (j >= 0 && j <= 3)
        value +=
          ((p[i]!.x * p[j]!.x + p[i]!.y * p[j]!.y) * choose3[i]! * choose3[j]!) / choose6[n]!;
    }
    bound = Math.max(bound, Math.abs(value - 1));
  }
  bound += Number.EPSILON * 64;
  return bound / (1 + Math.sqrt(Math.max(0, 1 - bound)));
}
export function parseSvgPath(
  source: string,
  tolerance = 0.01,
): { contours: Contour[]; arcErrorBound: number } {
  if (
    typeof source !== "string" ||
    source.length > 100000 ||
    !Number.isFinite(tolerance) ||
    tolerance < 1e-6 ||
    tolerance > 1
  )
    throw new Error("SVG path exceeds conversion limits or precision budget.");
  if (/(?:[MmLlHhVvCcSsQqTtAaZz]|^)\s*,|,\s*(?:[MmLlHhVvCcSsQqTtAaZz]|$)|,\s*,/.test(source))
    throw new Error("Invalid SVG path separators.");
  let i = 0,
    command = "",
    previous = "",
    current: Point = { x: 0, y: 0 },
    cubicControl: Point | undefined,
    quadraticControl: Point | undefined,
    contour: Contour | undefined,
    count = 0,
    arcErrorBound = 0;
  const contours: Contour[] = [];
  const skip = () => {
    while (/[\s,]/.test(source[i] ?? "!") && i < source.length) i++;
  };
  const number = () => {
    skip();
    const m = source.slice(i).match(NUMBER);
    if (!m) throw new Error(`Missing SVG path coordinate at ${i}.`);
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n) || Math.abs(n) > 1e6)
      throw new Error("SVG coordinates exceed conversion range.");
    return n;
  };
  const flag = () => {
    skip();
    const c = source[i++];
    if (c !== "0" && c !== "1") throw new Error("SVG arc flags must be 0 or 1.");
    return c === "1";
  };
  const point = (relative: boolean): Point => {
    const x = number(),
      y = number();
    return { x: x + (relative ? current.x : 0), y: y + (relative ? current.y : 0) };
  };
  const start = (p: Point) => {
    if (contours.length >= 128) throw new Error("SVG conversion exceeds 128 subpaths.");
    contour = { anchors: [{ ...p }], closed: false };
    contours.push(contour);
    current = p;
    if (++count > 1000) throw new Error("SVG conversion exceeds the 1000-anchor limit.");
  };
  const append = (p: Point, c1?: Point, c2?: Point) => {
    if (!contour) throw new Error("SVG paths must start with Move.");
    if (contour.closed) start({ ...current });
    if (++count > 1000) throw new Error("SVG conversion exceeds the 1000-anchor limit.");
    if (c1) contour!.anchors.at(-1)!.outgoing = c1;
    contour!.anchors.push({ ...p, ...(c2 ? { incoming: c2 } : {}) });
    current = p;
  };
  while (true) {
    skip();
    if (i >= source.length) break;
    if (/[a-z]/i.test(source[i]!)) command = source[i++]!;
    else if (!command || command.toUpperCase() === "Z")
      throw new Error(`Invalid SVG path command at ${i}.`);
    const op = command.toUpperCase(),
      relative = command !== op;
    if (!contour && op !== "M") throw new Error("SVG paths must start with Move.");
    let nextCubic: Point | undefined, nextQuadratic: Point | undefined;
    if (op === "M") {
      start(point(relative));
      command = relative ? "l" : "L";
    } else if (op === "L") append(point(relative));
    else if (op === "H") {
      const x = number();
      append({ x: x + (relative ? current.x : 0), y: current.y });
    } else if (op === "V") {
      const y = number();
      append({ x: current.x, y: y + (relative ? current.y : 0) });
    } else if (op === "C") {
      const a = point(relative),
        b = point(relative),
        p = point(relative);
      append(p, a, b);
      nextCubic = b;
    } else if (op === "S") {
      const a =
          ["C", "S"].includes(previous) && cubicControl
            ? reflected(cubicControl, current)
            : { ...current },
        b = point(relative),
        p = point(relative);
      append(p, a, b);
      nextCubic = b;
    } else if (op === "Q" || op === "T") {
      const q =
          op === "Q"
            ? point(relative)
            : ["Q", "T"].includes(previous) && quadraticControl
              ? reflected(quadraticControl, current)
              : { ...current },
        p = point(relative);
      const a = mix(current, q, 2 / 3),
        b = mix(p, q, 2 / 3);
      append(p, a, b);
      nextQuadratic = q;
    } else if (op === "A") {
      let rx = Math.abs(number()),
        ry = Math.abs(number());
      const phi = (number() * Math.PI) / 180,
        large = flag(),
        sweep = flag(),
        end = point(relative),
        begin = { ...current };
      if (begin.x !== end.x || begin.y !== end.y) {
        if (!rx || !ry) append(end);
        else {
          const cos = Math.cos(phi),
            sin = Math.sin(phi),
            dx = (begin.x - end.x) / 2,
            dy = (begin.y - end.y) / 2,
            xp = cos * dx + sin * dy,
            yp = -sin * dx + cos * dy,
            scale = Math.hypot(xp / rx, yp / ry);
          if (scale > 1) {
            rx *= scale;
            ry *= scale;
          }
          const ux = xp / rx,
            uy = yp / ry,
            denominator = ux * ux + uy * uy;
          if (![rx, ry, scale, denominator].every(Number.isFinite) || denominator === 0)
            throw new Error("SVG arc exceeds floating-point precision limits.");
          const factor =
              (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (1 - denominator) / denominator)),
            cxp = factor * rx * uy,
            cyp = -factor * ry * ux,
            cx = cos * cxp - sin * cyp + (begin.x + end.x) / 2,
            cy = sin * cxp + cos * cyp + (begin.y + end.y) / 2,
            a = { x: (xp - cxp) / rx, y: (yp - cyp) / ry },
            b = { x: (-xp - cxp) / rx, y: (-yp - cyp) / ry },
            theta = Math.atan2(a.y, a.x);
          let delta = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
          if (![cx, cy, theta, delta].every(Number.isFinite))
            throw new Error("SVG arc exceeds floating-point precision limits.");
          if (!sweep && delta > 0) delta -= 2 * Math.PI;
          if (sweep && delta < 0) delta += 2 * Math.PI;
          let n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
          while (Math.max(rx, ry) * arcBound(Math.abs(delta) / n) > tolerance) {
            n *= 2;
            if (n + count > 1000)
              throw new Error("Arc conversion exceeds the 1000-anchor precision budget.");
          }
          const h = delta / n,
            tangent = (4 / 3) * Math.tan(h / 4);
          if (n + count > 1000)
            throw new Error("Arc conversion exceeds the 1000-anchor precision budget.");
          const evaluate = (angle: number): Point => ({
              x: cx + rx * cos * Math.cos(angle) - ry * sin * Math.sin(angle),
              y: cy + rx * sin * Math.cos(angle) + ry * cos * Math.sin(angle),
            }),
            derivative = (angle: number): Point => ({
              x: -rx * cos * Math.sin(angle) - ry * sin * Math.cos(angle),
              y: -rx * sin * Math.sin(angle) + ry * cos * Math.cos(angle),
            });
          for (let k = 0; k < n; k++) {
            const t0 = theta + k * h,
              t1 = t0 + h,
              p0 = { ...current },
              p1 = k === n - 1 ? end : evaluate(t1),
              d0 = derivative(t0),
              d1 = derivative(t1);
            append(
              p1,
              { x: p0.x + tangent * d0.x, y: p0.y + tangent * d0.y },
              { x: p1.x - tangent * d1.x, y: p1.y - tangent * d1.y },
            );
          }
          arcErrorBound = Math.max(arcErrorBound, Math.max(rx, ry) * arcBound(Math.abs(h)));
        }
      }
    } else if (op === "Z") {
      contour!.closed = true;
      const first = contour!.anchors[0]!,
        last = contour!.anchors.at(-1)!;
      if (contour!.anchors.length > 1 && first.x === last.x && first.y === last.y) {
        if (last.incoming) first.incoming = { ...last.incoming };
        contour!.anchors.pop();
        count--;
      }
      current = { x: first.x, y: first.y };
    } else throw new Error(`Unsupported SVG path command: ${command}.`);
    previous = op;
    cubicControl = nextCubic;
    quadraticControl = nextQuadratic;
  }
  for (const c of contours)
    for (const a of c.anchors)
      for (const p of [a, a.incoming, a.outgoing])
        if (
          p &&
          (!Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            Math.abs(p.x) > 100000 ||
            Math.abs(p.y) > 100000)
        )
          throw new Error("Converted SVG coordinates exceed native limits.");
  return { contours, arcErrorBound };
}
/** SVG transform lists compose in SVG order, including reflections and shear. */
export function svgMatrix(source: string): Matrix {
  let matrix: Matrix = [1, 0, 0, 1, 0, 0],
    rest = source.trim(),
    count = 0;
  while (rest) {
    if (++count > 64 || source.length > 4000) throw new Error("SVG transform list exceeds limits.");
    const m = rest.match(/^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/);
    if (!m) throw new Error("Unsupported SVG transform.");
    const raw = m[2]!,
      matches = [...raw.matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)];
    if (raw.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, "").replace(/[\s,]/g, ""))
      throw new Error("Invalid SVG transform coordinates.");
    let end = 0;
    for (const [index, match] of matches.entries()) {
      const separator = raw.slice(end, match.index);
      if (!(index === 0 ? /^\s*$/ : /^(?:\s+,?\s*|,\s*)$/).test(separator))
        throw new Error("Invalid SVG transform separators.");
      end = match.index! + match[0].length;
    }
    if (!/^\s*$/.test(raw.slice(end))) throw new Error("Invalid SVG transform separators.");
    const a = matches.map((x) => Number(x[0]));
    if (!a.every(Number.isFinite)) throw new Error("Non-finite SVG transform.");
    let local: Matrix;
    if (m[1] === "matrix" && a.length === 6) local = a as Matrix;
    else if (m[1] === "translate" && [1, 2].includes(a.length))
      local = [1, 0, 0, 1, a[0]!, a[1] ?? 0];
    else if (m[1] === "scale" && [1, 2].includes(a.length))
      local = [a[0]!, 0, 0, a[1] ?? a[0]!, 0, 0];
    else if (m[1] === "rotate" && [1, 3].includes(a.length)) {
      const r = (a[0]! * Math.PI) / 180,
        c = Math.cos(r),
        s = Math.sin(r),
        x = a[1] ?? 0,
        y = a[2] ?? 0;
      local = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
    } else if (["skewX", "skewY"].includes(m[1]!) && a.length === 1) {
      const t = Math.tan((a[0]! * Math.PI) / 180);
      local = m[1] === "skewX" ? [1, 0, t, 1, 0, 0] : [1, t, 0, 1, 0, 0];
    } else throw new Error("Invalid SVG transform arity.");
    matrix = compose(matrix, local);
    if (/^\s*,\s*$/.test(rest.slice(m[0].length)))
      throw new Error("Invalid SVG transform separator.");
    rest = rest.slice(m[0].length).replace(/^\s*,?\s*/, "");
  }
  if (
    !matrix.every(Number.isFinite) ||
    Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-10
  )
    throw new Error("Singular SVG transform.");
  return matrix;
}
