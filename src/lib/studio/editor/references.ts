import type { Panel, PanelMedia } from "../types.ts";
export function mediaReference(panel: Panel): PanelMedia {
  return {
    blobId: panel.blobId,
    thumbId: panel.thumbId,
    mime: panel.mime,
    width: panel.width,
    height: panel.height,
  };
}
export function mediaIds(panel: Panel) {
  return [
    ...new Set([
      panel.blobId,
      panel.thumbId,
      ...(panel.original ? [panel.original.blobId, panel.original.thumbId] : []),
      ...(panel.edit ? [panel.edit.source.blobId, panel.edit.source.thumbId] : []),
    ]),
  ];
}
export function obsoleteMedia(previous: Panel, next: Panel) {
  const keep = new Set(mediaIds(next));
  return mediaIds(previous).filter((id) => !keep.has(id));
}
