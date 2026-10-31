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
  inkGaps?: boolean;
};
export const DEFAULT_ENHANCE: EnhanceOptions = {
  scale: 2,
  denoise: 0,
  sharpen: 0,
  color: false,
  artifacts: false,
  inkGaps: false,
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
    (options.inkGaps !== undefined && typeof options.inkGaps !== "boolean") ||
    typeof options.color !== "boolean" ||
    typeof options.artifacts !== "boolean"
  )
    throw Error("Invalid AI enhancement settings.");
}
export const ENHANCE_PRESETS = {
  fidelity: { denoise: 0, sharpen: 0, color: false, artifacts: false, inkGaps: false },
  "gentle-cleanup": { denoise: 10, sharpen: 5, color: false, artifacts: false, inkGaps: false },
  "manga-ink": { denoise: 5, sharpen: 0, color: false, artifacts: false, inkGaps: true },
  "legacy-cleanup": { denoise: 15, sharpen: 15, color: false, artifacts: true, inkGaps: false },
} as const;

/** Compare effective settings, including defaults used by legacy callers. Object
 * insertion order or selecting the default model explicitly is not a new recipe. */
export function enhancementSettingsKey(options: EnhanceOptions) {
  return JSON.stringify([
    options.model ?? "swin2sr",
    options.scale,
    options.denoise,
    options.sharpen,
    options.color,
    options.artifacts,
    options.inkGaps ?? false,
  ]);
}
