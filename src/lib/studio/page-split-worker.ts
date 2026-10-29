/// <reference lib="webworker" />
import { decode, encode } from "fast-png";
import { checkPngSplittable, rowElements, SplitError, type SplitPart } from "./page-split";

/** Decodes one Chapter image and encodes each band as its own PNG, off the main thread. */
type Request = { id: number; mime: string; bytes: ArrayBuffer; parts: SplitPart[] };

const exact = (png: Uint8Array) =>
  // fast-png may return a view into a larger buffer: send exactly the PNG bytes.
  png.byteOffset === 0 && png.byteLength === png.buffer.byteLength ? png : png.slice();

async function splitPng(bytes: Uint8Array, parts: SplitPart[]) {
  checkPngSplittable(bytes);
  const image = decode(bytes, { checkCrc: true }),
    perRow = rowElements(image.width, image.channels, image.depth);
  return parts.map(({ y, height }) =>
    exact(
      encode({
        width: image.width,
        height,
        data: image.data.subarray(y * perRow, (y + height) * perRow),
        depth: image.depth,
        channels: image.channels,
        ...(image.palette ? { palette: image.palette } : {}),
        ...(image.transparency ? { transparency: image.transparency } : {}),
      }),
    ),
  );
}

/** JPEG and WebP: browser-decoded pixels without colour conversion, opaque only. */
async function splitBrowserImage(blob: Blob, parts: SplitPart[]) {
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, 1),
      ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    return parts.map(({ y, height }) => {
      canvas.height = height;
      ctx.clearRect(0, 0, bitmap.width, height);
      ctx.drawImage(bitmap, 0, y, bitmap.width, height, 0, 0, bitmap.width, height);
      const data = ctx.getImageData(0, 0, bitmap.width, height).data;
      for (let i = 3; i < data.length; i += 4)
        if (data[i] !== 255)
          throw new SplitError(
            "This image has transparency, which a browser decode cannot split exactly. Convert it to PNG first; the original is unchanged.",
          );
      return exact(encode({ width: bitmap.width, height, data, depth: 8, channels: 4 }));
    });
  } finally {
    bitmap.close();
  }
}

/** JPEG APP2 ICC_PROFILE or WebP ICCP: browser decoding without conversion would drop it. */
function hasEmbeddedProfile(mime: string, bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)));
  return mime === "image/jpeg" ? text.includes("ICC_PROFILE\0") : text.includes("ICCP");
}

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    const bytes = new Uint8Array(data.bytes);
    let pngs: Uint8Array[];
    if (data.mime === "image/png") pngs = await splitPng(bytes, data.parts);
    else if (data.mime === "image/jpeg" || data.mime === "image/webp") {
      if (hasEmbeddedProfile(data.mime, bytes))
        throw new SplitError(
          "This image has an embedded colour profile that split pages would not keep. Export it as an sRGB PNG to split it; the original is unchanged.",
        );
      pngs = await splitBrowserImage(new Blob([bytes], { type: data.mime }), data.parts);
    } else
      throw new SplitError(
        "Splitting supports PNG, JPEG and WebP chapter images. The original is unchanged.",
      );
    self.postMessage(
      { id: data.id, pngs: pngs.map((p) => p.buffer) },
      pngs.map((p) => p.buffer as ArrayBuffer),
    );
  } catch (error) {
    self.postMessage({
      id: data.id,
      error:
        error instanceof SplitError
          ? error.message
          : `This image could not be split: ${(error as Error)?.message || String(error)}`,
    });
  }
};
