import { enhancementPlan } from "./plan.ts";
import type { EnhanceModel } from "./models.ts";
export { ENHANCE_MAX_AREA, ENHANCE_MAX_SIDE } from "./plan.ts";
export type EnhanceOptions = {
  scale: 1 | 2 | 4;
  model?: EnhanceModel;
  denoise: number;
  sharpen: number;
  color: boolean;
  artifacts: boolean;
};
export const DEFAULT_ENHANCE: EnhanceOptions = {
  scale: 2,
  denoise: 0,
  sharpen: 0,
  color: false,
  artifacts: false,
};
export type EnhanceProgress = { stage: string; done: number; total: number };
export type EnhanceResult = { blob: Blob; width: number; height: number };
export type WorkerReply =
  | { type: "progress"; progress: EnhanceProgress }
  | { type: "result"; result: EnhanceResult }
  | { type: "error"; error: string };

export function enhancementSize(width: number, height: number, scale: number) {
  const { width: w, height: h } = enhancementPlan(width, height, scale);
  return { width: w, height: h };
}
export function validateEnhanceOptions(options: EnhanceOptions) {
  if (
    !options ||
    ![1, 2, 4].includes(options.scale) ||
    (options.model !== undefined &&
      options.model !== "swin2sr" &&
      options.model !== "realesrgan-anime") ||
    !Number.isFinite(options.denoise) ||
    options.denoise < 0 ||
    options.denoise > 40 ||
    !Number.isFinite(options.sharpen) ||
    options.sharpen < 0 ||
    options.sharpen > 40 ||
    typeof options.color !== "boolean" ||
    typeof options.artifacts !== "boolean"
  )
    throw Error("Invalid AI enhancement settings.");
}
export const ENHANCE_PRESETS = {
  fidelity: { denoise: 0, sharpen: 0, color: false, artifacts: false },
  "gentle-cleanup": { denoise: 10, sharpen: 5, color: false, artifacts: false },
  "legacy-cleanup": { denoise: 15, sharpen: 15, color: false, artifacts: true },
} as const;
