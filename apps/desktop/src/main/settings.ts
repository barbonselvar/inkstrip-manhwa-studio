/** Validated desktop preferences. Unknown or out-of-range values fall back to defaults. */
import {
  DEFAULT_SETTINGS,
  type DeepPartial,
  type DesktopSettings,
} from "../../../../src/lib/desktop/contract.ts";

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const int = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function sanitizeSettings(value: unknown, base: DesktopSettings = DEFAULT_SETTINGS): DesktopSettings {
  const v = obj(value),
    autosave = obj(v.autosave),
    backups = obj(v.backups),
    updates = obj(v.updates),
    ai = obj(v.ai),
    developer = obj(v.developer);
  return {
    autosave: {
      enabled: bool(autosave.enabled, base.autosave.enabled),
      intervalMinutes: int(autosave.intervalMinutes, base.autosave.intervalMinutes, 1, 60),
      writeProjectFile: bool(autosave.writeProjectFile, base.autosave.writeProjectFile),
    },
    backups: { keep: int(backups.keep, base.backups.keep, 0, 50) },
    updates: {
      autoCheck: bool(updates.autoCheck, base.updates.autoCheck),
      autoDownload: bool(updates.autoDownload, base.updates.autoDownload),
    },
    ai: { cloudEnabled: bool(ai.cloudEnabled, base.ai.cloudEnabled) },
    developer: { devTools: bool(developer.devTools, base.developer.devTools) },
  };
}

/** Apply a partial update: only known keys with valid values change. */
export function mergeSettings(current: DesktopSettings, patch: DeepPartial<DesktopSettings> | unknown) {
  const p = obj(patch);
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof DesktopSettings)[])
    merged[key] = { ...current[key], ...obj(p[key]) };
  return sanitizeSettings(merged, current);
}
