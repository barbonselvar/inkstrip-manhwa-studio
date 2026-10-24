import type { Layer, ProDocument, ProSession } from "./model.ts";
import { descendants } from "./layers.ts";

/** Shared isolation contract for thumbnail rendering and exact cache keys. */
export function thumbnailDocument(doc: ProDocument, id: string): ProDocument {
  const ids = descendants(doc, [id]);
  return {
    ...doc,
    background: "transparent",
    layers: doc.layers
      .filter((l) => ids.has(l.id))
      .map((l) =>
        l.id === id
          ? {
              ...l,
              parentId: undefined,
              visible: true,
              clipped: false,
              opacity: 1,
              blend: "source-over",
            }
          : l,
      ),
  };
}
export function thumbnailScale(doc: ProDocument) {
  return Math.min(
    1,
    64 / Math.max(doc.width, doc.height, ...doc.layers.flatMap((l) => [l.width, l.height])),
  );
}
export function maskThumbnailScale(layer: Layer) {
  return Math.min(
    1,
    96 / Math.max(layer.width, layer.mask?.width ?? 0),
    72 / Math.max(layer.height, layer.mask?.height ?? 0),
  );
}
/** Blob identity supplements immutable asset IDs, including replaced/recovered pools. */
export function thumbnailKeys(
  doc: ProDocument,
  assets: ProSession["assets"],
  assetToken: (blob: Blob) => number,
) {
  const result = new Map<string, string | undefined>(),
    scale = thumbnailScale(doc);
  for (const l of doc.layers) {
    const isolated = thumbnailDocument(doc, l.id),
      sources = new Set<string>();
    const layers = isolated.layers.map((l) => {
      if (l.assetId) sources.add(l.assetId);
      for (const s of [...l.strokes, ...(l.mask?.strokes ?? [])])
        if (s.clone) sources.add(s.clone.assetId);
      return Object.fromEntries(
        Object.entries(l).filter(([key]) => !["name", "locked", "linkId"].includes(key)),
      );
    });
    const key = JSON.stringify([
      doc.width,
      doc.height,
      scale,
      layers,
      [...sources].sort().map((id) => [id, assets[id] ? assetToken(assets[id]!) : "missing"]),
    ]);
    // Exact comparison, not a collision-prone short hash. Large keys deliberately
    // miss: <=48×32Ki UTF-16 units retained, plus <=48 small encoded thumbnails.
    result.set(l.id, key.length <= 32768 ? key : undefined);
  }
  return result;
}
