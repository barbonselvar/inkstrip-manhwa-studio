import { sourceReference, validateDocument, type ProDocument, type ProSession } from "./model.ts";

/** One traversal for portable export and lifecycle reachability analysis. Hidden
 * layers, retained originals, Clone Stamp and mask strokes are all roots. */
export function documentAssetIds(document: ProDocument): Set<string> {
  validateDocument(document);
  const ids = new Set<string>();
  const original = sourceReference(document);
  if (original) ids.add(original.assetId);
  for (const layer of document.layers) {
    if (layer.assetId) ids.add(layer.assetId);
    for (const stroke of [...layer.strokes, ...(layer.mask?.strokes ?? [])])
      if (stroke.clone) ids.add(stroke.clone.assetId);
  }
  return ids;
}

/** Analysis only. Callers provide history, staged transactions and rendering
 * roots; UI-only clone sources and in-flight workers are not yet lease-tracked.
 * Therefore no deletion is exposed. Checkpoints own independent native Blobs. */
export function analyzeAssetReachability(
  session: ProSession,
  roots: {
    undo?: ProDocument[];
    redo?: ProDocument[];
    pending?: ProDocument[];
    rendering?: ProDocument[];
    checkpoints?: ProDocument[];
  } = {},
) {
  const ids = documentAssetIds(session.document);
  for (const documents of Object.values(roots))
    for (const document of documents ?? [])
      for (const id of documentAssetIds(document)) ids.add(id);
  const present = Object.keys(session.assets);
  return {
    referenced: [...ids].sort(),
    missing: [...ids].filter((id) => !Object.hasOwn(session.assets, id)).sort(),
    candidates: present.filter((id) => !ids.has(id)).sort(),
    candidateBytes: present.reduce((n, id) => n + (ids.has(id) ? 0 : session.assets[id]!.size), 0),
    deletionSafe: false as const,
    reason:
      "Immutable assets are retained until UI clone sources and every active worker/transaction have explicit lifetime leases.",
  };
}
