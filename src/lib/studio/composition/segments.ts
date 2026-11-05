export function segmentRows(totalHeight: number, segmentHeight: number) {
  if (
    !Number.isSafeInteger(totalHeight) ||
    totalHeight < 1 ||
    !Number.isSafeInteger(segmentHeight) ||
    segmentHeight < 1
  )
    throw Error("Invalid export dimensions");
  if (Math.ceil(totalHeight / segmentHeight) > 1000)
    throw Error("This export exceeds 1000 segments. Choose a smaller panel range.");
  return Array.from({ length: Math.ceil(totalHeight / segmentHeight) }, (_, i) => ({
    start: i * segmentHeight,
    end: Math.min(totalHeight, (i + 1) * segmentHeight),
  }));
}
