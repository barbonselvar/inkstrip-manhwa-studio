/** Accumulate a small direction threshold so mobile scroll jitter cannot flicker the header. */
export function readerScroll(previous: number, next: number, direction: number, distance: number) {
  const y = Math.max(0, next);
  const delta = y - Math.max(0, previous);
  const nextDirection = Math.sign(delta);
  const travel = nextDirection === direction ? distance + Math.abs(delta) : Math.abs(delta);
  return {
    y,
    direction: nextDirection || direction,
    distance: travel,
    visible: y < 32 ? true : travel >= 12 ? delta < 0 : undefined,
  };
}
