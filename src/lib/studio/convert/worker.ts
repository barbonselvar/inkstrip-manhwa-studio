/// <reference lib="webworker" />
import { decodeRaster, encodePng, type ConvertibleType, type HeifFactory } from "./core";
// libheif-js (LGPL-3.0) is emitted as its own unmodified file and loaded at runtime, never
// merged into this bundle, so users can substitute a modified build. See /licenses/.
import heifUrl from "../../../../node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs?url";

const loadHeif = async () =>
  (
    (await import(/* @vite-ignore */ new URL(heifUrl, self.location.origin).href)) as {
      default: HeifFactory;
    }
  ).default;

self.onmessage = async ({
  data,
}: MessageEvent<{ id: number; type: ConvertibleType; bytes: ArrayBuffer }>) => {
  try {
    const raster = await decodeRaster(data.type, new Uint8Array(data.bytes), { heif: loadHeif });
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
