import { histogramTiles } from "./adjustment-tiles";
import { colorTarget } from "./color-transaction";
import { renderSelectionTransform } from "./selection-transform-worker";
import { NEUTRAL } from "../editor/adjustments";
import { preflightImage, imagePolicy } from "../image-policy";
import { thumbnailDocument, thumbnailScale } from "./thumbnails";
/// <reference lib="webworker" />
import { refineTiled, coverageRegion } from "./refine-selection";
import { artboards } from "./artboards";
import { effectPadding } from "./effects";
import { renderOutput } from "./output";
import { renderRepair } from "./repair-worker";
import { selectColor } from "./selection";
import { alphaRegion, colorRangeRegion, modifySelection } from "./selection-tools";
import { composite, selectionCanvas, surface } from "./render";
import { planMerge, finishMerge, visibleLayerIds } from "./layers";
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
    // Composite on the editable background first. A JPEG matte must not become
    // the backdrop of Screen/Overlay/etc., which can erase or recolor dialogue.
    const doc: ProDocument = data.document;
    if (doc.width * doc.height > data.maxArea)
      throw new Error(
        "This document exceeds the device memory budget. Export the native document or use the existing chapter strip workflow. No resolution was reduced.",
      );
    const board =
      type === "artboard-export" ? artboards(doc).find((b) => b.id === data.board?.id) : undefined;
    if (
      type === "artboard-export" &&
      (!board ||
        JSON.stringify(board) !== JSON.stringify(data.board) ||
        !Number.isFinite(data.exportScale) ||
        data.exportScale < 0.1 ||
        data.exportScale > 8 ||
        Math.ceil(board.width * data.exportScale) * Math.ceil(board.height * data.exportScale) >
          data.maxArea)
    )
      throw Error(
        "Invalid or oversized artboard export. Use 0.1–8× scale within the device budget.",
      );
    const frame =
      (type === "preview" || type === "dialogue-region") && data.frame
        ? data.frame
        : board
          ? { ...board, background: board.background }
          : undefined;
    const dimensions = documentSources(doc, data.maxArea),
      scale =
        type === "preview" || type === "thumbnails"
          ? Math.min(1, 1400 / Math.max(frame?.width ?? doc.width, frame?.height ?? doc.height))
          : board
            ? data.exportScale
            : 1;
    if (
      type === "dialogue-region" &&
      (!frame ||
        ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger) ||
        frame.x < 0 ||
        frame.y < 0 ||
        frame.x + frame.width > doc.width ||
        frame.y + frame.height > doc.height ||
        frame.width * frame.height > 4_000_000)
    )
      throw Error(
        "OCR/cleaning requires a native document region up to 4MP within the image bounds.",
      );
    if (type === "repair" && data.request.stroke.clone) {
      const source = data.request.stroke.clone;
      dimensions.set(source.assetId, { width: source.width, height: source.height });
    }
    if (
      frame &&
      (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) ||
        Math.abs(frame.x) > 200000 ||
        Math.abs(frame.y) > 200000 ||
        frame.width <= 0 ||
        frame.height <= 0 ||
        frame.width > 250000 ||
        frame.height > 250000)
    )
      throw Error("Invalid render viewport.");
    if (board) {
      const padding = effectPadding(doc, scale),
        visible = visibleLayerIds(doc);
      if (
        (Math.ceil(board.width * scale) + 2 * padding) *
          (Math.ceil(board.height * scale) + 2 * padding) >
          data.maxArea * 3 ||
        doc.layers.some(
          (l) =>
            visible.has(l.id) &&
            l.kind !== "group" &&
            Math.ceil(l.width * scale) * Math.ceil(l.height * scale) > data.maxArea,
        )
      )
        throw Error(
          "Artboard scale exceeds the layer/effect rendering budget. Reduce export scale.",
        );
    }
    const get = async (assetId: string, s: number) => {
      s = Math.min(1, s); // Upscaling never needs to decode more pixels than the immutable source.

      const size = dimensions.get(assetId);
      if (!size || !assets[assetId]) throw new Error("A raster asset is missing.");
      const key = `${assetId}:${size.width}x${size.height}:${s}`;
      if (!cache.has(key)) {
        const info = await preflightImage(assets[assetId]!, {
          ...imagePolicy(data.maxArea <= 4_000_000),
          maxPixels: data.maxArea,
          maxSide: 16384,
        });
        if (
          doc.layers.some((l) =>
            l.effects?.some((e) => e.pattern?.kind === "bitmap" && e.pattern.assetId === assetId),
          ) &&
          (info.width !== size.width || info.height !== size.height)
        )
          throw Error("Bitmap pattern dimensions disagree with the validated source header.");
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
    if (type === "modify-selection") {
      // Feather stays a live selection property: modify the unfeathered coverage.
      const mask = selectionCanvas(
        { ...(doc.selection ?? { regions: [], inverted: false }), feather: 0 },
        doc.width,
        doc.height,
      );
      try {
        const alpha = mask.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data,
          input = new Uint8Array(doc.width * doc.height);
        for (let i = 0; i < input.length; i++) input[i] = alpha[i * 4 + 3]!;
        mask.width = mask.height = 1;
        let yielded = performance.now();
        const out = await modifySelection(
          input,
          doc.width,
          doc.height,
          data.operation,
          data.amount,
          async () => {
            if (latest !== id) throw new DOMException("Selection change cancelled", "AbortError");
            if (performance.now() - yielded > 12) {
              await new Promise((resolve) => setTimeout(resolve, 0));
              yielded = performance.now();
            }
          },
        );
        self.postMessage({
          id,
          type: "selection",
          region: coverageRegion(out, doc.width, doc.height),
        });
      } finally {
        mask.width = mask.height = 1;
      }
      return;
    }
    if (type === "adjustment-histogram") {
      const selected = doc.layers.find((l) => l.id === data.layerId);
      if (!selected?.adjustmentLayer) throw Error("Choose a persistent color adjustment layer.");
      let histogram: Awaited<ReturnType<typeof histogramTiles>> | undefined;
      const complete = new Error("Adjustment histogram captured");
      try {
        const rendered = await composite(
          doc,
          1,
          get,
          () => latest !== id,
          () => {},
          undefined,
          async (layer, input) => {
            if (layer.id !== selected.id) return;
            histogram = await histogramTiles(
              input.getContext("2d")!,
              input.width,
              input.height,
              async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (latest !== id) throw new DOMException("Histogram superseded", "AbortError");
              },
            );
            throw complete;
          },
        );
        rendered.width = rendered.height = 1;
      } catch (e) {
        if (e !== complete) throw e;
      }
      self.postMessage({ id, type, histogram });
      return;
    }
    if (type === "color-source") {
      const target = colorTarget(doc, data.layerId, data.maxArea);
      const output = await surface({ ...target, mask: undefined, smartFilters: undefined }, 1, get);
      try {
        const blob = await output.convertToBlob({ type: "image/png" });
        if (latest !== id) throw new DOMException("Color source cancelled", "AbortError");
        self.postMessage({ id, type, blob });
      } finally {
        output.width = output.height = 1;
      }
      return;
    }
    if (type === "stage-selection") {
      if (Object.keys(assets).length > 62)
        throw Error("The immutable asset pool has no room for selected pixels.");
      const result = await renderSelectionTransform(
        doc,
        data.layerId,
        data.maxArea,
        get,
        () => latest !== id,
      );
      self.postMessage({ id, type, ...result });
      return;
    }
    if (type === "apply-mask") {
      const layer = doc.layers.find((l) => l.id === data.layerId);
      if (
        !layer ||
        !["raster", "paint"].includes(layer.kind) ||
        !layer.mask?.enabled ||
        layer.locked
      )
        throw Error("Choose an unlocked raster or paint layer with an enabled mask.");
      if (layer.smartFilters?.some((f) => f.enabled))
        throw Error(
          "Disable Smart Filters before baking a layer mask, to keep the filter stack editable. The mask, original artwork and filters are unchanged.",
        );
      const output = await surface(layer, 1, get);
      try {
        const blob = await output.convertToBlob({ type: "image/png" }),
          assetId = crypto.randomUUID();
        const replacement = {
          ...layer,
          kind: "raster" as const,
          assetId,
          mask: undefined,
          strokes: [],
          adjustments: { ...NEUTRAL },
          color: undefined,
          colorSelection: undefined,
          hue: 0,
          black: 0,
          white: 255,
          gamma: 1,
          curve: [0, 64, 128, 192, 255],
        };
        if (latest !== id) throw new DOMException("Cancelled", "AbortError");
        self.postMessage({
          id,
          type: "apply-mask",
          blob,
          assetId,
          document: {
            ...doc,
            layers: doc.layers.map((l) => (l.id === layer.id ? replacement : l)),
          },
        });
      } finally {
        output.width = output.height = 1;
      }
      return;
    }
    if (type === "thumbnails") {
      const thumbnails: { id: string; blob: Blob }[] = [],
        thumbScale = thumbnailScale(doc);
      if (
        data.layerIds !== undefined &&
        (!Array.isArray(data.layerIds) ||
          data.layerIds.length > 48 ||
          new Set(data.layerIds).size !== data.layerIds.length ||
          data.layerIds.some(
            (id: unknown) => typeof id !== "string" || !doc.layers.some((l) => l.id === id),
          ))
      )
        throw Error("Invalid thumbnail layer request.");
      for (const l of doc.layers.filter((l) => !data.layerIds || data.layerIds.includes(l.id))) {
        if (latest !== id) throw new DOMException("Cancelled", "AbortError");
        const isolated = thumbnailDocument(doc, l.id),
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
    if (type === "dialogue-region") {
      const padding = effectPadding(doc, 1);
      if ((frame!.width + padding * 2) * (frame!.height + padding * 2) > data.maxArea * 3)
        throw Error("Region effects exceed the rendering budget.");
      const rendered = await composite(
        doc,
        1,
        get,
        () => latest !== id,
        () => {},
        frame,
      );
      try {
        // composite already removes its internal effect padding.
        const blob = await rendered.convertToBlob({ type: "image/png" });
        if (latest !== id) throw new DOMException("Region cancelled.", "AbortError");
        self.postMessage({ id, type: "dialogue-region", blob });
      } finally {
        rendered.width = rendered.height = 1;
      }
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
      frame,
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
    if (type === "sample") {
      try {
        const point = data.point;
        if (
          !point ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.y < 0 ||
          point.x >= doc.width ||
          point.y >= doc.height
        )
          throw Error("Sample inside the document.");
        const rgba = output
          .getContext("2d")!
          .getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
        if (rgba[3] === 0) throw Error("Choose a visible foreground or background pixel.");
        self.postMessage({ id, type: "sample", sample: [rgba[0], rgba[1], rgba[2]] });
      } finally {
        output.width = output.height = 1;
      }
      return;
    }
    if (type === "refine") {
      const mask = selectionCanvas(
        doc.selection ?? { regions: [], inverted: false, feather: 0 },
        doc.width,
        doc.height,
      );
      try {
        const alpha = mask.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data,
          input = new Uint8Array(doc.width * doc.height);
        for (let i = 0; i < input.length; i++) input[i] = alpha[i * 4 + 3]!;
        const pixels = output.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data;
        let yielded = performance.now();
        const result = await refineTiled(
          pixels,
          input,
          doc.width,
          doc.height,
          data.options,
          async () => {
            if (latest !== id) throw new DOMException("Refinement cancelled", "AbortError");
            if (performance.now() - yielded > 12) {
              await new Promise((resolve) => setTimeout(resolve, 0));
              yielded = performance.now();
            }
          },
          (done, total) => self.postMessage({ id, type: "progress", done, total }),
        );
        if (latest !== id) throw new DOMException("Refinement cancelled", "AbortError");
        self.postMessage({
          id,
          type: "selection",
          region: coverageRegion(result, doc.width, doc.height),
        });
      } finally {
        mask.width = mask.height = output.width = output.height = 1;
      }
      return;
    }
    if (type === "select") {
      try {
        const pixels = output.getContext("2d")!.getImageData(0, 0, doc.width, doc.height);
        const region = data.options?.range
          ? colorRangeRegion(pixels.data, doc.width, doc.height, data.options.range)
          : data.options?.alpha
            ? alphaRegion(pixels.data, doc.width, doc.height)
            : selectColor(pixels.data, doc.width, doc.height, data.point, data.options);
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
      if ((board || data.fullCanvas) && data.mime === "image/jpeg") {
        const ctx = output.getContext("2d")!;
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, output.width, output.height);
        ctx.globalCompositeOperation = "source-over";
      }
      if (!data.fullCanvas && !board)
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
