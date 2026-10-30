/**
 * Picker previews. Thumbnails are produced with `createImageBitmap`'s resize
 * options, which lets browsers decode at (or near) the target size instead of
 * holding the full-resolution pixels, then re-encoded into a small blob URL.
 * The source file is never modified. All URLs are owned by a `UrlCache` and
 * revoked when an item is removed or the picker closes.
 */

type UrlApi = { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };

export class UrlCache {
  private urls = new Map<string, string>();
  private api: UrlApi;
  constructor(api: UrlApi = URL) {
    this.api = api;
  }
  get(key: string) {
    return this.urls.get(key);
  }
  has(key: string) {
    return this.urls.has(key);
  }
  /** Stores `blob` under `key`, revoking any URL it replaces. */
  set(key: string, blob: Blob) {
    this.revoke(key);
    const url = this.api.createObjectURL(blob);
    this.urls.set(key, url);
    return url;
  }
  revoke(key: string) {
    const url = this.urls.get(key);
    if (url === undefined) return;
    this.api.revokeObjectURL(url);
    this.urls.delete(key);
  }
  /** Revokes every URL whose key is not in `keep`. */
  retain(keep: Iterable<string>) {
    const live = new Set(keep);
    for (const key of [...this.urls.keys()]) if (!live.has(key)) this.revoke(key);
  }
  clear() {
    for (const key of [...this.urls.keys()]) this.revoke(key);
  }
  get size() {
    return this.urls.size;
  }
}

/** Target size preserving aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, max: number) {
  if (!(width > 0 && height > 0)) return { width: max, height: max };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Very tall webtoon pages render as a top crop in square tiles; keep them legible. */
export function thumbTarget(width: number, height: number, max: number) {
  const short = Math.min(width, height);
  if (!(short > 0)) return fitWithin(width, height, max);
  // Scale so the short edge fills the tile, capped so the long edge stays bounded.
  const scale = Math.min(1, max / short, (max * 4) / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

let active = 0;
const waiting: (() => void)[] = [];
const LIMIT = 2;
async function slot<T>(work: () => Promise<T>, signal?: AbortSignal) {
  if (active >= LIMIT)
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener("abort", stop);
        resolve();
      };
      const stop = () => {
        const at = waiting.indexOf(go);
        if (at >= 0) waiting.splice(at, 1);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      waiting.push(go);
      signal?.addEventListener("abort", stop, { once: true });
    });
  active++;
  try {
    signal?.throwIfAborted();
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Small preview of `file`. `width`/`height` come from header validation, so no
 * full decode is needed to learn the size. Returns null when the browser cannot
 * decode the format natively (HEIC/TIFF/JPEG XL are converted only on import).
 */
export function renderThumbnail(
  file: Blob,
  size: { width: number; height: number },
  max: number,
  signal?: AbortSignal,
): Promise<Blob | null> {
  return slot(async () => {
    if (typeof createImageBitmap !== "function") return null;
    const target =
      max > 512
        ? fitWithin(size.width, size.height, max)
        : thumbTarget(size.width, size.height, max);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: "medium",
        imageOrientation: "from-image",
      });
    } catch {
      return null;
    }
    try {
      signal?.throwIfAborted();
      const w = bitmap.width,
        h = bitmap.height;
      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(w, h);
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        return await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.82),
      );
      canvas.width = canvas.height = 0;
      return blob;
    } finally {
      bitmap.close();
    }
  }, signal);
}
