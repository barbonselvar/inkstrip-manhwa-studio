/// <reference lib="webworker" />
import { safeBitmap } from "../image-decode";
import { imagePolicy } from "../image-policy";
import {
  assertSize,
  defaultRecipe,
  sourceToOutput,
  previewSize,
  SOURCE_LIMITS,
  validateRecipe,
  type EditRecipe,
  type RenderLimits,
} from "./geometry";
import { adjustmentHalo, applyAdjustments, hasAdjustments, NEUTRAL } from "./adjustments";
import { blendSelection, rasterizeMask } from "./mask";
let image: ImageBitmap | null = null;
let generation = 0,
  previewGeneration = 0;
const TILE = 384;
/** Transform source into output-pixel tiles, filter with halos, and copy each interior once. */
async function render(
  recipe: EditRecipe,
  size: { width: number; height: number },
  id: number,
  save: boolean,
  version: number,
) {
  if (!image) throw new Error("Source image is not ready.");
  validateRecipe(recipe, image.width, image.height);
  const source = image;
  const canvas = new OffscreenCanvas(size.width, size.height),
    ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable.");
  const transform = sourceToOutput(recipe, size.width, size.height);
  const drawSource = (target: OffscreenCanvasRenderingContext2D, left = 0, top = 0) => {
    target.setTransform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e - left,
      transform.f - top,
    );
    const c = recipe.crop;
    target.drawImage(source, c.x, c.y, c.width, c.height, c.x, c.y, c.width, c.height);
    target.resetTransform();
  };
  const selective = recipe.selective;
  const local = !!selective?.strokes.length && hasAdjustments(selective.adjustments);
  if (!hasAdjustments(recipe.adjustments) && !local) {
    drawSource(ctx);
    return canvas;
  }
  // Filters operate in final output pixels. Preview radii scale with resolution.
  const sample = Math.min(size.width / recipe.width, size.height / recipe.height);
  const rw = size.width,
    rh = size.height;
  const halo =
    adjustmentHalo(recipe.adjustments, sample) +
    (local ? adjustmentHalo(selective!.adjustments, sample) : 0);
  const scratch = new OffscreenCanvas(1, 1),
    work = scratch.getContext("2d", { willReadFrequently: true });
  if (!work) {
    canvas.width = canvas.height = 0;
    throw new Error("Pixel editing is unavailable.");
  }
  const total = Math.ceil(rw / TILE) * Math.ceil(rh / TILE);
  let done = 0;
  try {
    for (let y = 0; y < rh; y += TILE)
      for (let x = 0; x < rw; x += TILE) {
        if (!save && version !== previewGeneration)
          throw new DOMException("Preview superseded.", "AbortError");
        const left = Math.max(0, x - halo),
          top = Math.max(0, y - halo),
          right = Math.min(rw, x + TILE + halo),
          bottom = Math.min(rh, y + TILE + halo);
        scratch.width = right - left;
        scratch.height = bottom - top;
        work.imageSmoothingEnabled = true;
        work.imageSmoothingQuality = "high";
        drawSource(work, left, top);
        const frame = work.getImageData(0, 0, scratch.width, scratch.height);
        let pixels = applyAdjustments(
          frame.data,
          scratch.width,
          scratch.height,
          recipe.adjustments ?? NEUTRAL,
          sample,
        );
        if (local) {
          const mask = rasterizeMask(
            selective!.strokes,
            scratch.width,
            scratch.height,
            source.width,
            source.height,
            0,
            0,
            1,
            1,
            { ...transform, e: transform.e - left, f: transform.f - top },
          );
          pixels = blendSelection(
            pixels,
            applyAdjustments(pixels, scratch.width, scratch.height, selective!.adjustments, sample),
            mask,
          );
        }
        frame.data.set(pixels);
        work.putImageData(frame, 0, 0);
        const w = Math.min(TILE, rw - x),
          h = Math.min(TILE, rh - y);
        ctx.drawImage(scratch, x - left, y - top, w, h, x, y, w, h);
        done++;
        if (save) self.postMessage({ id, type: "progress", done, total });
        // Yield so newer preview requests can cancel obsolete work between tiles.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    return canvas;
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  } finally {
    scratch.width = scratch.height = 0;
  }
}
self.onmessage = async ({
  data,
}: MessageEvent<{
  id: number;
  type: "source" | "preview" | "save";
  blob?: Blob;
  recipe?: EditRecipe;
  limits: RenderLimits;
  sourceView?: boolean;
}>) => {
  const { id, type } = data;
  try {
    if (type === "source") {
      const version = ++generation;
      if (!data.blob || data.blob.size > 80 * 1024 * 1024)
        throw new Error("Choose an image smaller than 80 MB for editing.");
      const next = await safeBitmap(data.blob, {
        policy: {
          ...imagePolicy(data.limits.maxArea <= 16_000_000),
          maxPixels: Math.min(data.limits.maxArea, SOURCE_LIMITS.maxArea),
        },
      });
      if (version !== generation) {
        next.close();
        return;
      }
      try {
        assertSize(next.width, next.height, {
          maxSide: SOURCE_LIMITS.maxSide,
          maxArea: data.limits.maxArea,
        });
      } catch (error) {
        next.close();
        throw error;
      }
      image?.close();
      image = next;
      const canvas = await render(
        defaultRecipe(image.width, image.height),
        previewSize(image.width, image.height),
        id,
        false,
        ++previewGeneration,
      );
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ id, type, bitmap, width: image.width, height: image.height }, [bitmap]);
      canvas.width = canvas.height = 0;
    } else {
      if (!data.recipe || !image) throw new Error("Missing editing recipe or source.");
      const version = ++previewGeneration;
      validateRecipe(data.recipe, image.width, image.height);
      const recipe = data.sourceView
        ? {
            ...data.recipe,
            crop: { x: 0, y: 0, width: image.width, height: image.height },
            rotation: 0,
            flipX: false,
            flipY: false,
            width: image.width,
            height: image.height,
            layout: undefined,
          }
        : data.recipe;
      if (type === "save") assertSize(recipe.width, recipe.height, data.limits);
      const canvas = await render(
        recipe,
        type === "save" ? recipe : previewSize(recipe.width, recipe.height),
        id,
        type === "save",
        version,
      );
      try {
        if (type === "preview") {
          if (version !== previewGeneration)
            throw new DOMException("Preview superseded.", "AbortError");
          const bitmap = canvas.transferToImageBitmap();
          self.postMessage({ id, type, bitmap, width: recipe.width, height: recipe.height }, [
            bitmap,
          ]);
        } else {
          const blob = await canvas.convertToBlob({ type: "image/png" });
          self.postMessage({ id, type, blob, width: recipe.width, height: recipe.height });
        }
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
  } catch (error) {
    self.postMessage({
      id,
      type: error instanceof Error && error.name === "AbortError" ? "cancelled" : "error",
      error:
        error instanceof Error
          ? error.message
          : "Could not process image. Current image unchanged.",
    });
  }
};
