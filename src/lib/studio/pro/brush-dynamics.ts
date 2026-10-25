import type { Stroke } from "./model.ts";
type BrushPoint = Stroke["points"][number];
/** Mouse/touch retain the configured size; only a pen's real pressure changes it. */
export function brushPoint(
  previous: BrushPoint | undefined,
  point: BrushPoint,
  pointerType: string,
  pressure: number,
  enabled: boolean,
  smoothing: number,
  stabilization = 0,
  pressureGamma = 1,
): BrushPoint {
  const dt =
    previous?.time !== undefined && point.time !== undefined
      ? point.time - previous.time
      : undefined;
  const factor =
    dt !== undefined && smoothing > 0
      ? 1 - Math.exp(-Math.max(0.1, Math.min(200, dt)) / (smoothing * 80))
      : 1 - Math.max(0, Math.min(0.95, smoothing)) * 0.9;
  if (previous && stabilization > 0) {
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y),
      keep = Math.max(0, distance - stabilization) / Math.max(0.0001, distance);
    point = {
      ...point,
      x: previous.x + (point.x - previous.x) * keep,
      y: previous.y + (point.y - previous.y) * keep,
    };
  }
  return {
    x: previous ? previous.x + (point.x - previous.x) * factor : point.x,
    y: previous ? previous.y + (point.y - previous.y) * factor : point.y,
    ...(point.time !== undefined ? { time: point.time } : {}),
    ...(enabled && pointerType === "pen"
      ? { pressure: pressureResponse(Number.isFinite(pressure) ? pressure : 1, pressureGamma) }
      : {}),
  };
}

/** Pen pressure response curve, p^gamma, applied once as input is recorded. Stored
 * pressures keep their existing meaning, so documents render the same everywhere. */
export const PRESSURE_GAMMA = { min: 0.25, max: 4 } as const;
export function pressureResponse(pressure: number, gamma = 1) {
  const g = Number.isFinite(gamma)
    ? Math.max(PRESSURE_GAMMA.min, Math.min(PRESSURE_GAMMA.max, gamma))
    : 1;
  return Math.max(0.05, Math.min(1, Math.max(0, Math.min(1, pressure)) ** g));
}

export const MAX_STROKE_POINTS = 10_000;
/** Stroke validation also caps dynamic strokes at 200,000 dabs of the 0.25 px minimum
 * spacing, i.e. a 50,000-unit stored path; recording must stop inside both budgets. */
export const MAX_DAB_PATH = 50_000;
type RecordedStroke = Pick<Stroke, "points" | "size" | "smoothing" | "sizePressure" | "dynamics">;
type Sample = { pointerType: string; pressure: number; pressureGamma?: number };
const pathLength = (points: BrushPoint[]) => {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return length;
};
const fits = (s: RecordedStroke, length: number, segment: number) =>
  s.points.length < MAX_STROKE_POINTS && (!s.dynamics || length + segment <= MAX_DAB_PATH);
/** Filter every sample, but store a point only when it moves a size-relative step or
 * pressure changes, so long or slow strokes stay inside the point and dab budgets.
 * Returns the new filter state, the stored path `length` (pass it back to avoid
 * re-measuring) and `full` once the stroke cannot grow without failing validation. */
export function appendBrushSample(
  s: RecordedStroke,
  filtered: BrushPoint | undefined,
  raw: BrushPoint,
  input: Sample,
  length = pathLength(s.points),
) {
  const last = s.points.at(-1)!,
    state = filtered ?? last;
  if (!fits(s, length, 0)) return { filtered: state, length, full: true };
  if (Math.hypot(raw.x - state.x, raw.y - state.y) <= 0.001)
    return { filtered: state, length, full: false };
  const next = brushPoint(
    state,
    raw,
    input.pointerType,
    input.pressure,
    (s.sizePressure || s.dynamics?.opacityPressure) ?? false,
    s.smoothing ?? 0,
    s.dynamics?.stabilization ?? 0,
    input.pressureGamma,
  );
  const segment = Math.hypot(next.x - last.x, next.y - last.y);
  if (
    segment >= Math.max(0.25, s.size * 0.02) ||
    Math.abs((next.pressure ?? 1) - (last.pressure ?? 1)) >= 0.02
  ) {
    if (!fits(s, length, segment)) return { filtered: next, length, full: true };
    s.points.push(next);
    length += segment;
  }
  return { filtered: next, length, full: !fits(s, length, 0) };
}
/** On release, end exactly at the lifted pointer: smoothing and stabilization lag
 * behind it by design, so append the unfiltered final position (catch-up). */
export function finishBrushStroke(
  s: RecordedStroke,
  filtered: BrushPoint | undefined,
  raw: BrushPoint,
  length = pathLength(s.points),
) {
  const last = s.points.at(-1)!,
    pressure = (filtered ?? last).pressure,
    segment = Math.hypot(raw.x - last.x, raw.y - last.y);
  if (segment <= 0.001 || !fits(s, length, segment)) return;
  s.points.push({
    x: raw.x,
    y: raw.y,
    ...(raw.time !== undefined ? { time: Math.max(raw.time, last.time ?? 0) } : {}),
    ...(pressure !== undefined ? { pressure } : {}),
  });
}

export type DabDynamics = {
  stabilization?: number;
  spacing: number;
  roundness: number;
  angle: number;
  scatter: number;
  sizeJitter: number;
  opacityJitter: number;
  opacityPressure: boolean;
  velocity: number;
  followDirection: boolean;
};
export const DAB_DEFAULTS: DabDynamics = {
  spacing: 0.1,
  roundness: 1,
  angle: 0,
  scatter: 0,
  sizeJitter: 0,
  opacityJitter: 0,
  opacityPressure: false,
  velocity: 0,
  followDirection: false,
};
export function validateDynamics(d: DabDynamics) {
  if (
    d.stabilization !== undefined &&
    (!Number.isFinite(d.stabilization) || d.stabilization < 0 || d.stabilization > 200)
  )
    throw Error("Invalid brush stabilization.");
  for (const [key, min, max] of [
    ["spacing", 0.01, 2],
    ["roundness", 0.05, 1],
    ["angle", -360, 360],
    ["scatter", 0, 2],
    ["sizeJitter", 0, 1],
    ["opacityJitter", 0, 1],
    ["velocity", 0, 1],
  ] as const)
    if (!Number.isFinite(d[key]) || d[key] < min || d[key] > max)
      throw Error(`Invalid brush ${key}.`);
  if (typeof d.opacityPressure !== "boolean" || typeof d.followDirection !== "boolean")
    throw Error("Invalid brush pressure/direction settings.");
}
export type Dab = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  angle: number;
  roundness: number;
};
/** Recorded points and seed fully determine output. Arc-length spacing carries
 * across pointer samples, so event frequency cannot create extra dark dabs. */
export function* brushDabs(s: Stroke): Generator<Dab> {
  const d = s.dynamics ?? DAB_DEFAULTS;
  validateDynamics(d);
  let seed = s.seed ?? 1,
    index = 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const dab = (a: BrushPoint, b: BrushPoint, t: number): Dab => {
    if (++index > 200_000) throw Error("Stroke exceeds the safe dab budget. Use a larger spacing.");
    const pressure = (a.pressure ?? 1) + ((b.pressure ?? 1) - (a.pressure ?? 1)) * t,
      distance = Math.hypot(b.x - a.x, b.y - a.y),
      elapsed = (b.time ?? 0) - (a.time ?? 0),
      velocity = elapsed > 0 ? Math.min(1, distance / elapsed / 2) : 0,
      size =
        (s.sizePressure ? pressure : 1) *
        (1 - d.sizeJitter * random()) *
        (1 - d.velocity * velocity * 0.8),
      scatterAngle = random() * Math.PI * 2,
      scatterRadius = (Math.sqrt(random()) * d.scatter * s.size) / 2;
    return {
      x: a.x + (b.x - a.x) * t + Math.cos(scatterAngle) * scatterRadius,
      y: a.y + (b.y - a.y) * t + Math.sin(scatterAngle) * scatterRadius,
      radius: Math.max(0.1, (s.size / 2) * size),
      alpha: s.flow * (d.opacityPressure ? pressure : 1) * (1 - d.opacityJitter * random()),
      angle: (d.angle * Math.PI) / 180 + (d.followDirection ? Math.atan2(b.y - a.y, b.x - a.x) : 0),
      roundness: d.roundness,
    };
  };
  if (!s.points.length) return;
  let previousDab = dab(s.points[0]!, s.points[1] ?? s.points[0]!, 0);
  yield previousDab;
  let remaining = Math.max(0.25, previousDab.radius * 2 * d.spacing);
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]!,
      b = s.points[i]!,
      length = Math.hypot(b.x - a.x, b.y - a.y);
    let traveled = 0;
    while (length - traveled >= remaining) {
      traveled += remaining;
      previousDab = dab(a, b, traveled / length);
      yield previousDab;
      remaining = Math.max(0.25, previousDab.radius * 2 * d.spacing);
    }
    remaining -= length - traveled;
  }
}
