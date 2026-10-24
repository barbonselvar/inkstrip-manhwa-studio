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
    staged = stageSelectionDocument(
      doc,
      layerId,
      remainingAsset,
      liftedAsset,
      { group: crypto.randomUUID(), remaining: crypto.randomUUID(), floating: crypto.randomUUID() },
      maxArea,
    ),
    isolated = {
      ...doc,
      background: "transparent",
      layers: [{ ...target, parentId: undefined, opacity: 1, blend: "source-over" as const }],
    },
    source = await composite(isolated, 1, get, cancelled, () => {}),
    mask = selectionCanvas(doc.selection!, doc.width, doc.height);
  try {
    const rgba = source.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data,
      maskData = mask.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data,
      coverage = new Uint8ClampedArray(doc.width * doc.height);
    for (let i = 0; i < coverage.length; i++) coverage[i] = maskData[i * 4 + 3]!;
    mask.width = mask.height = 1;
    const { remaining, lifted } = splitSelectedPixels(rgba, coverage),
      ctx = source.getContext("2d")!;
    if (cancelled()) throw new DOMException("Selection staging cancelled", "AbortError");
    ctx.putImageData(new ImageData(remaining, doc.width, doc.height), 0, 0);
    const rest = await source.convertToBlob({ type: "image/png" });
    ctx.putImageData(new ImageData(lifted, doc.width, doc.height), 0, 0);
    const cut = await source.convertToBlob({ type: "image/png" });
    if (cancelled()) throw new DOMException("Selection staging cancelled", "AbortError");
    return { ...staged, assets: { [remainingAsset]: rest, [liftedAsset]: cut } };
  } finally {
    source.width = source.height = mask.width = mask.height = 1;
  }
}
