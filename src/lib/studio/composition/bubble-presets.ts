import { common } from "./library.ts";
import { layout, type CompositionDocument } from "./model.ts";
import { objectBounds } from "./geometry.ts";
import type { Panel } from "../types.ts";
import { fontForLanguage, type Bubble, type BubbleTail } from "./bubble.ts";

export const BUBBLE_CATEGORIES = ["Dialogue", "Emotion", "Narration", "Text"] as const;
type Preset = {
  name: string;
  category: (typeof BUBBLE_CATEGORIES)[number];
  description: string;
  value: Partial<Bubble>;
};
function tail(style: BubbleTail["style"], overrides: Partial<BubbleTail> = {}): BubbleTail {
  return {
    id: crypto.randomUUID(),
    attachment: 0.56,
    width: 56,
    tip: { x: 110, y: 300 },
    curvature: style === "Curved" ? 0.35 : 0,
    style,
    ...overrides,
  };
}
/** Original visual presets. Each is an ordinary editable bubble once inserted. */
export const BUBBLE_PRESETS: Preset[] = [
  {
    name: "Standard dialogue",
    category: "Dialogue",
    description: "Oval speech with a curved tail",
    value: { shape: "Oval", text: "We have to leave tonight." },
  },
  {
    name: "Thought",
    category: "Dialogue",
    description: "Cloud with trailing thought dots",
    value: {
      shape: "Cloud",
      spikes: 20,
      tails: [tail("Dots", { width: 48 })],
      text: "Did she notice…?",
    },
  },
  {
    name: "Shouting",
    category: "Emotion",
    description: "Burst outline, heavy stroke",
    value: {
      shape: "Burst",
      spikes: 18,
      strokeWidth: 6,
      font: "Bangers",
      weight: 400,
      size: 44,
      text: "GET DOWN!",
      tails: [tail("Straight", { width: 70 })],
    },
  },
  {
    name: "Whispering",
    category: "Dialogue",
    description: "Dashed outline, soft text",
    value: {
      shape: "Oval",
      dash: 10,
      strokeWidth: 2,
      stroke: "#555555",
      textColor: "#444444",
      italic: true,
      size: 26,
      text: "Stay quiet…",
    },
  },
  {
    name: "Narration",
    category: "Narration",
    description: "Square caption, no tail",
    value: {
      shape: "Rectangle",
      fill: "#fff8e8",
      strokeWidth: 2,
      tails: [],
      font: "Outfit",
      text: "Three years earlier.",
      height: 140,
    },
  },
  {
    name: "Internal monologue",
    category: "Narration",
    description: "Soft rounded box, italic voice",
    value: {
      shape: "Rounded",
      radius: 0.3,
      fill: "#e7f0ff",
      fillOpacity: 0.92,
      stroke: "#7d93c4",
      strokeWidth: 2,
      italic: true,
      tails: [],
      text: "I can't lose here.",
      height: 150,
    },
  },
  {
    name: "Telephone / electronic",
    category: "Dialogue",
    description: "Zigzag outline and lightning tail",
    value: {
      shape: "Electronic",
      spikes: 26,
      font: "monospace",
      tails: [tail("Zigzag", { width: 44 })],
      text: "Hello? Can you hear me?",
    },
  },
  {
    name: "Dramatic",
    category: "Emotion",
    description: "Black jagged bubble, white text",
    value: {
      shape: "Jagged",
      spikes: 16,
      fill: "#000000",
      stroke: "#ffffff",
      strokeWidth: 4,
      textColor: "#ffffff",
      weight: 800,
      text: "So that's the truth.",
      tails: [tail("Straight", { width: 60 })],
    },
  },
  {
    name: "Scream",
    category: "Emotion",
    description: "Deep spikes for screams",
    value: {
      shape: "Scream",
      spikes: 26,
      strokeWidth: 5,
      weight: 900,
      size: 46,
      text: "NOOO!",
      tails: [tail("Straight", { width: 64 })],
    },
  },
  {
    name: "Hand-drawn",
    category: "Dialogue",
    description: "Irregular, inked outline",
    value: { shape: "Wobbly", roughness: 0.55, strokeWidth: 3.5, text: "Wait, really?" },
  },
  {
    name: "Dark caption",
    category: "Narration",
    description: "Black box with white text",
    value: {
      shape: "Rectangle",
      fill: "#111111",
      stroke: "#111111",
      strokeWidth: 0,
      textColor: "#ffffff",
      tails: [],
      text: "Meanwhile…",
      height: 120,
    },
  },
  {
    name: "Text on art",
    category: "Text",
    description: "No bubble, outlined lettering",
    value: {
      shape: "None",
      tails: [],
      fill: "transparent",
      strokeWidth: 0,
      textColor: "#ffffff",
      textStroke: "#000000",
      textStrokeWidth: 4,
      weight: 800,
      size: 40,
      text: "Somewhere in Seoul",
      height: 140,
    },
  },
  {
    name: "Korean dialogue",
    category: "Text",
    description: "Noto Sans KR, Hangul line breaking",
    value: { shape: "Oval", language: "ko", font: "Noto Sans KR", text: "지금 당장 떠나야 해." },
  },
  {
    name: "Japanese vertical",
    category: "Text",
    description: "Top-to-bottom, right-to-left columns",
    value: {
      shape: "Oval",
      language: "ja",
      font: "Noto Sans JP",
      writing: "vertical",
      width: 220,
      height: 380,
      size: 30,
      tails: [tail("Curved", { attachment: 0.52, tip: { x: 60, y: 470 } })],
      text: "今夜、ここを出よう。",
    },
  },
  {
    name: "Arabic dialogue",
    category: "Text",
    description: "Right-to-left, joined shaping",
    value: {
      shape: "Oval",
      language: "ar",
      direction: "rtl",
      font: "Noto Sans Arabic",
      text: "يجب أن نغادر الليلة.",
    },
  },
];

export function bubble(preset: Preset | string = "Standard dialogue", width = 360, height = 220) {
  const p = typeof preset === "string" ? BUBBLE_PRESETS.find((x) => x.name === preset)! : preset;
  const w = p.value.width ?? width,
    h = p.value.height ?? height,
    language = p.value.language ?? "en";
  const b: Bubble = {
    ...common(p.name, w, h),
    kind: "bubble",
    preset: p.name,
    shape: "Oval",
    seed: Math.floor(Math.random() * 0xffffffff),
    roughness: 0,
    radius: 0.18,
    spikes: 20,
    tails: [tail("Curved", { tip: { x: w * 0.3, y: h + 90 } })],
    fill: "#ffffff",
    fillOpacity: 1,
    stroke: "#111111",
    strokeWidth: 3,
    dash: 0,
    shadowColor: "#000000",
    shadowBlur: 0,
    shadowX: 0,
    shadowY: 0,
    padding: 14,
    text: "Text",
    font: fontForLanguage(language),
    size: 30,
    weight: 600,
    italic: false,
    textColor: "#111111",
    align: "center",
    letterSpacing: 0,
    lineHeight: 1.2,
    language,
    direction: "ltr",
    writing: "horizontal",
    fit: true,
    textStroke: "#ffffff",
    textStrokeWidth: 0,
    textShadow: 0,
    ...structuredClone(p.value),
    width: w,
    height: h,
  } as Bubble;
  // Re-key tails so two inserts of one preset never share tail identities.
  b.tails = b.tails.map((t) => ({ ...t, id: crypto.randomUUID() }));
  return b;
}
/** Text-only style fields that a saved "text style" transfers between bubbles. */
export const TEXT_STYLE_KEYS = [
  "font",
  "size",
  "weight",
  "italic",
  "textColor",
  "align",
  "letterSpacing",
  "lineHeight",
  "language",
  "direction",
  "writing",
  "fit",
  "textStroke",
  "textStrokeWidth",
  "textShadow",
] as const;
export const BUBBLE_STYLE_KEYS = [
  "shape",
  "roughness",
  "radius",
  "spikes",
  "fill",
  "fillOpacity",
  "stroke",
  "strokeWidth",
  "dash",
  "shadowColor",
  "shadowBlur",
  "shadowX",
  "shadowY",
  "padding",
] as const;
export function applyStyle(target: Bubble, source: Bubble, keys: readonly (keyof Bubble)[]) {
  const next = { ...target } as Record<string, unknown>;
  for (const k of keys) next[k] = structuredClone(source[k]);
  return next as Bubble;
}

/** Insert at a sensible spot: below the panel's last bubble, inside the image area. */
export function placeBubble(
  d: CompositionDocument,
  panels: Panel[],
  b: Bubble,
  owner: string | undefined,
): Bubble {
  const frames = layout(d, panels).frames,
    frame = frames.find((f) => f.panel.id === owner);
  if (!frame) return { ...b, owner: undefined, x: Math.round((d.width - b.width) / 2), y: 60 };
  const mine = d.objects
    .filter((o) => o.kind === "bubble" && o.owner === owner)
    .map((o) => objectBounds(o, frames, d.objects));
  const lastBottom = Math.max(frame.imageY + 40, ...mine.map((r) => r.y + r.height + 40));
  const y = Math.min(lastBottom, Math.max(frame.imageY, frame.bottomY - b.height - 40));
  return {
    ...b,
    owner,
    x: Math.round((d.width - b.width) / 2 + (mine.length % 2 ? d.width * 0.12 : -d.width * 0.12)),
    y: Math.round(y - frame.imageY),
  };
}
