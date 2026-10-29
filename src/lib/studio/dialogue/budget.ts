import { RASTER_MAX_AREA, RASTER_TOUCH_MAX_AREA } from "../raster-limits.ts";
import type { ZipEntry } from "./zip.ts";
export function dialogueBudget(deviceMemory = 8, coarse = false) {
  const constrained = deviceMemory <= 4 || coarse;
  return {
    maxArea: constrained ? RASTER_TOUCH_MAX_AREA : RASTER_MAX_AREA,
    archiveBytes: constrained ? 128_000_000 : 512_000_000,
  };
}
export function browserDialogueBudget() {
  return dialogueBudget(
    typeof navigator === "undefined"
      ? 8
      : ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8),
    typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches,
  );
}
export function boundedEntries(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000_000)
    throw Error("Invalid archive memory budget.");
  const entries: ZipEntry[] = [];
  let bytes = 0;
  return {
    entries,
    add(entry: ZipEntry) {
      if (bytes + entry.blob.size > maxBytes)
        throw Error(
          `This export exceeds the${Math.floor(maxBytes / 1_000_000)}MB device budget. Export fewer pages/layers; original artwork is unchanged.`,
        );
      bytes += entry.blob.size;
      entries.push(entry);
    },
  };
}
