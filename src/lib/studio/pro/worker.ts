/// <reference lib="webworker" />
import { selectColor } from "./selection";
import { composite } from "./render";
import { type ProSession, type ProDocument, validateAssets, sourceReference } from "./model";
let assets: ProSession["assets"] = {},
  cache = new Map<string, ImageBitmap>(),
  cachePixels = 0,
  latest = 0;
function documentSources(doc: ProDocument, maxArea: number) {
  const dimensions = new Map<string, { width: number; height: number }>();
  for (const l of doc.layers) {
    if (l.width * l.height > maxArea)
      throw new Error(
        "A layer exceeds this device’s memory budget. Export a native backup or use a smaller source.",
      );
    if (l.assetId) dimensions.set(l.assetId, { width: l.width, height: l.height });
    for (const stroke of [...l.strokes, ...(l.mask?.strokes ?? [])])
      if (stroke.clone)
        dimensions.set(stroke.clone.assetId, {
          width: stroke.clone.width,
          height: stroke.clone.height,
        });
  }
  const original = sourceReference(doc);
  if (original) {
    if (original.width * original.height > maxArea)
      throw new Error("The retained original exceeds this device’s memory budget.");
    dimensions.set(original.assetId, original);
  }
  if ([...dimensions.values()].reduce((n, s) => n + s.width * s.height, 0) > maxArea * 3)
    throw new Error(
      "Raster sources exceed this device’s combined memory budget. Use fewer or smaller sources.",
    );
  return dimensions;
}
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  latest = id;
  try {
    if (type === "init") {
      validateAssets(data.session);
      documentSources(data.session.document, data.maxArea);
      assets = data.session.assets;
      for (const b of cache.values()) b.close();
      cache = new Map();
      cachePixels = 0;
      self.postMessage({ id, type: "ready" });
      return;
    }
    const doc: ProDocument =
      data.mime === "image/jpeg" && data.document.background === "transparent"
        ? { ...data.document, background: "#ffffff" }
        : data.document;
    if (doc.width * doc.height > data.maxArea)
      throw new Error(
        "This document exceeds the device memory budget. Export the native document or use the existing chapter strip workflow. No resolution was reduced.",
      );
    const dimensions = documentSources(doc, data.maxArea),
      scale = type === "preview" ? Math.min(1, 1400 / Math.max(doc.width, doc.height)) : 1;
    const get = async (assetId: string, s: number) => {
      const size = dimensions.get(assetId);
      if (!size || !assets[assetId]) throw new Error("A raster asset is missing.");
      const key = `${assetId}:${size.width}x${size.height}:${s}`;
      if (!cache.has(key)) {
        const bitmap = await createImageBitmap(assets[assetId]!, {
          resizeWidth: Math.max(1, Math.round(size.width * s)),
          resizeHeight: Math.max(1, Math.round(size.height * s)),
          resizeQuality: "high",
        });
        if (latest !== id) {
          bitmap.close();
          throw new DOMException("Cancelled", "AbortError");
        }
        const area = bitmap.width * bitmap.height;
        while (cache.size && cachePixels + area > data.maxArea * 2) {
          const [oldId, old] = cache.entries().next().value!;
          cachePixels -= old.width * old.height;
          old.close();
          cache.delete(oldId);
        }
        cache.set(key, bitmap);
        cachePixels += area;
      } else {
        const bitmap = cache.get(key)!;
        cache.delete(key);
        cache.set(key, bitmap);
      }
      return cache.get(key)!;
    };
    const output = await composite(
      doc,
      scale,
      get,
      () => latest !== id,
      (done, total) => {
        if (type === "export") self.postMessage({ id, type: "progress", done, total });
      },
    );
    if (latest !== id) {
      output.width = output.height = 1;
      return;
    }
    if (type === "select") {
      try {
        const pixels = output.getContext("2d")!.getImageData(0, 0, doc.width, doc.height);
        const region = selectColor(pixels.data, doc.width, doc.height, data.point, data.options);
        self.postMessage({ id, type: "selection", region });
      } finally {
        output.width = output.height = 1;
      }
      return;
    }
    if (type === "preview") {
      const bitmap = output.transferToImageBitmap();
      self.postMessage({ id, type: "preview", bitmap }, [bitmap]);
    } else {
      const blob = await output.convertToBlob({ type: data.mime, quality: data.quality });
      if (blob.type !== data.mime)
        throw new Error(
          "This browser cannot encode the requested image format. Choose PNG instead.",
        );
      self.postMessage({ id, type: "export", blob, width: output.width, height: output.height });
    }
    output.width = output.height = 1;
  } catch (e) {
    if ((e as Error).name !== "AbortError")
      self.postMessage({ id, type: "error", error: (e as Error).message });
    else self.postMessage({ id, type: "cancelled" });
  }
};
