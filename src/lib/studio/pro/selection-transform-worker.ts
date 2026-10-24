import type { ProDocument } from "./model";
import { composite, selectionCanvas } from "./render";
import {
  selectionTransformTarget,
  splitSelectedPixels,
  stageSelectionDocument,
} from "./selection-transform";

export async function renderSelectionTransform(
  doc: ProDocument,
  layerId: string,
  maxArea: number,
  get: (id: string, scale: number) => Promise<ImageBitmap>,
  cancelled: () => boolean,
) {
  const target = selectionTransformTarget(doc, layerId, maxArea),
    remainingAsset = crypto.randomUUID(),
    liftedAsset = crypto.randomUUID(),
    ids = {
      group: crypto.randomUUID(),
      remaining: crypto.randomUUID(),
      floating: crypto.randomUUID(),
    },
    isolated = {
      ...doc,
      background: "transparent",
      layers: [{ ...target, parentId: undefined, opacity: 1, blend: "source-over" as const }],
    },
    source = await (async () => {
      // Validate native nesting/layer/source limits before raster allocation.
      stageSelectionDocument(doc, layerId, remainingAsset, liftedAsset, ids, maxArea);
      return composite(isolated, 1, get, cancelled, () => {});
    })(),
    mask = selectionCanvas(doc.selection!, doc.width, doc.height);
  try {
    const rgba = source.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data,
      maskData = mask.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data,
      coverage = new Uint8ClampedArray(doc.width * doc.height);
    for (let i = 0; i < coverage.length; i++) coverage[i] = maskData[i * 4 + 3]!;
    mask.width = mask.height = 1;
    const { remaining, lifted } = splitSelectedPixels(rgba, coverage);
    let left = doc.width,
      top = doc.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < doc.height; y++)
      for (let x = 0; x < doc.width; x++) {
        if (!lifted[(y * doc.width + x) * 4 + 3]) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    const frame = { x: left, y: top, width: right - left, height: bottom - top },
      staged = stageSelectionDocument(
        doc,
        layerId,
        remainingAsset,
        liftedAsset,
        ids,
        maxArea,
        frame,
      ),
      ctx = source.getContext("2d")!;
    if (cancelled()) throw new DOMException("Selection staging cancelled", "AbortError");
    ctx.putImageData(new ImageData(remaining, doc.width, doc.height), 0, 0);
    const rest = await source.convertToBlob({ type: "image/png" });
    source.width = frame.width;
    source.height = frame.height;
    source
      .getContext("2d")!
      .putImageData(new ImageData(lifted, doc.width, doc.height), -frame.x, -frame.y);
    const cut = await source.convertToBlob({ type: "image/png" });
    if (cancelled()) throw new DOMException("Selection staging cancelled", "AbortError");
    return { ...staged, assets: { [remainingAsset]: rest, [liftedAsset]: cut } };
  } finally {
    source.width = source.height = mask.width = mask.height = 1;
  }
}
