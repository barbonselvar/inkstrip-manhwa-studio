import {
  browserImagePolicy,
  preflightImage,
  type ImageInfo,
  type ImagePolicy,
} from "./image-policy.ts";

type Options = { signal?: AbortSignal; policy?: ImagePolicy };
let nativeBitmapBusy = false;
/** Native image decoders cannot be forcibly stopped. A late bitmap is closed,
 * never published, after cancellation/timeout. Header budgets apply first. */
export function boundedBitmap(
  blob: Blob,
  info: ImageInfo,
  signal?: AbortSignal,
  decode: typeof createImageBitmap = createImageBitmap,
  timeoutMs = 30_000,
): Promise<ImageBitmap> {
  signal?.throwIfAborted();
  if (nativeBitmapBusy) {
    const error = Error(
      "The native image decoder is still busy. Wait for it to finish before retrying.",
    );
    error.name = "DecodeBusyError";
    return Promise.reject(error);
  }
  nativeBitmapBusy = true;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const stop = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () =>
      stop(signal?.reason ?? new DOMException("Image loading cancelled", "AbortError"));
    const timer = setTimeout(
      () =>
        stop(new DOMException("Image decoding timed out. Try a PNG/JPEG copy.", "TimeoutError")),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal?.throwIfAborted();
        return decode(blob.type === info.mime ? blob : blob.slice(0, blob.size, info.mime), {
          imageOrientation: "from-image",
        });
      })
      .then(
        (bitmap) => {
          nativeBitmapBusy = false;
          if (settled) {
            bitmap.close();
            return;
          }
          if (!matchingDimensions(bitmap.width, bitmap.height, info)) {
            bitmap.close();
            stop(Error("Decoded image dimensions disagree with the validated header."));
            return;
          }
          settled = true;
          cleanup();
          resolve(bitmap);
        },
        (error) => {
          nativeBitmapBusy = false;
          stop(error);
        },
      );
  });
}
export function matchingDimensions(width: number, height: number, info: ImageInfo) {
  // EXIF/HEIF orientation can transpose axes without increasing decoded area.
  return (
    (width === info.width && height === info.height) ||
    (width === info.height && height === info.width)
  );
}
export async function safeBitmap(blob: Blob, options: Options = {}) {
  const info = await preflightImage(blob, options.policy ?? browserImagePolicy(), options.signal);
  return boundedBitmap(blob, info, options.signal);
}

let tail: Promise<void> = Promise.resolve();
/** Hold a main-window decode lease until its temporary pixels are released. */
export async function imageLease(signal?: AbortSignal) {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
      signal?.throwIfAborted();
      signal?.addEventListener("abort", abort, { once: true });
      previous.then(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      });
    });
    signal?.throwIfAborted();
    return release;
  } catch (error) {
    void previous.then(release);
    throw error;
  }
}
