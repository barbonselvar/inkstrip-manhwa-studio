import { validateNativeTree } from "./adjustment-schema.ts";
import { validateEffects, advancedEffect } from "./effects.ts";
import { validateGradient, advancedGradient } from "./gradient.ts";
import { validateSmartFilters } from "./smart-filters.ts";
import type { R8Settings } from "./r8-document.ts";
export type R8Preset = { version: 1; name: string; settings: R8Settings };
export function validateR8Settings(s: R8Settings) {
  validateNativeTree(s);
  if (
    !s ||
    typeof s !== "object" ||
    Array.isArray(s) ||
    Object.keys(s).some((k) => !["effects", "smartFilters", "gradient", "light"].includes(k))
  )
    throw Error("Invalid layer-property settings.");
  if (s.effects !== undefined) validateEffects(s.effects);
  if (s.smartFilters !== undefined) validateSmartFilters(s.smartFilters);
  if (s.gradient !== undefined) validateGradient(s.gradient);
  if (
    s.light !== undefined &&
    (typeof s.light !== "number" || !Number.isFinite(s.light) || s.light < -360 || s.light > 360)
  )
    throw Error("Invalid shared style light.");
}
export function validateR8Presets(p: R8Preset[]) {
  if (!Array.isArray(p) || p.length > 20) throw Error("Save at most20 layer-property presets.");
  const names = new Set<string>();
  for (const v of p) {
    if (
      !v ||
      v.version !== 1 ||
      Object.keys(v).some((k) => !["version", "name", "settings"].includes(k)) ||
      typeof v.name !== "string" ||
      !v.name.trim() ||
      v.name.length > 80 ||
      [...v.name].some((c) => c.charCodeAt(0) < 32) ||
      names.has(v.name)
    )
      throw Error("Invalid layer-property preset.");
    names.add(v.name);
    validateR8Settings(v.settings);
  }
}
export function readR8Presets(raw: string | null): R8Preset[] {
  if (!raw) return [];
  if (raw.length > 1_000_000) throw Error("Stored presets exceed their metadata budget.");
  const p = JSON.parse(raw);
  validateR8Presets(p);
  return p;
}
export function factoryR8Presets(): R8Preset[] {
  const shadow = advancedEffect("dropShadow");
  shadow.opacity = 0.35;
  shadow.radius = 5;
  shadow.distance = 4;
  const stroke = advancedEffect("stroke");
  stroke.size = 2;
  stroke.color = "#101815";
  return [
    { version: 1, name: "Soft Shadow", settings: { effects: [shadow] } },
    { version: 1, name: "Manga Outline", settings: { effects: [stroke] } },
    { version: 1, name: "Satin Relief", settings: { effects: [advancedEffect("bevel")] } },
    {
      version: 1,
      name: "Mint Gradient",
      settings: {
        gradient: {
          ...advancedGradient(),
          stops: [
            { position: 0, color: "#182b25", opacity: 1 },
            { position: 1, color: "#a6edda", opacity: 1 },
          ],
        },
      },
    },
  ];
}
