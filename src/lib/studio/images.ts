import { planStrip, type CanvasLimits, type PlannedPart } from "@/lib/studio/plan";
import { PAPER, type StripFormat } from "@/lib/studio/types";

const EXTENSIONS = [
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "pjpeg",
  "pjp",
  "png",
  "gif",
  "webp",
  "avif",
  "apng",
  "bmp",
  "dib",
  "tif",
  "tiff",
  "heic",
  "heif",
  "svg",
  "ico",
];

export const IMAGE_ACCEPT = ["image/*", ...EXTENSIONS.map((ext) => `.${ext}`)].join(",");

export const FORMAT_HINT = "JPG, JPEG, PNG, WEBP, GIF, AVIF, BMP, TIFF, HEIC, HEIF, and SVG";

export function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS.includes(ext);
}

export type Decoded = {
  width: number;
  height: number;
  source: CanvasImageSource;
  close: () => void;
};

export function deviceLimits(): CanvasLimits {
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse) return { maxSide: 8192, maxArea: 16_000_000 };
  return { maxSide: 16384, maxArea: 32_000_000 };
}

export async function decodeBlob(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          width: bitmap.width,
          height: bitmap.height,
          source: bitmap,
          close: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      /* Try the image element path for formats bitmap cannot read. */
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("decode");
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      source: img,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function makeThumb(source: CanvasImageSource, width: number, height: number) {
  const thumbWidth = 240;
  const fullHeight = Math.max(1, Math.round(height * (thumbWidth / Math.max(1, width))));
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = Math.min(fullHeight, 360);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare a preview.");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, thumbWidth, fullHeight);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.82);
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

export async function stitchChapter(
  frames: { id: string; sw: number; sh: number; blob: Blob }[],
  options: { width: number; gap: number; format: StripFormat },
  onProgress?: (done: number, total: number, label: string) => void,
) {
  const plan = planStrip(
    frames.map((frame) => ({ id: frame.id, sw: frame.sw, sh: frame.sh })),
    options.width,
    options.gap,
    deviceLimits(),
  );
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const parts: { blob: Blob; height: number }[] = [];
  const total = plan.parts.reduce((sum, part) => sum + part.panels.length, 0);
  let done = 0;

  for (let index = 0; index < plan.parts.length; index += 1) {
    const part = plan.parts[index];
    if (!part) continue;
    onProgress?.(
      done,
      total,
      plan.parts.length > 1 ? `Drawing part ${index + 1}` : "Drawing the page",
    );
    const blob = await renderPart({
      width: plan.width,
      part,
      frames: byId,
      gap: options.gap,
      isLastPart: index === plan.parts.length - 1,
      format: options.format,
      onImage: () => {
        done++;
        onProgress?.(done, total, `Drawing ${done} of ${total}`);
      },
    });
    parts.push({ blob, height: part.height });
  }

  return { width: plan.width, totalHeight: plan.totalHeight, parts };
}

async function renderPart(input: {
  width: number;
  part: PlannedPart;
  frames: Map<string, { id: string; sw: number; sh: number; blob: Blob }>;
  onImage: () => void;
  gap: number;
  isLastPart: boolean;
  format: StripFormat;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = Math.max(1, input.part.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not draw the page.");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const gap = Math.max(0, Math.round(input.gap));
  let y = 0;
  for (let index = 0; index < input.part.panels.length; index++) {
    const panel = input.part.panels[index]!,
      frame = input.frames.get(panel.id);
    if (!frame) throw new Error("A panel could not be drawn.");
    const image = await decodeBlob(frame.blob);
    try {
      ctx.drawImage(image.source, panel.x, y, panel.drawW, panel.drawH);
    } finally {
      image.close();
    }
    y += panel.drawH;
    if (!(index === input.part.panels.length - 1 && input.isLastPart)) y += gap;
    input.onImage();
    await yieldToPaint();
  }

  const blob = await canvasToBlob(
    canvas,
    input.format,
    input.format === "image/jpeg" ? 0.92 : undefined,
  );
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number | undefined) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The stitched page was too large to export on this device."));
      },
      type,
      quality,
    );
  });
}

function yieldToPaint() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
