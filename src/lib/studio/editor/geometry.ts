import { validateAdjustments, type Adjustments } from "./adjustments.ts";
import { validateStrokes, type MaskStroke } from "./mask.ts";
export type CropRect = { x: number; y: number; width: number; height: number };
export type Layout = { scale: number; x: number; y: number };
export const DEFAULT_LAYOUT: Readonly<Layout> = Object.freeze({ scale: 100, x: 0, y: 0 });
export function layoutPlacement(width: number, height: number, layout: Layout = DEFAULT_LAYOUT) {
  return {
    scale: layout.scale / 100,
    x: ((width * (1 - layout.scale / 100)) / 2) * layout.x,
    y: ((height * (1 - layout.scale / 100)) / 2) * layout.y,
  };
}
export type EditRecipe = {
  crop: CropRect;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  adjustments?: Adjustments;
  selective?: { adjustments: Adjustments; strokes: MaskStroke[] };
  layout?: Layout;
  width: number;
  height: number;
};
export type RenderLimits = { maxSide: number; maxArea: number };
export const SOURCE_LIMITS: RenderLimits = { maxSide: 65535, maxArea: 32_000_000 };

export function assertSize(width: number, height: number, limits: RenderLimits) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error("Image dimensions must be positive whole pixels.");
  if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxArea)
    throw new Error(
      `Image exceeds this operation's limit (${limits.maxSide}px per side / ${(limits.maxArea / 1_000_000).toFixed(0)} megapixels). Crop or resize before saving; your image is unchanged.`,
    );
}
export function normalizeAngle(value: number) {
  if (!Number.isFinite(value)) throw new Error("Rotation must be a finite number.");
  const angle = ((((value + 180) % 360) + 360) % 360) - 180;
  return Math.round(angle * 100) / 100;
}
export function rotatedBounds(width: number, height: number, rotation: number) {
  const radians = (normalizeAngle(rotation) * Math.PI) / 180;
  const c = Math.abs(Math.cos(radians)),
    s = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.ceil(width * c + height * s - 1e-8)),
    height: Math.max(1, Math.ceil(width * s + height * c - 1e-8)),
  };
}
export function defaultRecipe(width: number, height: number): EditRecipe {
  assertSize(width, height, SOURCE_LIMITS);
  return {
    crop: { x: 0, y: 0, width, height },
    rotation: 0,
    flipX: false,
    flipY: false,
    width,
    height,
  };
}
export function validateRecipe(recipe: EditRecipe, sourceWidth: number, sourceHeight: number) {
  assertSize(sourceWidth, sourceHeight, SOURCE_LIMITS);
  validateAdjustments(recipe.adjustments);
  if (recipe.selective !== undefined) {
    if (
      !recipe.selective ||
      !recipe.selective.adjustments ||
      !Array.isArray(recipe.selective.strokes)
    )
      throw new Error("Invalid selective adjustment.");
    validateAdjustments(recipe.selective.adjustments);
    validateStrokes(recipe.selective.strokes);
  }
  if (recipe.layout !== undefined) {
    const { scale, x, y } = recipe.layout ?? {};
    if (
      !Number.isFinite(scale) ||
      scale < 10 ||
      scale > 100 ||
      !Number.isFinite(x) ||
      x < -1 ||
      x > 1 ||
      !Number.isFinite(y) ||
      y < -1 ||
      y > 1
    )
      throw new Error("Invalid artwork layout.");
  }

  const { crop } = recipe;
  if (
    ![crop.x, crop.y, crop.width, crop.height, recipe.width, recipe.height].every(
      Number.isInteger,
    ) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.x + crop.width > sourceWidth ||
    crop.y + crop.height > sourceHeight ||
    typeof recipe.flipX !== "boolean" ||
    typeof recipe.flipY !== "boolean" ||
    !Number.isFinite(recipe.rotation)
  )
    throw new Error("Invalid crop or transform. Keep the crop inside the source image.");
  if (recipe.width < 1 || recipe.height < 1 || recipe.width > 65535 || recipe.height > 65535)
    throw new Error("Output dimensions must be between 1 and 65535 pixels.");
}
export function clampCrop(rect: CropRect, width: number, height: number): CropRect {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(rect.width))),
    height: Math.max(1, Math.min(height - y, Math.round(rect.height))),
  };
}
/** Preserve the previous output scale on each axis when crop/rotation changes. */
export function withGeometry(
  recipe: EditRecipe,
  patch: Partial<Pick<EditRecipe, "crop" | "rotation" | "flipX" | "flipY">>,
): EditRecipe {
  const before = rotatedBounds(recipe.crop.width, recipe.crop.height, recipe.rotation);
  const next = { ...recipe, ...patch, rotation: normalizeAngle(patch.rotation ?? recipe.rotation) };
  const after = rotatedBounds(next.crop.width, next.crop.height, next.rotation);
  return {
    ...next,
    width: Math.max(1, Math.min(65535, Math.round((after.width * recipe.width) / before.width))),
    height: Math.max(
      1,
      Math.min(65535, Math.round((after.height * recipe.height) / before.height)),
    ),
  };
}
export function aspectCrop(crop: CropRect, ratio: number): CropRect {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("Invalid aspect ratio.");
  let width = crop.width,
    height = crop.height;
  if (width / height > ratio) width = Math.max(1, Math.round(height * ratio));
  else height = Math.max(1, Math.round(width / ratio));
  return {
    x: crop.x + Math.floor((crop.width - width) / 2),
    y: crop.y + Math.floor((crop.height - height) / 2),
    width,
    height,
  };
}
export function cropFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
  ratio?: number,
): CropRect {
  let w = Math.max(1, Math.abs(end.x - start.x)),
    h = Math.max(1, Math.abs(end.y - start.y));
  if (ratio) {
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
  }
  return clampCrop(
    {
      x: end.x < start.x ? start.x - w : start.x,
      y: end.y < start.y ? start.y - h : start.y,
      width: w,
      height: h,
    },
    width,
    height,
  );
}
export function previewSize(width: number, height: number, maxSide = 1400) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Map retained source coordinates into output pixels, including crop, flips and frame placement. */
export function sourceToOutput(recipe: EditRecipe, width = recipe.width, height = recipe.height) {
  const bounds = rotatedBounds(recipe.crop.width, recipe.crop.height, recipe.rotation),
    placement = layoutPlacement(width, height, recipe.layout);
  const r = (recipe.rotation * Math.PI) / 180,
    sx = (width / bounds.width) * placement.scale,
    sy = (height / bounds.height) * placement.scale;
  const a = sx * Math.cos(r) * (recipe.flipX ? -1 : 1),
    b = sy * Math.sin(r) * (recipe.flipX ? -1 : 1),
    c = -sx * Math.sin(r) * (recipe.flipY ? -1 : 1),
    d = sy * Math.cos(r) * (recipe.flipY ? -1 : 1);
  const cx = recipe.crop.x + recipe.crop.width / 2,
    cy = recipe.crop.y + recipe.crop.height / 2;
  return {
    a,
    b,
    c,
    d,
    e: width / 2 + placement.x - a * cx - c * cy,
    f: height / 2 + placement.y - b * cx - d * cy,
  };
}
