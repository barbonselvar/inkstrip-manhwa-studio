import type { Point, ProDocument, Transform } from "./model.ts";
import { transformMask } from "./geometry-operations.ts";
import { transformDocument, transformForest } from "./transform-transaction.ts";
import type { TransformMode } from "./transform.ts";

export type TransformDraft = {
  origin: ProDocument;
  target?: "mask" | "pixels";
  layerId: string;
  ids?: string[];
  frame?: { width: number; height: number };
  value: Transform;
  base: Transform;
  mode: TransformMode;
  lock: boolean;
  translation: Point;
};
/** Clone gesture-owned values while keeping the immutable history identity. */
export function cloneTransformDraft(draft: TransformDraft): TransformDraft {
  return { ...structuredClone({ ...draft, origin: undefined }), origin: draft.origin };
}
export function previewTransform(
  current: ProDocument,
  draft: TransformDraft,
  staged?: ProDocument,
) {
  if (draft.origin !== current)
    throw Error("The document changed. Cancel and restart the transform.");
  const source = draft.target === "pixels" ? staged : current;
  if (!source) throw Error("The selected-pixel preview is no longer available.");
  return draft.target === "mask"
    ? transformMask(source, draft.layerId, draft.value)
    : draft.ids
      ? transformForest(source, draft.ids, draft.base, draft.value)
      : transformDocument(source, draft.layerId, draft.value, draft.translation);
}
