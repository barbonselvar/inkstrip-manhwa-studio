/** Planning only: no decode, allocation, or silent source resizing. The 4x mode
 * reuses two genuine 2x model passes within the existing 16MP output ceiling. */
export const ENHANCE_MAX_AREA = 4_000_000,
  ENHANCE_MAX_SIDE = 4096;
export const ENHANCE_OUTPUT_AREA = 16_000_000;
export const ENHANCE_OUTPUT_SIDE = 8192;
export function enhancementPlan(
  width: number,
  height: number,
  scale: number,
  model: "swin2sr" | "realesrgan-anime" = "swin2sr",
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    ![1, 2, 4].includes(scale)
  )
    throw Error("Invalid image dimensions or scale.");
  if (width * height > ENHANCE_MAX_AREA || Math.max(width, height) > ENHANCE_MAX_SIDE)
    throw Error(
      "This image exceeds the on-device AI limit (4 megapixels / 4096px per side). Original unchanged.",
    );
  if (
    width * height * scale * scale > ENHANCE_OUTPUT_AREA ||
    Math.max(width, height) * scale > ENHANCE_OUTPUT_SIDE
  )
    throw Error(
      "This scale exceeds the AI output limit (16 megapixels / 8192px per side). Choose 2× or split the page. Original unchanged.",
    );
  const passes = scale === 4 && model === "swin2sr" ? 2 : 1;
  const tiles = (w: number, h: number) => Math.ceil(w / 64) * Math.ceil(h / 64);
  return {
    width: width * scale,
    height: height * scale,
    passes,
    tiles: tiles(width, height) + (passes === 2 ? tiles(width * 2, height * 2) : 0),
  };
}
