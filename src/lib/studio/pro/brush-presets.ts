import type { Stroke } from "./model.ts";

export type BrushSettings = Omit<Stroke, "points" | "erase" | "clip">;
export type BrushPreset = { name: string; settings: BrushSettings };

export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  { name: "Ink · round", settings: { size: 12, hardness: 1, opacity: 1, flow: 1, color: "#172420", tip: "round" } },
  { name: "Soft shade", settings: { size: 48, hardness: 0.2, opacity: 0.45, flow: 0.55, color: "#172420", tip: "round" } },
  { name: "Pencil · square", settings: { size: 4, hardness: 1, opacity: 1, flow: 1, color: "#172420", tip: "square" } },
];

const STORAGE_KEY = "inkstrip-pro-brush-presets-v1";
export function browserBrushStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
const validSettings = (v: unknown): v is BrushSettings => {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.size === "number" && Number.isFinite(s.size) && s.size >= 1 && s.size <= 1000 &&
    typeof s.hardness === "number" && s.hardness >= 0 && s.hardness <= 1 &&
    typeof s.opacity === "number" && s.opacity >= 0 && s.opacity <= 1 &&
    typeof s.flow === "number" && s.flow >= 0.01 && s.flow <= 1 &&
    typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) &&
    (s.tip === undefined || s.tip === "round" || s.tip === "square")
  );
};

export function validateBrushPreset(value: unknown): value is BrushPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Record<string, unknown>;
  return typeof preset.name === "string" && preset.name.trim().length > 0 && preset.name.length <= 40 && validSettings(preset.settings);
}

export function loadBrushPresets(storage: Pick<Storage, "getItem"> | undefined): BrushPreset[] {
  if (!storage) return DEFAULT_BRUSH_PRESETS.map((p) => ({ ...p, settings: { ...p.settings } }));
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(value) && value.length <= 24 && value.every(validateBrushPreset)) return value;
  } catch {
    // Corrupt or unavailable browser preferences fall back to the built-in presets.
  }
  return DEFAULT_BRUSH_PRESETS.map((p) => ({ ...p, settings: { ...p.settings } }));
}

export function saveBrushPresets(storage: Pick<Storage, "setItem"> | undefined, presets: BrushPreset[]) {
  if (!storage || presets.length > 24 || !presets.every(validateBrushPreset)) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

export function upsertBrushPreset(presets: BrushPreset[], preset: BrushPreset): BrushPreset[] {
  if (!validateBrushPreset(preset)) throw new Error("Brush preset is invalid.");
  const next = presets.filter((p) => p.name !== preset.name);
  if (next.length >= 24) throw new Error("A maximum of 24 brush presets can be saved.");
  return [...next, { name: preset.name.trim(), settings: { ...preset.settings } }];
}
