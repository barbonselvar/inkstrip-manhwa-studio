import { imagePolicy, constrainedDevice } from "./image-policy.ts";
import { dialogueBudget } from "./dialogue/budget.ts";
import { enhancementSize, ENHANCE_MAX_AREA, ENHANCE_MAX_SIDE } from "./enhance/types.ts";
import { SMART_MAX_AREA, SMART_MAX_TAPS } from "./pro/smart-filters.ts";
import { RASTER_MAX_SIDE } from "./raster-limits.ts";
export function capabilityBudgets(memory: number | undefined, coarse: boolean) {
  return {
    import: imagePolicy(constrainedDevice(memory, coarse)),
    raster: dialogueBudget(memory ?? 8, coarse).maxArea,
    rasterSide: RASTER_MAX_SIDE,
    smart: SMART_MAX_AREA,
    smartTaps: SMART_MAX_TAPS,
    enhance: ENHANCE_MAX_AREA,
    enhanceSide: ENHANCE_MAX_SIDE,
  };
}
export function browserCapabilityBudgets() {
  return capabilityBudgets(
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches,
  );
}
/** Pixel capability only. Encoded-byte, layer, mask, aggregate kernel and asset
 * checks still apply to the actual operation; no allocation or resizing here. */
export function imageCapabilities(
  width: number,
  height: number,
  budgets: ReturnType<typeof capabilityBudgets>,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height * 4)
  )
    throw Error("Invalid image capability dimensions.");
  const area = width * height,
    within = (pixels: number, side: number) => area <= pixels && Math.max(width, height) <= side;
  let enhancement = true;
  try {
    enhancementSize(width, height, 2);
  } catch {
    enhancement = false;
  }
  return {
    width,
    height,
    pixels: area,
    baseRgbaBytes: area * 4,
    chapterImport: within(budgets.import.maxPixels, budgets.import.maxSide),
    rasterEdit: within(budgets.raster, budgets.rasterSide),
    imageExport: within(budgets.raster, budgets.rasterSide),
    smartFilters: within(Math.min(budgets.smart, budgets.raster), budgets.rasterSide),
    enhancement,
  };
}
