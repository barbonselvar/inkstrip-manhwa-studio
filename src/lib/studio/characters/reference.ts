import { selectionBox, type Selection } from "../retouch/selection";
import { safeBitmap } from "../image-decode";
import { imagePolicy } from "../image-policy";
/** Store an independent, bounded PNG crop; never retain a panel blob through a dangling ID. */
export async function makeReference(blob: Blob, strokes?: Selection[]) {
  const source = await safeBitmap(blob, { policy: imagePolicy(true) });
  try {
    if (source.width * source.height > 16_000_000)
      throw new Error("Reference input exceeds 16 megapixels.");
    const box = strokes?.length ? selectionBox(strokes) : { left: 0, top: 0, right: 1, bottom: 1 };
    const x = Math.floor(box.left * source.width),
      y = Math.floor(box.top * source.height),
      w = Math.max(1, Math.ceil((box.right - box.left) * source.width)),
      h = Math.max(1, Math.ceil((box.bottom - box.top) * source.height));
    const scale = Math.min(1, 512 / Math.max(w, h)),
      canvas = new OffscreenCanvas(
        Math.max(1, Math.round(w * scale)),
        Math.max(1, Math.round(h * scale)),
      );
    const c = canvas.getContext("2d")!;
    c.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height);
    const result = await canvas.convertToBlob({ type: "image/png" });
    canvas.width = canvas.height = 1;
    if (result.size > 750_000)
      throw new Error("Reference is too complex. Select a tighter face crop.");
    return result;
  } finally {
    source.close();
  }
}
