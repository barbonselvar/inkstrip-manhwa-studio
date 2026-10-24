import { validateDynamics } from "./brush-dynamics.ts";
import type { Stroke } from "./model.ts";

export type BrushSettings = Omit<Stroke, "points" | "erase" | "clip">;
export type BrushPreset = {
  name: string;
  settings: BrushSettings;
  tool?: "brush" | "pencil" | "eraser";
};

export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  {
    name: "Ink · round",
    settings: { size: 12, hardness: 1, opacity: 1, flow: 1, color: "#172420", tip: "round" },
  },
  {
    name: "Soft shade",
    settings: {
      size: 48,
      hardness: 0.2,
      opacity: 0.45,
      flow: 0.55,
      color: "#172420",
      tip: "round",
    },
  },
  {
    name: "Pencil · square",
    settings: { size: 4, hardness: 1, opacity: 1, flow: 1, color: "#172420", tip: "square" },
  },
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
  if (s.dynamics !== undefined) {
    try {
      validateDynamics(s.dynamics as NonNullable<Stroke["dynamics"]>);
    } catch {
      return false;
    }
  }
  return (
    typeof s.size === "number" &&
    Number.isFinite(s.size) &&
    s.size >= 1 &&
    s.size <= 1000 &&
    typeof s.hardness === "number" &&
    s.hardness >= 0 &&
    s.hardness <= 1 &&
    typeof s.opacity === "number" &&
    s.opacity >= 0 &&
    s.opacity <= 1 &&
    typeof s.flow === "number" &&
    s.flow >= 0.01 &&
    s.flow <= 1 &&
    typeof s.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(s.color) &&
    (s.tip === undefined || s.tip === "round" || s.tip === "square") &&
    (s.sizePressure === undefined || typeof s.sizePressure === "boolean") &&
    (s.smoothing === undefined ||
      (typeof s.smoothing === "number" &&
        Number.isFinite(s.smoothing) &&
        s.smoothing >= 0 &&
        s.smoothing <= 0.95))
  );
};

export function validateBrushPreset(value: unknown): value is BrushPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Record<string, unknown>;
  return (
    typeof preset.name === "string" &&
    preset.name.trim().length > 0 &&
    preset.name.length <= 40 &&
    (preset.tool === undefined || ["brush", "pencil", "eraser"].includes(preset.tool as string)) &&
    validSettings(preset.settings)
  );
}

export function loadBrushPresets(storage: Pick<Storage, "getItem"> | undefined): BrushPreset[] {
  if (!storage) return DEFAULT_BRUSH_PRESETS.map((p) => ({ ...p, settings: { ...p.settings } }));
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(value) && value.length <= 24 && value.every(validateBrushPreset))
      return value;
  } catch {
    // Corrupt or unavailable browser preferences fall back to the built-in presets.
  }
  return DEFAULT_BRUSH_PRESETS.map((p) => ({ ...p, settings: { ...p.settings } }));
}

export function saveBrushPresets(
  storage: Pick<Storage, "setItem"> | undefined,
  presets: BrushPreset[],
) {
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
  const next = presets.filter((p) => p.name !== preset.name.trim());
  if (next.length >= 24) throw new Error("A maximum of 24 brush presets can be saved.");
  return [
    ...next,
    {
      name: preset.name.trim(),
      settings: { ...preset.settings },
      ...(preset.tool ? { tool: preset.tool } : {}),
    },
  ];
}

const fixed = {
  roundness: 1,
  angle: 0,
  scatter: 0,
  sizeJitter: 0,
  opacityJitter: 0,
  velocity: 0,
  followDirection: false,
};
/** R3 manga/manhwa inking and eraser recipes. Existing stroke fields only, so
 * strokes painted with them open identically in earlier releases. */
const INKING_PRESETS: BrushPreset[] = [
  {
    // Strong taper: tiny at light pressure, full width when pressed.
    name: "G-Pen",
    settings: {
      size: 14,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#172420",
      sizePressure: true,
      smoothing: 0.35,
      dynamics: { ...fixed, spacing: 0.06, opacityPressure: false, stabilization: 4 },
    },
  },
  {
    // Fine, even line weight; pressure deliberately ignored.
    name: "Mapping Pen",
    settings: {
      size: 3,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#172420",
      sizePressure: false,
      smoothing: 0.25,
      dynamics: { ...fixed, spacing: 0.08, opacityPressure: false },
    },
  },
  {
    name: "Soft Eraser",
    tool: "eraser",
    settings: {
      size: 64,
      hardness: 0.15,
      opacity: 1,
      flow: 0.35,
      color: "#172420",
      dynamics: { ...fixed, spacing: 0.08, opacityPressure: false },
    },
  },
];

/** Additional factory recipes use the same versioned dab renderer. The three
 * historical presets remain unchanged, including existing saved preferences. */
export const PROFESSIONAL_BRUSH_PRESETS: BrushPreset[] = [
  {
    name: "Pencil",
    tool: "pencil",
    settings: {
      size: 3,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#172420",
      tip: "square",
      dynamics: {
        spacing: 0.1,
        roundness: 1,
        angle: 0,
        scatter: 0,
        sizeJitter: 0,
        opacityJitter: 0,
        opacityPressure: false,
        velocity: 0,
        followDirection: false,
      },
    },
  },
  {
    name: "Soft Brush",
    settings: {
      size: 64,
      hardness: 0.1,
      opacity: 0.6,
      flow: 0.4,
      color: "#172420",
      dynamics: {
        spacing: 0.08,
        roundness: 1,
        angle: 0,
        scatter: 0,
        sizeJitter: 0,
        opacityJitter: 0,
        opacityPressure: false,
        velocity: 0,
        followDirection: false,
      },
    },
  },
  {
    name: "Eraser",
    tool: "eraser",
    settings: {
      size: 32,
      hardness: 0.8,
      opacity: 1,
      flow: 1,
      color: "#172420",
      dynamics: {
        spacing: 0.08,
        roundness: 1,
        angle: 0,
        scatter: 0,
        sizeJitter: 0,
        opacityJitter: 0,
        opacityPressure: false,
        velocity: 0,
        followDirection: false,
      },
    },
  },
  {
    name: "Ink Pen",
    settings: {
      size: 8,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#172420",
      sizePressure: true,
      smoothing: 0.3,
      dynamics: {
        spacing: 0.08,
        roundness: 0.6,
        angle: 35,
        scatter: 0,
        sizeJitter: 0,
        opacityJitter: 0,
        opacityPressure: false,
        velocity: 0,
        followDirection: false,
      },
    },
  },
  {
    name: "Hard Round Brush",
    settings: {
      size: 24,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#172420",
      dynamics: {
        spacing: 0.1,
        roundness: 1,
        angle: 0,
        scatter: 0,
        sizeJitter: 0,
        opacityJitter: 0,
        opacityPressure: false,
        velocity: 0,
        followDirection: false,
      },
    },
  },
  {
    name: "Airbrush",
    settings: {
      size: 80,
      hardness: 0,
      opacity: 0.7,
      flow: 0.06,
      color: "#172420",
      dynamics: {
        spacing: 0.05,
        roundness: 1,
        angle: 0,
        scatter: 0,
        sizeJitter: 0,
        opacityJitter: 0,
        opacityPressure: true,
        velocity: 0,
        followDirection: false,
      },
    },
  },
  {
    name: "Line Art Brush",
    settings: {
      size: 5,
      hardness: 1,
      opacity: 1,
      flow: 1,
      color: "#172420",
      sizePressure: true,
      smoothing: 0.5,
      dynamics: {
        spacing: 0.07,
        roundness: 1,
        angle: 0,
        scatter: 0,
        sizeJitter: 0,
        opacityJitter: 0,
        opacityPressure: false,
        velocity: 0.2,
        followDirection: false,
      },
    },
  },
  {
    name: "Texture Brush",
    settings: {
      size: 24,
      hardness: 0.8,
      opacity: 0.7,
      flow: 0.5,
      color: "#172420",
      dynamics: {
        spacing: 0.2,
        roundness: 0.5,
        angle: 25,
        scatter: 0.8,
        sizeJitter: 0.6,
        opacityJitter: 0.4,
        opacityPressure: false,
        velocity: 0,
        followDirection: true,
      },
    },
  },
  ...INKING_PRESETS,
];

export const isFactoryPreset = (name: string) =>
  DEFAULT_BRUSH_PRESETS.some((p) => p.name === name) ||
  PROFESSIONAL_BRUSH_PRESETS.some((p) => p.name === name);
/** Custom presets and saved overrides of factory names can be deleted; the three
 * historical defaults stay, and deleting an override reveals the factory recipe. */
export const canDeleteBrushPreset = (stored: BrushPreset[], name: string) =>
  !DEFAULT_BRUSH_PRESETS.some((p) => p.name === name) && stored.some((p) => p.name === name);
export function duplicateBrushPreset(stored: BrushPreset[], name: string) {
  const original = availableBrushPresets(stored).find((p) => p.name === name);
  if (!original) throw Error("Choose a preset to duplicate.");
  const taken = new Set(availableBrushPresets(stored).map((p) => p.name)),
    base = `${name.slice(0, 33)} copy`;
  let next = base;
  for (let n = 2; taken.has(next); n++) next = `${base} ${n}`;
  return upsertBrushPreset(stored, { ...structuredClone(original), name: next });
}
export const resetBrushPresets = () =>
  DEFAULT_BRUSH_PRESETS.map((p) => ({ ...p, settings: { ...p.settings } }));

/** Pen pressure response is a property of the user's pen and hand, not the document. */
const PRESSURE_KEY = "inkstrip-pro-pen-pressure-v1";
export function loadPressureGamma(storage: Pick<Storage, "getItem"> | undefined) {
  try {
    const value: unknown = JSON.parse(storage?.getItem(PRESSURE_KEY) ?? "null");
    const gamma = (value as { gamma?: unknown } | null)?.gamma;
    if (typeof gamma === "number" && Number.isFinite(gamma) && gamma >= 0.25 && gamma <= 4)
      return gamma;
  } catch {
    // Corrupt preference: use the linear response.
  }
  return 1;
}
export function savePressureGamma(storage: Pick<Storage, "setItem"> | undefined, gamma: number) {
  if (!storage || !Number.isFinite(gamma) || gamma < 0.25 || gamma > 4) return false;
  try {
    storage.setItem(PRESSURE_KEY, JSON.stringify({ gamma }));
    return true;
  } catch {
    return false;
  }
}

export function renameBrushPreset(presets: BrushPreset[], name: string, nextName: string) {
  const preset = presets.find((p) => p.name === name);
  if (!preset || DEFAULT_BRUSH_PRESETS.some((p) => p.name === name))
    throw Error("Choose a custom preset to rename.");
  if (presets.some((p) => p.name === nextName.trim()))
    throw Error("A preset with that name already exists.");
  return upsertBrushPreset(
    presets.filter((p) => p.name !== name),
    { ...preset, name: nextName },
  );
}

/** Saved recipes can override a factory name without duplicate options/React keys.
 * Deleting the custom override reveals the factory recipe again. */
export function availableBrushPresets(stored: BrushPreset[]) {
  const names = new Set(stored.map((p) => p.name));
  return [...PROFESSIONAL_BRUSH_PRESETS.filter((p) => !names.has(p.name)), ...stored];
}
