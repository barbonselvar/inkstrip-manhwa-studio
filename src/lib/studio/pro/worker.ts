/// <reference lib="webworker" />
import { composite } from "./render";
import { type ProSession, validateAssets } from "./model";
let assets: ProSession["assets"] = {},
  dimensions = new Map<string, { width: number; height: number }>(),
  cache = new Map<string, ImageBitmap>(),
  latest = 0;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  latest = id;
  try {
    if (type === "init") {
      validateAssets(data.session);
      for (const l of data.session.document.layers)
        if (l.width * l.height > data.maxArea)
          throw new Error(
            "A layer exceeds this device’s memory budget. Export a native backup or use a smaller source.",
          );
      assets = data.session.assets;
      for (const b of cache.values()) b.close();
      cache = new Map();
      dimensions = new Map();
      for (const l of data.session.document.layers)
        if (l.assetId) dimensions.set(l.assetId, { width: l.width, height: l.height });
      const pixels = [...dimensions.values()].reduce((n, s) => n + s.width * s.height, 0);
      if (pixels > data.maxArea * 3)
        throw new Error(
          "Raster sources exceed this device’s combined memory budget. Use fewer or smaller sources.",
        );
      self.postMessage({ id, type: "ready" });
      return;
    }
    const doc =
      data.mime === "image/jpeg" && data.document.background === "transparent"
        ? { ...data.document, background: "#ffffff" }
        : data.document;
    if (doc.width * doc.height > data.maxArea)
      throw new Error(
        "This document exceeds the device memory budget. Export the native document or use the existing chapter strip workflow. No resolution was reduced.",
      );
    for (const l of doc.layers)
      if (l.width * l.height > data.maxArea)
        throw new Error("A layer exceeds this device’s memory budget.");
    const scale = type === "preview" ? Math.min(1, 1400 / Math.max(doc.width, doc.height)) : 1;
    const get = async (assetId: string, s: number) => {
      const size = dimensions.get(assetId);
      if (!size || !assets[assetId]) throw new Error("A raster asset is missing.");
      const key = `${assetId}:${s}`;
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
      output.width = 1;
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
