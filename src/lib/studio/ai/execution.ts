import { EnhancementEngine } from "../enhance/client";
import type { EnhanceOptions } from "../enhance/types";
import { SWIN } from "./registry";
export type AiProgress = (stage: string, done: number, total: number) => void;
export interface AiExecution {
  run(
    blob: Blob,
    settings: EnhanceOptions,
    progress: AiProgress,
  ): Promise<{ blob: Blob; width: number; height: number }>;
  cancel(): void;
}
/** One worker/job. Cancellation terminates download/inference; no artwork leaves the browser. */
export class LocalRestoration implements AiExecution {
  private engine = new EnhancementEngine();
  async run(blob: Blob, settings: EnhanceOptions, progress: AiProgress) {
    if (settings.scale !== 1) throw Error("F1 restores at the document's existing resolution.");
    return this.engine.run(blob, settings, (p) => progress(p.stage, p.done, p.total));
  }
  cancel() {
    this.engine.dispose();
  }
}
export async function digest(value: Blob | string) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : await value.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function validateResult(blob: Blob, width: number, height: number) {
  if (
    blob.type !== "image/png" ||
    blob.size > 48_000_000 ||
    blob.size === 0 ||
    width * height > SWIN.maxPixels
  )
    throw Error("Invalid or oversized AI image; original unchanged.");
  const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  if (header.length !== 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => header[i] !== n))
    throw Error("AI output is not a PNG.");
  const view = new DataView(header.buffer);
  if (view.getUint32(16) !== width || view.getUint32(20) !== height)
    throw Error("AI output header dimensions do not match the processing region.");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width !== width || bitmap.height !== height)
      throw Error("AI result dimensions do not match the processing region.");
  } finally {
    bitmap.close();
  }
}
