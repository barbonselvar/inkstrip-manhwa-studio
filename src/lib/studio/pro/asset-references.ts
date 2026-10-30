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
    for (const e of layer.effects ?? [])
      if (e.pattern?.kind === "bitmap") ids.add(e.pattern.assetId!);
    for (const stroke of [...layer.strokes, ...(layer.mask?.strokes ?? [])])
      if (stroke.clone) ids.add(stroke.clone.assetId);
  }
  return ids;
}

/** Opening-time compaction, the one point where the stored document is the only
 * live root: Undo/Redo is not persisted, and no transaction, worker job or clone
 * source exists yet for the session. Checkpoints own independent native copies.
 * The retained set is exactly the one a native export carries, so the document
 * renders identically. Unreferenced Blobs are dropped from this in-memory copy
 * only; the stored record changes through the next ordinary optimistic save. */
export function compactOpenedSession(session: ProSession) {
  const keep = documentAssetIds(session.document),
    removed = Object.keys(session.assets)
      .filter((id) => !keep.has(id))
      .sort();
  if (!removed.length) return { session, removed, bytes: 0 };
  return {
    session: {
      ...session,
      assets: Object.fromEntries(Object.entries(session.assets).filter(([id]) => keep.has(id))),
    },
    removed,
    bytes: removed.reduce((n, id) => n + session.assets[id]!.size, 0),
  };
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
