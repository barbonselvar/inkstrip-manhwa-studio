import {
  processSmart,
  validateSmartWork,
  smartFilterWork,
  SMART_MAX_TAPS,
  type SmartOperation,
  type SmartFilter,
} from "./smart-filters.ts";
/** Local integer kernels only. Radial, seeded noise and fractional sampling retain
 * their original whole-plane algorithms to preserve exact R8 output. */
export function smartHalo(operation: SmartOperation): number | undefined {
  switch (operation.kind) {
    case "gaussian":
    case "unsharp":
    case "highPass":
      return Math.ceil(3 * operation.radius);
    case "median":
    case "surface":
      return operation.radius;
    case "edgeDetect":
      return 1;
    default:
      return undefined;
  }
}
export type SmartTile = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export function smartTilePlan(
  width: number,
  height: number,
  operation: SmartOperation,
  tileSize = 256,
) {
  validateSmartWork(width, height, [{ id: "tile", enabled: true, operation }]);
  if (!Number.isInteger(tileSize) || tileSize < 16 || tileSize > 512)
    throw Error("Filter tile size must be16–512 pixels.");
  const halo = smartHalo(operation),
    tiles: SmartTile[] = [];
  if (halo === undefined || (width <= tileSize && height <= tileSize))
    return {
      tiles,
      halo,
      work: smartFilterWork(width, height, [{ id: "tile", enabled: true, operation }]),
    };
  let area = 0;
  for (let y = 0; y < height; y += tileSize)
    for (let x = 0; x < width; x += tileSize) {
      const w = Math.min(tileSize, width - x),
        h = Math.min(tileSize, height - y),
        left = Math.max(0, x - halo),
        top = Math.max(0, y - halo),
        right = Math.min(width, x + w + halo),
        bottom = Math.min(height, y + h + halo);
      area += (right - left) * (bottom - top);
      tiles.push({ x, y, width: w, height: h, left, top, right, bottom });
    }
  const work = smartFilterWork(area, 1, [{ id: "tile", enabled: true, operation }]);
  // Halo overhead is charged to the same kernel-work budget. Fall back rather
  // than refusing an operation which the established whole-image policy allows.
  return work > SMART_MAX_TAPS
    ? {
        tiles: [],
        halo,
        work: smartFilterWork(width, height, [{ id: "tile", enabled: true, operation }]),
      }
    : { tiles, halo, work };
}
export function tiledStackWithinBudget(
  width: number,
  height: number,
  stack: SmartFilter[],
  tileSize = 256,
) {
  validateSmartWork(width, height, stack);
  return (
    stack.reduce(
      (sum, f) => sum + (f.enabled ? smartTilePlan(width, height, f.operation, tileSize).work : 0),
      0,
    ) <= SMART_MAX_TAPS
  );
}
export async function processSmartTiled(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  operation: SmartOperation,
  options: {
    tileSize?: number;
    signal?: AbortSignal;
    checkpoint?: () => Promise<void>;
    progress?: (done: number, total: number) => void;
    wholePlane?: boolean;
  } = {},
) {
  const plan = smartTilePlan(width, height, operation, options.tileSize);
  if (input.length !== width * height * 4) throw Error("Invalid tiled Smart Filter pixel buffer.");
  const checkpoint = async () => {
    options.signal?.throwIfAborted();
    await (options.checkpoint?.() ?? new Promise<void>((resolve) => setTimeout(resolve, 0)));
    options.signal?.throwIfAborted();
  };
  await checkpoint();
  if (options.wholePlane || !plan.tiles.length) {
    const out = processSmart(input, width, height, operation);
    await checkpoint();
    options.progress?.(1, 1);
    return out;
  }
  const out = new Uint8ClampedArray(input.length);
  let done = 0;
  for (const t of plan.tiles) {
    await checkpoint();
    const tw = t.right - t.left,
      th = t.bottom - t.top,
      tile = new Uint8ClampedArray(tw * th * 4);
    for (let y = t.top; y < t.bottom; y++)
      tile.set(
        input.subarray((y * width + t.left) * 4, (y * width + t.right) * 4),
        (y - t.top) * tw * 4,
      );
    const processed = processSmart(tile, tw, th, operation);
    for (let y = 0; y < t.height; y++) {
      const start = ((t.y - t.top + y) * tw + t.x - t.left) * 4;
      out.set(processed.subarray(start, start + t.width * 4), ((t.y + y) * width + t.x) * 4);
    }
    options.progress?.(++done, plan.tiles.length);
  }
  await checkpoint();
  return out;
}
