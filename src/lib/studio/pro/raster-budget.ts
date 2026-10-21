import { effectPadding } from "./effects.ts";
import { sourceReference, type ProDocument } from "./model.ts";
/** Validate active sources before decoding, including proposed merge documents. */
export function documentSources(doc: ProDocument, maxArea: number) {
  const padding = effectPadding(doc);
  if (padding > 2048 || (doc.width + 2 * padding) * (doc.height + 2 * padding) > maxArea * 3)
    throw new Error(
      "Layer effects exceed this device’s padded rendering budget. Reduce effect radius/distance or export a native backup.",
    );
  const dimensions = new Map<string, { width: number; height: number }>();
  for (const l of doc.layers) {
    if (l.width * l.height > maxArea)
      throw new Error(
        "A layer exceeds this device’s memory budget. Export a native backup or use a smaller source.",
      );
    if (l.assetId) dimensions.set(l.assetId, { width: l.width, height: l.height });
    for (const stroke of [...l.strokes, ...(l.mask?.strokes ?? [])])
      if (stroke.clone)
        dimensions.set(stroke.clone.assetId, {
          width: stroke.clone.width,
          height: stroke.clone.height,
        });
  }
  const original = sourceReference(doc);
  if (original) {
    if (original.width * original.height > maxArea)
      throw new Error("The retained original exceeds this device’s memory budget.");
    dimensions.set(original.assetId, original);
  }
  if ([...dimensions.values()].reduce((n, s) => n + s.width * s.height, 0) > maxArea * 3)
    throw new Error(
      "Raster sources exceed this device’s combined memory budget. Use fewer or smaller sources.",
    );
  return dimensions;
}
