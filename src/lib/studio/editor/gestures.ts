export const LONG_PRESS_MS = 550;
export const LONG_PRESS_DISTANCE = 10;
export function withinPress(start: { x: number; y: number }, next: { x: number; y: number }) {
  return Math.hypot(next.x - start.x, next.y - start.y) <= LONG_PRESS_DISTANCE;
}
export function qualifiesLongPress(
  start: { x: number; y: number; time: number },
  next: { x: number; y: number; time: number },
) {
  return next.time - start.time >= LONG_PRESS_MS && withinPress(start, next);
}
