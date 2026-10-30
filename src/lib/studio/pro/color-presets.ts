import { defaultOperation, validateOperation, type ColorOperation } from "./color-engine.ts";
export type ColorPreset = { name: string; operation: ColorOperation };
export const COLOR_PRESET_KEY = "inkstrip-r6-color-presets-v1";
export const COLOR_PRESETS: ColorPreset[] = [
  { name: "Soft Contrast", operation: { kind: "brightnessContrast", brightness: 2, contrast: -8 } },
  { name: "High Contrast", operation: { kind: "brightnessContrast", brightness: 0, contrast: 22 } },
  {
    name: "Warm Tone",
    operation: {
      ...defaultOperation("balance"),
      kind: "balance",
      shadows: [0, 0, 0],
      midtones: [8, 2, -6],
      highlights: [2, 0, -2],
      preserveLuminance: true,
    },
  },
  {
    name: "Cool Tone",
    operation: {
      kind: "balance",
      shadows: [-2, 0, 4],
      midtones: [-6, 0, 8],
      highlights: [0, 0, 2],
      preserveLuminance: true,
    },
  },
  { name: "Grayscale", operation: defaultOperation("blackWhite") },
  {
    name: "Manga Ink Contrast",
    operation: {
      kind: "levels",
      channels: {
        ...(defaultOperation("levels") as Extract<ColorOperation, { kind: "levels" }>).channels,
        rgb: { black: 22, white: 235, gamma: 1, outBlack: 0, outWhite: 255 },
      },
    },
  },
  {
    name: "Manhwa Color Enhancement",
    operation: { kind: "vibrance", vibrance: 25, saturation: 5 },
  },
];
export function validateColorPresets(value: unknown): asserts value is ColorPreset[] {
  if (!Array.isArray(value) || value.length > 32)
    throw Error("Keep at most 32 custom color presets.");
  const names = new Set(COLOR_PRESETS.map((p) => p.name.toLowerCase()));
  for (const p of value) {
    if (
      !p ||
      Object.keys(p).sort().join() !== "name,operation" ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 80 ||
      [...p.name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      names.has(p.name.trim().toLowerCase())
    )
      throw Error("Use a unique preset name of 1–80 characters.");
    validateOperation(p.operation);
    names.add(p.name.trim().toLowerCase());
  }
}
export function loadColorPresets(storage: Pick<Storage, "getItem"> | undefined): ColorPreset[] {
  try {
    const raw = storage?.getItem(COLOR_PRESET_KEY);
    if (!raw || raw.length > 100_000) return [];
    const v = JSON.parse(raw);
    if (v.version !== 1) return [];
    validateColorPresets(v.presets);
    return v.presets;
  } catch {
    return [];
  }
}
export function storeColorPresets(
  storage: Pick<Storage, "setItem"> | undefined,
  presets: ColorPreset[],
) {
  validateColorPresets(presets);
  if (!storage) throw Error("Preset storage is unavailable.");
  storage.setItem(COLOR_PRESET_KEY, JSON.stringify({ version: 1, presets }));
}
