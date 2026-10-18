/// <reference lib="webworker" />
import {
  assertSize,
  defaultRecipe,
  previewSize,
  rotatedBounds,
  SOURCE_LIMITS,
  validateRecipe,
  type EditRecipe,
  type RenderLimits,
} from "./geometry";
let image: ImageBitmap | null = null;
let generation = 0;
function render(recipe: EditRecipe, size: { width: number; height: number }) {
  if (!image) throw new Error("Source image is not ready.");
  validateRecipe(recipe, image.width, image.height);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is unavailable.");
  const bounds = rotatedBounds(recipe.crop.width, recipe.crop.height, recipe.rotation);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(size.width / 2, size.height / 2);
  ctx.scale(size.width / bounds.width, size.height / bounds.height);
  ctx.rotate((recipe.rotation * Math.PI) / 180);
  ctx.scale(recipe.flipX ? -1 : 1, recipe.flipY ? -1 : 1);
  const crop = recipe.crop;
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -crop.width / 2,
    -crop.height / 2,
    crop.width,
    crop.height,
  );
  return canvas;
}
self.onmessage = async ({
  data,
}: MessageEvent<{
  id: number;
  type: "source" | "preview" | "save";
  blob?: Blob;
  recipe?: EditRecipe;
  limits: RenderLimits;
}>) => {
  const { id, type } = data;
  try {
    if (type === "source") {
      const version = ++generation;
      if (!data.blob || data.blob.size > 80 * 1024 * 1024)
        throw new Error("Choose an image smaller than 80 MB for editing.");
      const next = await createImageBitmap(data.blob, { imageOrientation: "from-image" });
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
      const canvas = render(
        defaultRecipe(image.width, image.height),
        previewSize(image.width, image.height),
      );
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ id, type: "source", bitmap, width: image.width, height: image.height }, [
        bitmap,
      ]);
      canvas.width = canvas.height = 0;
    } else {
      if (!data.recipe) throw new Error("Missing editing recipe.");
      if (type === "save") assertSize(data.recipe.width, data.recipe.height, data.limits);
      const size =
        type === "save" ? data.recipe : previewSize(data.recipe.width, data.recipe.height);
      const canvas = render(data.recipe, size);
      try {
        if (type === "preview") {
          const bitmap = canvas.transferToImageBitmap();
          self.postMessage(
            { id, type, bitmap, width: data.recipe.width, height: data.recipe.height },
            [bitmap],
          );
        } else {
          const blob = await canvas.convertToBlob({ type: "image/png" });
          self.postMessage({ id, type, blob, width: size.width, height: size.height });
        }
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      error:
        error instanceof Error
          ? error.message
          : "Could not process this image. Your source is unchanged.",
    });
  }
};
