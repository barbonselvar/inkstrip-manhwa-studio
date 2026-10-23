export type Region = { x: number; y: number; width: number; height: number };
/** F1 preserves source coordinates. No automatic resolution reduction or generative tiling. */
export function planRegion(width: number, height: number, region?: Region, padding = 16) {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 16384) ||
    width * height > 16_777_216 ||
    !Number.isInteger(padding) ||
    padding < 0 ||
    padding > 256
  )
    throw Error("Invalid AI processing dimensions.");
  const r = region ?? { x: 0, y: 0, width, height };
  if (
    ![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width < 1 ||
    r.height < 1 ||
    r.x + r.width > width ||
    r.y + r.height > height
  )
    throw Error("The processing region must be inside the image.");
  const x = Math.max(0, r.x - padding),
    y = Math.max(0, r.y - padding),
    right = Math.min(width, r.x + r.width + padding),
    bottom = Math.min(height, r.y + r.height + padding);
  const context = { x, y, width: right - x, height: bottom - y };
  if (context.width * context.height > 4_000_000 || Math.max(context.width, context.height) > 4096)
    throw Error(
      "This context exceeds the local model limit (4 MP / 4096px side). Select a smaller region; no resolution was reduced.",
    );
  return context;
}
export function assertFresh(
  expected: string,
  actual: string,
  source: string,
  currentSource: string,
) {
  if (expected !== actual || source !== currentSource)
    throw Error(
      "The document or Chapter image changed. Discard this preview and generate again; no artwork was overwritten.",
    );
}
