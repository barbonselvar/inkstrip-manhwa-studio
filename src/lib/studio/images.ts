import { planStrip, type CanvasLimits, type PlannedPart } from "@/lib/studio/plan";
import { PAPER, type StripFormat } from "@/lib/studio/types";
import { browserImagePolicy, preflightImage, type ImagePolicy } from "./image-policy";
import { boundedBitmap, imageLease, matchingDimensions } from "./image-decode";

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
  "jxl",
  "svg",
  "ico",
];

export const IMAGE_ACCEPT = ["image/*", ...EXTENSIONS.map((ext) => `.${ext}`)].join(",");

export const FORMAT_HINT =
  "JPG, PNG, WebP, AVIF, GIF, BMP, ICO and safe SVG keep their original file. HEIC/HEIF, TIFF and JPEG XL are converted to lossless PNG. Animated GIF/WebP/APNG keep their file; the first frame is displayed and edited.";

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

export async function decodeBlob(
  blob: Blob,
  options: { signal?: AbortSignal; policy?: ImagePolicy } = {},
): Promise<Decoded> {
  const info = await preflightImage(blob, options.policy ?? browserImagePolicy(), options.signal);
  const release = await imageLease(options.signal);
  let transferred = false;
  const close = (fn: () => void) => {
    let closed = false;
    transferred = true;
    return () => {
      if (!closed) {
        closed = true;
        try {
          fn();
        } finally {
          release();
        }
      }
    };
  };
  try {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await boundedBitmap(blob, info, options.signal);
        if (bitmap.width > 0 && bitmap.height > 0) {
          return {
            width: bitmap.width,
            height: bitmap.height,
            source: bitmap,
            close: close(() => bitmap.close()),
          };
        }
        bitmap.close();
      } catch (error) {
        if (
          (error as Error).name === "AbortError" ||
          (error as Error).name === "TimeoutError" ||
          (error as Error).name === "DecodeBusyError" ||
          (error as Error).message.includes("dimensions disagree") ||
          options.signal?.aborted
        )
          throw error;
        /* Try the image element path for formats bitmap cannot read. */
      }
    }

    const url = URL.createObjectURL(
      blob.type === info.mime ? blob : blob.slice(0, blob.size, info.mime),
    );
    let image: HTMLImageElement | undefined;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        image = el;
        const clean = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          el.onload = el.onerror = null;
        };
        const fail = (error: Error) => {
          clean();
          el.removeAttribute("src");
          reject(error);
        };
        const abort = () => fail(new DOMException("Image loading cancelled", "AbortError"));
        const timer = setTimeout(
          () => fail(new DOMException("Image decoding timed out", "TimeoutError")),
          15_000,
        );
        el.onload = () => {
          clean();
          resolve(el);
        };
        el.onerror = () =>
          fail(
            new Error(
              "This browser could not decode the validated image. Export a PNG/JPEG/WebP copy.",
            ),
          );
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) {
          abort();
          return;
        }
        el.src = url;
      });
      if (!matchingDimensions(img.naturalWidth, img.naturalHeight, info))
        throw new Error("Decoded image dimensions disagree with its validated header.");
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        source: img,
        close: close(() => {
          img.removeAttribute("src");
          URL.revokeObjectURL(url);
        }),
      };
    } catch (error) {
      image?.removeAttribute("src");
      URL.revokeObjectURL(url);
      throw error;
    }
  } finally {
    if (!transferred) release();
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
  try {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, thumbWidth, fullHeight);
    return await canvasToBlob(canvas, "image/jpeg", 0.82);
  } finally {
    canvas.width = canvas.height = 0;
  }
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
    const only = part.panels.length === 1 ? part.panels[0]! : undefined,
      source = only && byId.get(only.id);
    // A page that is exactly one JPEG at its native size keeps the original bytes: no
    // generational JPEG loss (EXIF orientation still applies when the page is shown).
    if (
      plan.parts.length === 1 &&
      only &&
      source &&
      options.format === "image/jpeg" &&
      source.blob.type === "image/jpeg" &&
      only.srcY === 0 &&
      only.drawH === only.fullH &&
      only.drawW === source.sw &&
      only.fullH === source.sh &&
      part.height === source.sh
    ) {
      done++;
      onProgress?.(done, total, `Drawing ${done} of ${total}`);
      parts.push({ blob: source.blob, height: part.height });
      continue;
    }
    const blob = await renderPart({
      width: plan.width,
      part,
      frames: byId,
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
  format: StripFormat;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = Math.max(1, input.part.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not draw the page.");
  try {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    for (const panel of input.part.panels) {
      const frame = input.frames.get(panel.id);
      if (!frame) throw new Error("A panel could not be drawn.");
      const image = await decodeBlob(frame.blob);
      try {
        // Draw only this segment's source rows; a tall panel continues in the next part.
        const scale = image.height / panel.fullH;
        ctx.drawImage(
          image.source,
          0,
          panel.srcY * scale,
          image.width,
          panel.drawH * scale,
          panel.x,
          panel.y,
          panel.drawW,
          panel.drawH,
        );
      } finally {
        image.close();
      }
      if (panel.srcY + panel.drawH >= panel.fullH) input.onImage();
      await yieldToPaint();
    }

    const blob = await canvasToBlob(
      canvas,
      input.format,
      input.format === "image/jpeg" ? 0.92 : undefined,
    );
    return blob;
  } finally {
    canvas.width = canvas.height = 0;
  }
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
