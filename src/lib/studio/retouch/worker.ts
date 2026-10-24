/// <reference lib="webworker" />
import { safeBitmap } from "../image-decode";
import { imagePolicy } from "../image-policy";
import { paintSelection, selectionBox, type Selection } from "./selection";
import { textureRepair } from "./texture";
const scope = self as unknown as DedicatedWorkerGlobalScope;
let original: ImageBitmap | null = null,
  context: OffscreenCanvas | null = null,
  mask: OffscreenCanvas | null = null;
let region = { x: 0, y: 0, size: 1 };
const ctx = (c: OffscreenCanvas) => {
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) throw new Error("Canvas unavailable.");
  return x;
};
async function compose(generated: Blob) {
  if (!original || !mask) throw new Error("Repair session expired.");
  const result = await safeBitmap(generated, { policy: imagePolicy(true) });
  try {
    const full = new OffscreenCanvas(original.width, original.height),
      fc = ctx(full);
    fc.drawImage(original, 0, 0);
    const x = Math.max(0, region.x),
      y = Math.max(0, region.y),
      w = Math.min(original.width - x, region.size),
      h = Math.min(original.height - y, region.size);
    const patch = new OffscreenCanvas(w, h),
      pc = ctx(patch),
      alpha = new OffscreenCanvas(w, h),
      ac = ctx(alpha);
    pc.drawImage(
      result,
      0,
      0,
      result.width,
      result.height,
      region.x - x,
      region.y - y,
      region.size,
      region.size,
    );
    ac.drawImage(
      mask,
      0,
      0,
      mask.width,
      mask.height,
      region.x - x,
      region.y - y,
      region.size,
      region.size,
    );
    const changed = pc.getImageData(0, 0, w, h),
      weights = ac.getImageData(0, 0, w, h),
      base = fc.getImageData(x, y, w, h);
    for (let p = 0; p < w * h; p++) {
      const a = weights.data[p * 4 + 3]! / 255;
      if (a)
        for (let c = 0; c < 3; c++)
          base.data[p * 4 + c] = base.data[p * 4 + c]! * (1 - a) + changed.data[p * 4 + c]! * a;
    }
    fc.putImageData(base, x, y);
    const blob = await full.convertToBlob({ type: "image/png" });
    full.width = full.height = 1;
    return blob;
  } finally {
    result.close();
  }
}
scope.onmessage = async ({
  data,
}: {
  data: { type: string; blob?: Blob; strokes?: Selection[]; generated?: Blob };
}) => {
  try {
    if (data.type === "compose") {
      scope.postMessage({ type: "result", blob: await compose(data.generated!) });
      return;
    }
    original?.close();
    original = await safeBitmap(data.blob!, { policy: { ...imagePolicy(true), maxSide: 16384 } });
    if (
      original.width * original.height > 16_000_000 ||
      Math.max(original.width, original.height) > 16384
    )
      throw new Error(
        "Retouch supports up to 16 megapixels and 16384px per side. Split a larger image first.",
      );
    const box = selectionBox(data.strokes!);
    const width = original.width,
      height = original.height;
    const pad = Math.max(
      32,
      Math.max((box.right - box.left) * width, (box.bottom - box.top) * height) * 0.25,
    );
    region = {
      x: Math.floor(box.left * width - pad),
      y: Math.floor(box.top * height - pad),
      size: Math.ceil(
        Math.max((box.right - box.left) * width, (box.bottom - box.top) * height) + pad * 2,
      ),
    };
    if (region.size > 4096)
      throw new Error("Select a smaller area (under 4096px) to keep mobile memory bounded.");
    const side = data.type === "local" ? 256 : 1024;
    context = new OffscreenCanvas(side, side);
    const c = ctx(context);
    c.fillStyle = "#f3efe6";
    c.fillRect(0, 0, side, side);
    c.drawImage(
      original,
      (-region.x * side) / region.size,
      (-region.y * side) / region.size,
      (width * side) / region.size,
      (height * side) / region.size,
    );
    // Paint using the full-image coordinate transform, without a full-size mask allocation.
    mask = new OffscreenCanvas(side, side);
    const m = ctx(mask);
    m.setTransform(
      side / region.size,
      0,
      0,
      side / region.size,
      (-region.x * side) / region.size,
      (-region.y * side) / region.size,
    );
    paintSelection(m, data.strokes!, width, height);
    m.resetTransform();
    const pixels = m.getImageData(0, 0, side, side);
    if (!pixels.data.some((v, i) => i % 4 === 3 && v > 8))
      throw new Error("The selection is empty.");
    if (data.type === "prepare") {
      // OpenAI mask: transparent means edit, opaque means preserve.
      const inverted = new OffscreenCanvas(side, side),
        ic = ctx(inverted);
      const mp = new ImageData(side, side);
      for (let i = 0; i < side * side; i++) mp.data[i * 4 + 3] = 255 - pixels.data[i * 4 + 3]!;
      ic.putImageData(mp, 0, 0);
      scope.postMessage({
        type: "prepared",
        image: await context.convertToBlob({ type: "image/png" }),
        mask: await inverted.convertToBlob({ type: "image/png" }),
      });
    } else {
      const input = c.getImageData(0, 0, side, side);
      input.data.set(
        textureRepair(input.data, pixels.data, side, side, (n) =>
          scope.postMessage({ type: "progress", value: n }),
        ),
      );
      c.putImageData(input, 0, 0);
      scope.postMessage({
        type: "result",
        blob: await compose(await context.convertToBlob({ type: "image/png" })),
      });
    }
  } catch (error) {
    scope.postMessage({ type: "error", message: (error as Error).message });
  }
};
