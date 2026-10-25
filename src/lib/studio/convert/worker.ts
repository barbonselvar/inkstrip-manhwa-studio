/// <reference lib="webworker" />
import { decodeRaster, encodePng, type ConvertibleType } from "./core";

self.onmessage = async ({
  data,
}: MessageEvent<{ id: number; type: ConvertibleType; bytes: ArrayBuffer }>) => {
  try {
    const raster = await decodeRaster(data.type, new Uint8Array(data.bytes));
    const encoded = encodePng(raster),
      // fast-png returns a view into a larger buffer: send exactly the PNG bytes.
      png =
        encoded.byteOffset === 0 && encoded.byteLength === encoded.buffer.byteLength
          ? encoded
          : encoded.slice();
    self.postMessage(
      {
        id: data.id,
        png: png.buffer,
        width: raster.width,
        height: raster.height,
        notes: raster.notes,
      },
      [png.buffer],
    );
  } catch (error) {
    self.postMessage({ id: data.id, error: (error as Error)?.message || String(error) });
  }
};
