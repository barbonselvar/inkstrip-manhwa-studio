import type { Frame } from "./artboards.ts";
import type { ProDocument } from "./model.ts";

export type PreviewTarget = { document: ProDocument | undefined; view: string };
export type PreviewView = {
  mode: "raster" | "vector";
  before: boolean;
  frame?: Frame;
  maxArea: number;
  assetEpoch: number;
  ready: number;
  quick: boolean;
};
/** Snapshot every render input besides the immutable document identity. Frame data
 * includes origin/background as well as size; equal-sized artboards can differ. */
export function previewTarget(document: ProDocument | undefined, view: PreviewView): PreviewTarget {
  return {
    document,
    view: JSON.stringify([
      view.mode,
      view.before,
      view.mode === "vector" ? (view.frame ?? null) : null,
      view.maxArea,
      view.assetEpoch,
      view.ready,
      view.quick,
    ]),
  };
}
/** A displayed bitmap is ready only for the document AND view it actually rendered. */
export function samePreviewTarget(displayed: PreviewTarget | null, requested: PreviewTarget) {
  return (
    !!displayed &&
    !!requested.document &&
    displayed.document === requested.document &&
    displayed.view === requested.view
  );
}
