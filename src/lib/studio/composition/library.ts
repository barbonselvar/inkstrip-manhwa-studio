import type { CommonObject, Fx, Sfx } from "./model.ts";
export const SFX_CATEGORIES: Record<string, string[]> = {
  "Sword & Combat": [
    "SWISH",
    "WHOOSH",
    "SLASH",
    "CLANG",
    "CLASH",
    "SHING",
    "THUD",
    "CRACK",
    "BOOM",
  ],
  Movement: ["STEP", "TAP", "RUSTLE", "DASH", "SWOOSH"],
  "Impact & Destruction": ["BANG", "CRASH", "SMASH", "RUMBLE", "EXPLOSION", "SHATTER"],
  Atmosphere: ["DRIP", "HOWL", "WHISPER", "WIND", "CREAK", "HISS"],
  "Supernatural & Murim": ["ENERGY SURGE", "QI BURST", "AURA", "SHOCKWAVE", "SPIRITUAL PRESSURE"],
};
export const SFX_STYLES = [
  "Sharp Slash",
  "White Impact",
  "Black Impact",
  "Heavy Explosion",
  "Brush Stroke",
  "Speed Motion",
  "Energy Burst",
  "Metallic",
  "Horror",
  "Whisper",
  "Glowing Aura",
  "Hand-drawn",
  "Jagged Comic",
  "Distorted Lettering",
] as const;
export const FX_CATEGORIES: Record<string, string[]> = {
  Motion: [
    "Motion Blur",
    "Directional Blur",
    "Radial Blur",
    "Speed Lines",
    "Radial Burst",
    "Zoom Burst",
    "Action Streaks",
  ],
  Combat: [
    "Sword Trail",
    "Slash Trail",
    "Impact Flash",
    "Shockwave",
    "Sparks",
    "Energy Arc",
    "Impact Lines",
  ],
  Atmosphere: [
    "Mist",
    "Fog",
    "Rain",
    "Snow",
    "Dust",
    "Smoke",
    "Falling Leaves",
    "Floating Particles",
  ],
  Lighting: [
    "Glow",
    "Bloom",
    "Light Rays",
    "Vignette",
    "Lens Flare",
    "Moonlight Glow",
    "Color Overlay",
  ],
  "Dramatic Webtoon": [
    "Screen Shake Appearance",
    "Horror Shadow",
    "Dark Aura",
    "Red Aura",
    "Memory Haze",
    "Flashback Overlay",
    "Dream Sequence",
    "Time Regression Visual",
    "Dramatic Blackout",
  ],
};
export const effectDescription = (name: string) =>
  /Blur/.test(name)
    ? "Static sampled motion overlay; angle and radius control its trail."
    : /Fog|Mist|Smoke|Haze/.test(name)
      ? "Layered atmospheric haze with adjustable density and softness."
      : /Rain|Snow|Dust|Leaves|Particles|Sparks/.test(name)
        ? "Seeded particles; the same arrangement is retained in every export."
        : /Aura|Glow|Bloom|Flash|Light|Flare/.test(name)
          ? "Soft luminous accents with editable color and intensity."
          : "Editable static composition overlay with deterministic geometry.";
export function common(name: string, width = 400, height = 240): CommonObject {
  return {
    id: crypto.randomUUID(),
    name,
    x: 60,
    y: 60,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skew: 0,
    opacity: 1,
    blend: "source-over",
    visible: true,
    locked: false,
    clip: false,
  };
}
export function sfx(text = "SWISH", style: string = "Sharp Slash"): Sfx {
  const dark = /Black|Heavy|Horror|Brush|Hand/.test(style),
    gentle = style === "Whisper";
  const scriptFont = /[\uac00-\ud7af]/u.test(text)
    ? '"Noto Sans KR", sans-serif'
    : /[\u3040-\u30ff]/u.test(text)
      ? '"Noto Sans JP", sans-serif'
      : /[\u0600-\u06ff]/u.test(text)
        ? '"Noto Sans Arabic", sans-serif'
        : undefined;
  return {
    ...common(style),
    kind: "sfx",
    text,
    font: scriptFont ?? (gentle ? '"Noto Sans", sans-serif' : 'Bangers, "Noto Sans", sans-serif'),
    size: gentle ? 48 : 110,
    weight: gentle ? 400 : 900,
    italic: /Slash|Speed/.test(style),
    direction: /^[^\p{L}]*[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text) ? "rtl" : "ltr",
    spacing: 0,
    lineHeight: 1.2,
    fill: dark ? "#111111" : style === "Energy Burst" ? "#b9eaff" : "#ffffff",
    fill2: style === "Metallic" ? "#555b69" : "#82ecd1",
    gradient: /Metallic|Energy|Aura/.test(style),
    strokes: gentle
      ? []
      : [
          { color: dark ? "#ffffff" : "#111111", width: 8 },
          { color: dark ? "#111111" : "#ffffff", width: 3 },
        ],
    shadow: style === "Heavy Explosion" ? 18 : style === "Speed Motion" ? 10 : 4,
    glow: /Aura|Energy/.test(style) ? 24 : 0,
    texture: style === "Brush Stroke" ? 0.6 : /Hand|Horror/.test(style) ? 0.3 : 0,
    skew: /Slash|Speed/.test(style) ? -18 : style === "Brush Stroke" ? 8 : 0,
    rotation: style === "Hand-drawn" ? -3 : 0,
  };
}
export function fx(effect = "Speed Lines", width = 800, height = 500): Fx {
  return {
    ...common(effect, width, height),
    x: 0,
    y: 0,
    kind: "fx",
    effect,
    color: /Red/.test(effect)
      ? "#b91535"
      : /Dark|Horror|Blackout|Vignette/.test(effect)
        ? "#050711"
        : effect === "Moonlight Glow"
          ? "#94b9ff"
          : "#ffffff",
    color2: "#97e4d4",
    amount: effect === "Dramatic Blackout" ? 1 : 0.65,
    density: 60,
    seed: Math.floor(Math.random() * 0xffffffff),
    angle: 25,
    radius: 18,
  };
}
export const unavailableStyle = (style: string) =>
  style === "Distorted Lettering" || style === "Jagged Comic"
    ? "Glyph-outline distortion is not available. Use the verified affine lettering controls."
    : null;
