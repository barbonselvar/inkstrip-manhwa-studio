import { toLocalSelection, type Selection, type Layer } from "./model.ts";
import type { FilterMask } from "./smart-filters.ts";
/** No active selection means the complete source plane. Only an explicit R7
 * selection should acquire document bounds and a captured layer transform. */
export function captureFilterMask(
  selection: Selection | undefined,
  layer: Layer,
  bounds: { width: number; height: number },
): FilterMask {
  return {
    selection:
      selection && (selection.regions.length || selection.inverted)
        ? toLocalSelection(selection, layer, { width: bounds.width, height: bounds.height })
        : { regions: [], inverted: true, feather: 0 },
    enabled: true,
    inverted: false,
    density: 1,
  };
}
