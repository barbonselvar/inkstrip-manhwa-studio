import type { ImageInfo } from "../image-policy";
import { CONVERTIBLE, type ConvertibleType } from "./core";

export type Converted = { blob: Blob; width: number; height: number; notes: string[] };

/** Formats stored as a lossless PNG because browsers cannot be relied on to decode them. */
export const needsConversion = (info: Pick<ImageInfo, "type">) => CONVERTIBLE.has(info.type);

const LABEL: Record<ConvertibleType, string> = {
  tiff: "TIFF",
  heic: "HEIC",
  heif: "HEIF",
  jxl: "JPEG XL",
};
export const formatLabel = (type: string) => LABEL[type as ConvertibleType] ?? type.toUpperCase();

let next = 0;
/** Decode in a dedicated worker (killed on cancel/timeout) and return a lossless PNG. */
export async function convertImage(
  blob: Blob,
  info: Pick<ImageInfo, "type" | "width" | "height">,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<Converted> {
  signal?.throwIfAborted();
  if (!needsConversion(info)) throw Error(`${formatLabel(info.type)} does not need conversion.`);
  const bytes = await blob.arrayBuffer();
  signal?.throwIfAborted();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    id = ++next;
  try {
    const result = await new Promise<{
      png: ArrayBuffer;
      width: number;
      height: number;
      notes: string[];
    }>((resolve, reject) => {
      const abort = () =>
        reject(signal?.reason ?? new DOMException("Import cancelled", "AbortError"));
      const timer = setTimeout(
        () =>
          reject(
            Error(
              `Converting this ${formatLabel(info.type)} image took too long on this device. Try a smaller image or export a PNG/JPEG copy.`,
            ),
          ),
        timeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = (event) => {
        event.preventDefault();
        reject(Error(`The ${formatLabel(info.type)} decoder could not start on this browser.`));
      };
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (data.error) reject(Error(`${formatLabel(info.type)} conversion failed: ${data.error}`));
        else resolve(data);
      };
      worker.postMessage({ id, type: info.type, bytes }, [bytes]);
    });
    const transposed = result.width === info.height && result.height === info.width;
    if (!((result.width === info.width && result.height === info.height) || transposed))
      throw Error(
        `The decoded ${formatLabel(info.type)} image size does not match its header. It was not imported.`,
      );
    return {
      blob: new Blob([result.png], { type: "image/png" }),
      width: result.width,
      height: result.height,
      notes: result.notes,
    };
  } finally {
    worker.terminate();
  }
}
