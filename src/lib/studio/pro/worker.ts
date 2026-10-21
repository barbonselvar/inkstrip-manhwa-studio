/// <reference lib="webworker" />
import { renderOutput } from "./output";
import { renderRepair } from "./repair-worker";
import { selectColor } from "./selection";
import { composite } from "./render";
import { planMerge, finishMerge, descendants } from "./layers";
import { documentSources } from "./raster-budget";
import { type ProSession, type ProDocument, validateAssets } from "./model";
let assets: ProSession["assets"] = {},
  cache = new Map<string, ImageBitmap>(),
  cachePixels = 0,
  latest = 0;
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
      scale =
        type === "preview" || type === "thumbnails"
          ? Math.min(1, 1400 / Math.max(doc.width, doc.height))
          : 1;
    if (type === "repair" && data.request.stroke.clone) {
      const source = data.request.stroke.clone;
      dimensions.set(source.assetId, { width: source.width, height: source.height });
    }
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
    if (type === "thumbnails") {
      const thumbnails: { id: string; blob: Blob }[] = [],
        thumbScale = Math.min(
          1,
          64 / Math.max(doc.width, doc.height, ...doc.layers.flatMap((l) => [l.width, l.height])),
        );
      for (const l of doc.layers) {
        if (latest !== id) throw new DOMException("Cancelled", "AbortError");
        const ids = descendants(doc, [l.id]),
          isolated = {
            ...doc,
            background: "transparent",
            layers: doc.layers
              .filter((c) => ids.has(c.id))
              .map((c) =>
                c.id === l.id
                  ? {
                      ...c,
                      parentId: undefined,
                      visible: true,
                      clipped: false,
                      opacity: 1,
                      blend: "source-over" as const,
                    }
                  : c,
              ),
          },
          thumb = await composite(
            isolated,
            thumbScale,
            get,
            () => latest !== id,
            () => {},
          );
        try {
          thumbnails.push({ id: l.id, blob: await thumb.convertToBlob({ type: "image/png" }) });
        } finally {
          thumb.width = thumb.height = 1;
        }
      }
      self.postMessage({ id, type: "thumbnails", thumbnails });
      return;
    }
    if (type === "merge") {
      const assetId = crypto.randomUUID(),
        plan = planMerge(doc, data.mode, data.ids, assetId),
        document = finishMerge(doc, plan);
      documentSources(document, data.maxArea);
      if (Object.keys(assets).length >= 64)
        throw new Error(
          "The immutable asset pool is full. Export a native backup before starting a smaller document.",
        );
      const merged = await composite(
        plan.render,
        1,
        get,
        () => latest !== id,
        (done, total) => self.postMessage({ id, type: "progress", done, total }),
      );
      let bitmap: ImageBitmap | undefined;
      try {
        const blob = await merged.convertToBlob({ type: "image/png" });
        // Validate native-size appearance BEFORE publishing any metadata or asset changes.
        bitmap = await createImageBitmap(blob);
        merged.width = merged.height = 1;
        const before = await composite(
          doc,
          1,
          get,
          () => latest !== id,
          () => {},
        );
        let expected: ImageData;
        try {
          expected = before.getContext("2d")!.getImageData(0, 0, before.width, before.height);
        } finally {
          before.width = before.height = 1;
        }
        const after = await composite(
          document,
          1,
          async (key, s) => (key === assetId ? bitmap! : get(key, s)),
          () => latest !== id,
          () => {},
        );
        try {
          const actual = after.getContext("2d")!.getImageData(0, 0, after.width, after.height).data;
          for (let n = 0; n < actual.length; n++) {
            if (n % 4 !== 3 && !actual[n - (n % 4) + 3] && !expected.data[n - (n % 4) + 3])
              continue;
            // Canvas/PNG unpremultiplication may round a channel once, but no larger change is accepted.
            if (Math.abs(actual[n]! - expected.data[n]!) > 1)
              throw new Error(
                "This merge would change the composited appearance. Include the full backdrop or use Flatten image. Nothing was changed.",
              );
          }
        } finally {
          after.width = after.height = 1;
        }
        if (latest !== id) throw new DOMException("Cancelled", "AbortError");
        self.postMessage({
          id,
          type: "merge",
          blob,
          document,
          assetId,
          layerId: plan.replacement.id,
        });
      } finally {
        bitmap?.close();
        merged.width = merged.height = 1;
      }
      return;
    }
    let output = await composite(
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
    if (type === "repair") {
      try {
        if (Object.keys(assets).length >= 64)
          throw new Error(
            "The repair asset pool is full. Save a native backup and use a smaller document.",
          );
        const result = await renderRepair(doc, data.request, output, get, data.maxArea);
        if (latest !== id) throw new DOMException("Cancelled", "AbortError");
        self.postMessage({ id, type: "repair", ...result });
      } finally {
        output.width = output.height = 1;
      }
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
      if (!data.fullCanvas)
        output = renderOutput(output, doc, data.maxArea, data.mime === "image/jpeg");
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
