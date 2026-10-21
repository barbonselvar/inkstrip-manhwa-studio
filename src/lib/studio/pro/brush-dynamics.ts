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
): BrushPoint {
  const factor = 1 - Math.max(0, Math.min(0.95, smoothing)) * 0.9;
  return {
    x: previous ? previous.x + (point.x - previous.x) * factor : point.x,
    y: previous ? previous.y + (point.y - previous.y) * factor : point.y,
    ...(enabled && pointerType === "pen"
      ? { pressure: Math.max(0.05, Math.min(1, Number.isFinite(pressure) ? pressure : 1)) }
      : {}),
  };
}
