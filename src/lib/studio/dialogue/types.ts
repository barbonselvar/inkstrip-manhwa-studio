import { validateEffects } from "../pro/effects.ts";
import { isBlendMode } from "../pro/blend.ts";
import type { Layer, Contour } from "../pro/model.ts";
/** Additive shared Pro-document metadata. It contains no executable content or remote URLs. */
export const BUBBLE_PRESETS = [
  "speech",
  "thought",
  "whisper",
  "shout",
  "scream",
  "oval",
  "circle",
  "rectangle",
  "rounded",
  "square",
  "cloud",
  "jagged",
  "burst",
  "narration",
  "caption",
  "custom",
] as const;
export type BubblePreset = (typeof BUBBLE_PRESETS)[number];
export type BubbleTail = {
  id: string;
  attachment: number;
  width: number;
  tip: { x: number; y: number };
  curvature: number;
  kind: "point" | "dots";
};
export type BubbleSpec = {
  version: 1;
  preset: BubblePreset;
  tails: BubbleTail[];
  padding: number;
  textId?: string;
};
export type Lettering = {
  version: 1;
  language: "en" | "ar" | "ko" | "ja";
  direction: "ltr" | "rtl";
  writing: "horizontal" | "vertical";
  font: string;
  italic: boolean;
  paragraphSpacing: number;
  wrap: boolean;
  fit: boolean;
  padding: number;
  outlineFirst: boolean;
};
export type DialogueRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceLanguage: "en" | "ar" | "ko" | "ja";
  targetLanguage: "en" | "ar" | "ko" | "ja";
  original: string;
  corrected: string;
  replacement: string;
  confidence?: number;
  status: "detected" | "corrected" | "cleaned" | "lettered" | "approved";
  layerId?: string;
  cleanupLayerId?: string;
};
export const BODY_STYLE_KEYS = [
  "opacity",
  "blend",
  "fillOpacity",
  "strokeOpacity",
  "dash",
  "dashOffset",
  "fillRule",
  "lineCap",
  "lineJoin",
  "miterLimit",
  "effects",
] as const;
export const TEXT_STYLE_KEYS = [
  "opacity",
  "blend",
  "fillOpacity",
  "strokeOpacity",
  "stroke",
  "strokeWidth",
  "fontWeight",
  "align",
  "lineHeight",
  "letterSpacing",
  "effects",
] as const;
export type DialogueBodyStyle = Partial<Pick<Layer, (typeof BODY_STYLE_KEYS)[number]>>;
export type DialogueTextStyle = Partial<Pick<Layer, (typeof TEXT_STYLE_KEYS)[number]>>;
export function presetStyles(body: Layer, text: Layer) {
  if (body.appearance || text.appearance)
    throw Error(
      "Custom presets support basic fills/strokes and layer effects. Keep advanced appearance stacks in the native document; no preset was saved.",
    );
  return {
    bodyStyle: structuredClone(
      Object.fromEntries(
        BODY_STYLE_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
      ),
    ) as DialogueBodyStyle,
    textStyle: structuredClone(
      Object.fromEntries(
        TEXT_STYLE_KEYS.filter((k) => text[k] !== undefined).map((k) => [k, text[k]]),
      ),
    ) as DialogueTextStyle,
  };
}
export type DialoguePreset = {
  bodyStyle?: DialogueBodyStyle;
  textStyle?: DialogueTextStyle;
  width?: number;
  height?: number;
  contours?: Contour[];
  id: string;
  name: string;
  bubble: BubbleSpec;
  fill: string;
  stroke: string;
  strokeWidth: number;
  textColor: string;
  fontSize: number;
  lettering: Lettering;
};
export type DialogueData = { version: 1; regions: DialogueRegion[]; presets: DialoguePreset[] };
export const DEFAULT_LETTERING: Lettering = {
  version: 1,
  language: "en",
  direction: "ltr",
  writing: "horizontal",
  font: "Arial",
  italic: false,
  paragraphSpacing: 0,
  wrap: true,
  fit: true,
  padding: 8,
  outlineFirst: true,
};
/** Compatible defaults for old Vector text; opting into a new property must not
 * silently replace its face, introduce wrapping or shrink its existing text. */
export function letteringSettings(l: Pick<Layer, "lettering" | "fontFamily">): Lettering {
  return (
    l.lettering ?? {
      ...DEFAULT_LETTERING,
      font: l.fontFamily,
      wrap: false,
      fit: false,
      padding: 0,
      outlineFirst: false,
    }
  );
}
const number = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.length <= max &&
  [...v].every((c) => {
    const n = c.charCodeAt(0);
    return n >= 32 || n === 9 || n === 10 || n === 13;
  });
export function validateLettering(value: Lettering) {
  if (
    !value ||
    value.version !== 1 ||
    !["en", "ar", "ko", "ja"].includes(value.language) ||
    !["ltr", "rtl"].includes(value.direction) ||
    !["horizontal", "vertical"].includes(value.writing) ||
    !text(value.font, 100) ||
    !/^[\p{L}\p{N} _,'"-]+$/u.test(value.font) ||
    ["italic", "wrap", "fit", "outlineFirst"].some(
      (k) => typeof value[k as keyof Lettering] !== "boolean",
    ) ||
    !number(value.paragraphSpacing, 0, 1000) ||
    !number(value.padding, 0, 1000)
  )
    throw Error("Invalid dialogue typography; nothing was changed.");
  if (value.writing === "vertical" && value.language !== "ja")
    throw Error(
      "Vertical lettering currently supports Japanese only. Use horizontal text for this language.",
    );
}
export function validateBubble(value: BubbleSpec) {
  if (
    !value ||
    value.version !== 1 ||
    !BUBBLE_PRESETS.includes(value.preset) ||
    !number(value.padding, 0, 1000) ||
    !Array.isArray(value.tails) ||
    value.tails.length > 8 ||
    (value.textId !== undefined && !text(value.textId, 100))
  )
    throw Error("Invalid bubble geometry.");
  const ids = new Set<string>();
  for (const tail of value.tails) {
    if (
      !tail ||
      !text(tail.id, 100) ||
      !tail.id ||
      ids.has(tail.id) ||
      !number(tail.attachment, 0, 1) ||
      !number(tail.width, 1, 10000) ||
      !tail.tip ||
      !number(tail.tip.x, -100000, 100000) ||
      !number(tail.tip.y, -100000, 100000) ||
      !number(tail.curvature, -1, 1) ||
      !["point", "dots"].includes(tail.kind)
    )
      throw Error("Invalid or duplicate bubble tail.");
    ids.add(tail.id);
  }
}
function validateStyle(
  style: DialogueBodyStyle | DialogueTextStyle | undefined,
  kind: "body" | "text",
) {
  if (style === undefined) return;
  const keys = kind === "body" ? BODY_STYLE_KEYS : TEXT_STYLE_KEYS;
  if (
    !style ||
    typeof style !== "object" ||
    Array.isArray(style) ||
    Object.keys(style).some((k) => !(keys as readonly string[]).includes(k))
  )
    throw Error("Invalid preset style fields.");
  const values = style as Record<string, unknown>;
  for (const key of ["opacity", "fillOpacity", "strokeOpacity"])
    if (values[key] !== undefined && !number(values[key], 0, 1))
      throw Error("Invalid preset opacity.");
  for (const [key, min, max] of [
    ["dashOffset", -100000, 100000],
    ["miterLimit", 1, 1000],
    ["strokeWidth", 0, 100],
    ["fontWeight", 100, 900],
    ["lineHeight", 0.5, 3],
    ["letterSpacing", -20, 100],
  ] as const)
    if (values[key] !== undefined && !number(values[key], min, max))
      throw Error("Invalid preset numeric style.");
  if (values.blend !== undefined && !isBlendMode(values.blend))
    throw Error("Invalid preset blending.");
  for (const [key, valid] of [
    ["fillRule", ["evenodd", "nonzero"]],
    ["lineCap", ["butt", "round", "square"]],
    ["lineJoin", ["miter", "round", "bevel"]],
    ["align", ["left", "center", "right"]],
  ] as const)
    if (values[key] !== undefined && !(valid as readonly unknown[]).includes(values[key]))
      throw Error("Invalid preset style choice.");
  if (
    values.stroke !== undefined &&
    !(typeof values.stroke === "string" && /^(?:#[0-9a-f]{6}|transparent)$/i.test(values.stroke))
  )
    throw Error("Invalid preset text outline.");
  if (
    values.dash !== undefined &&
    (!Array.isArray(values.dash) ||
      values.dash.length > 32 ||
      !values.dash.every((v) => number(v, 0, 100000)))
  )
    throw Error("Invalid preset dash array.");
  if (style.effects !== undefined) validateEffects(style.effects);
}
export function validateDialogue(value: DialogueData) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.regions) ||
    value.regions.length > 200 ||
    !Array.isArray(value.presets) ||
    value.presets.length > 100
  )
    throw Error("Invalid or oversized dialogue metadata.");
  const ids = new Set<string>();
  for (const region of value.regions) {
    if (
      !region ||
      !text(region.id, 100) ||
      !region.id ||
      ids.has(region.id) ||
      !number(region.x, -100000, 100000) ||
      !number(region.y, -100000, 100000) ||
      !number(region.width, 1, 16384) ||
      !number(region.height, 1, 16384) ||
      !["en", "ar", "ko", "ja"].includes(region.sourceLanguage) ||
      !["en", "ar", "ko", "ja"].includes(region.targetLanguage) ||
      ![region.original, region.corrected, region.replacement].every((v) => text(v, 10000)) ||
      !["detected", "corrected", "cleaned", "lettered", "approved"].includes(region.status) ||
      (region.confidence !== undefined && !number(region.confidence, 0, 100)) ||
      [region.layerId, region.cleanupLayerId].some((v) => v !== undefined && !text(v, 100))
    )
      throw Error("Invalid OCR review region.");
    ids.add(region.id);
  }
  ids.clear();
  for (const preset of value.presets) {
    if (
      !preset ||
      !text(preset.id, 100) ||
      !preset.id ||
      ids.has(preset.id) ||
      !text(preset.name, 100) ||
      !preset.name.trim() ||
      !number(preset.fontSize, 1, 1000) ||
      !number(preset.strokeWidth, 0, 100) ||
      ![preset.fill, preset.stroke, preset.textColor].every(
        (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v),
      )
    )
      throw Error("Invalid dialogue preset.");
    if (
      (preset.width !== undefined && !number(preset.width, 1, 16384)) ||
      (preset.height !== undefined && !number(preset.height, 1, 16384))
    )
      throw Error("Invalid preset dimensions.");
    if (preset.contours !== undefined) {
      let count = 0;
      if (
        !Array.isArray(preset.contours) ||
        preset.contours.length > 32 ||
        !preset.width ||
        !preset.height
      )
        throw Error("Invalid custom preset contours.");
      for (const contour of preset.contours) {
        if (!contour || typeof contour.closed !== "boolean" || !Array.isArray(contour.anchors))
          throw Error("Invalid preset contour.");
        for (const anchor of contour.anchors)
          if (
            ++count > 1000 ||
            [anchor, anchor.incoming, anchor.outgoing].some(
              (p) => p && (!number(p.x, -100000, 100000) || !number(p.y, -100000, 100000)),
            )
          )
            throw Error("Invalid or oversized custom preset path.");
      }
    }
    validateStyle(preset.bodyStyle, "body");
    validateStyle(preset.textStyle, "text");
    validateBubble(preset.bubble);
    validateLettering(preset.lettering);
    ids.add(preset.id);
  }
}
