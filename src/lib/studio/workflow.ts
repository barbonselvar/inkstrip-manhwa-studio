import { defaultRecipe, assertSize, type RenderLimits } from "./editor/geometry.ts";
import { validateAdjustments, type Adjustments } from "./editor/adjustments.ts";
export type EditingPreset = { id: string; name: string; adjustments: Adjustments };
export function validatePresets(presets: EditingPreset[]) {
  if (presets.length > 40) throw new Error("Maximum 40 saved presets per project.");
  const ids = new Set<string>();
  for (const p of presets) {
    if (!p.id || ids.has(p.id) || !p.name.trim() || p.name.length > 80)
      throw new Error("Invalid preset name or identifier.");
    ids.add(p.id);
    validateAdjustments(p.adjustments);
  }
}
export function batchRecipe(
  width: number,
  height: number,
  adjustments: Adjustments,
  scale: number,
  limits: RenderLimits,
) {
  validateAdjustments(adjustments);
  if (!Number.isFinite(scale) || scale < 10 || scale > 200)
    throw new Error("Batch scale must be 10–200%.");
  const next = {
    ...defaultRecipe(width, height),
    width: Math.max(1, Math.round((width * scale) / 100)),
    height: Math.max(1, Math.round((height * scale) / 100)),
    adjustments: { ...adjustments },
  };
  assertSize(next.width, next.height, limits);
  return next;
}
