export type EnhanceOptions = {
  scale: 1 | 2;
  denoise: number;
  sharpen: number;
  color: boolean;
  artifacts: boolean;
};
export const DEFAULT_ENHANCE: EnhanceOptions = {
  scale: 2,
  denoise: 15,
  sharpen: 15,
  color: false,
  artifacts: true,
};
export type EnhanceProgress = { stage: string; done: number; total: number };
export type EnhanceTimings = {
  modelRetrievalMs: number;
  integrityMs: number;
  runtimeDownloadMs: number;
  sessionCreateMs: number;
  preprocessMs: number;
  inferenceMs: number;
  reconstructionMs: number;
  encodeMs: number;
  totalMs: number;
  sessionReused: boolean;
};
export type EnhanceResult = { blob: Blob; width: number; height: number; timings?: EnhanceTimings };
export type WorkerReply =
  | { type: "progress"; progress: EnhanceProgress }
  | { type: "result"; result: EnhanceResult }
  | { type: "error"; error: string };

export function enhancementSize(width: number, height: number, scale: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    ![1, 2].includes(scale)
  ) {
    throw new Error("Invalid image dimensions or scale.");
  }
  // Also bound the 2× intermediate canvas when the requested final size is 1×.
  if (width * height > 4_000_000 || Math.max(width, height) * 2 > 8192) {
    throw new Error(
      "This image exceeds the on-device AI limit (4 megapixels / 4096px per side). Original unchanged.",
    );
  }
  return { width: width * scale, height: height * scale };
}
