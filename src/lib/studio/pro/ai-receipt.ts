import type { Selection } from "./model.ts";
export type AiReceipt = {
  version: 1;
  task: "restoration";
  composite: "preserve-alpha";
  modelId: string;
  modelRevision: string;
  weightsSha256: string;
  backend: "browser-wasm";
  sourceAssetId: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceDocumentSha256: string;
  region: { x: number; y: number; width: number; height: number };
  selection?: Selection;
  settings: { denoise: number; sharpen: number; color: boolean; artifacts: boolean };
  createdAt: number;
  elapsedMs: number;
};
const finite = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
/** Strict allowlist: receipts cannot smuggle credentials, artifact URLs or prompts into files. */
export function validateAiReceipt(a: AiReceipt) {
  const keys = [
    "version",
    "task",
    "composite",
    "modelId",
    "modelRevision",
    "weightsSha256",
    "backend",
    "sourceAssetId",
    "sourceWidth",
    "sourceHeight",
    "sourceDocumentSha256",
    "region",
    "selection",
    "settings",
    "createdAt",
    "elapsedMs",
  ];
  if (
    !a ||
    Object.keys(a).some((k) => !keys.includes(k)) ||
    a.version !== 1 ||
    a.task !== "restoration" ||
    a.composite !== "preserve-alpha" ||
    a.backend !== "browser-wasm" ||
    ![a.modelId, a.modelRevision, a.sourceAssetId].every(
      (s) => typeof s === "string" && /^[\w.-]{1,100}$/.test(s),
    ) ||
    ![a.weightsSha256, a.sourceDocumentSha256].every(
      (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s),
    ) ||
    ![a.sourceWidth, a.sourceHeight].every((n) => Number.isInteger(n) && finite(n, 1, 16384)) ||
    a.sourceWidth * a.sourceHeight > 16_777_216 ||
    !a.region ||
    Object.keys(a.region).sort().join() !== "height,width,x,y" ||
    ![a.region.x, a.region.y, a.region.width, a.region.height].every(Number.isInteger) ||
    a.region.x < 0 ||
    a.region.y < 0 ||
    a.region.width < 1 ||
    a.region.height < 1 ||
    a.region.x + a.region.width > a.sourceWidth ||
    a.region.y + a.region.height > a.sourceHeight ||
    !a.settings ||
    Object.keys(a.settings).sort().join() !== "artifacts,color,denoise,sharpen" ||
    !finite(a.settings.denoise, 0, 100) ||
    !finite(a.settings.sharpen, 0, 100) ||
    typeof a.settings.color !== "boolean" ||
    typeof a.settings.artifacts !== "boolean" ||
    !finite(a.createdAt, 0, 1e15) ||
    !finite(a.elapsedMs, 0, 86_400_000)
  )
    throw Error("Invalid AI result provenance. No data was imported.");
}
