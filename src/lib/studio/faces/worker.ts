/// <reference lib="webworker" />
import { safeBitmap } from "../image-decode";
import { imagePolicy } from "../image-policy";
import model from "./anime-cascade.json";
import { scanCascade, groupFaces, type FaceBox } from "./detect";
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: { data: { blob: Blob } }) => {
  let image: ImageBitmap | null = null;
  try {
    image = await safeBitmap(data.blob, { policy: imagePolicy(true) });
    if (image.width * image.height > 16_000_000)
      throw new Error("Detect on images under 16 megapixels or select a face manually.");
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height)),
      w = Math.round(image.width * scale),
      h = Math.round(image.height * scale);
    const hits: FaceBox[] = [];
    for (let factor = 1; Math.min(w, h) / factor >= 24; factor *= 1.15) {
      const width = Math.floor(w / factor),
        height = Math.floor(h / factor),
        canvas = new OffscreenCanvas(width, height),
        c = canvas.getContext("2d")!;
      c.drawImage(image, 0, 0, width, height);
      const pixels = c.getImageData(0, 0, width, height),
        gray = new Uint8Array(width * height);
      for (let p = 0; p < gray.length; p++)
        gray[p] =
          (pixels.data[p * 4]! * 77 +
            pixels.data[p * 4 + 1]! * 150 +
            pixels.data[p * 4 + 2]! * 29) >>
          8;
      const sx = image.width / width,
        sy = image.height / height;
      hits.push(
        ...scanCascade(gray, width, height, model).map((b) => ({
          ...b,
          x: b.x * sx,
          y: b.y * sy,
          width: b.width * sx,
          height: b.height * sy,
        })),
      );
      scope.postMessage({ type: "progress", label: `Scanning faces · ${width} × ${height}` });
      canvas.width = canvas.height = 1;
    }
    scope.postMessage({
      type: "faces",
      boxes: groupFaces(hits).map((b) => ({
        ...b,
        x: b.x / image!.width,
        y: b.y / image!.height,
        width: b.width / image!.width,
        height: b.height / image!.height,
      })),
    });
  } catch (error) {
    scope.postMessage({ type: "error", message: (error as Error).message });
  } finally {
    image?.close();
  }
};
