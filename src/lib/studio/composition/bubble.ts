/**
 * Chapter-level speech bubbles and lettering for the shared composition scene.
 *
 * Geometry is computed in object-local pixels (0..width × 0..height) and then
 * placed by the ordinary composition affine transform, so Chapter mode, Focus
 * mode, the reader and segmented export all use one definition. Text stays
 * editable: it is laid out with the existing locale-aware Dialogue lettering
 * engine and painted as native shaped Canvas text at render time.
 */
import { layoutLettering, type LetteringLayout } from "../dialogue/lettering.ts";
import type { Layer } from "../pro/model.ts";
import { isBlendMode } from "../pro/blend.ts";
import type { CommonObject } from "./model.ts";
import { noise } from "./masks.ts";

export const BUBBLE_SHAPES = [
  "Oval",
  "Rounded",
  "Rectangle",
  "Cloud",
  "Burst",
  "Jagged",
  "Scream",
  "Wobbly",
  "Electronic",
  "None",
] as const;
export type BubbleShape = (typeof BUBBLE_SHAPES)[number];
export const TAIL_STYLES = ["Curved", "Straight", "Dots", "Zigzag"] as const;
export type TailStyle = (typeof TAIL_STYLES)[number];
export const BUBBLE_LANGUAGES = ["en", "ko", "ja", "zh", "ar", "other"] as const;
export type BubbleLanguage = (typeof BUBBLE_LANGUAGES)[number];

export type BubbleTail = {
  id: string;
  /** Position of the tail base along the outline perimeter, 0..1 clockwise from top center. */
  attachment: number;
  /** Base width in local pixels. */
  width: number;
  /** Tip in object-local pixels; may lie outside the bubble box. */
  tip: { x: number; y: number };
  curvature: number;
  style: TailStyle;
};

export type Bubble = CommonObject & {
  kind: "bubble";
  preset?: string;
  shape: BubbleShape;
  seed: number;
  /** 0 = clean outline, 1 = very irregular hand-drawn outline. */
  roughness: number;
  /** Rounded-rectangle corner radius as a fraction of the short side (0..0.5). */
  radius: number;
  /** Number of spikes/bumps for burst, jagged, scream, cloud and electronic shapes. */
  spikes: number;
  tails: BubbleTail[];
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  /** Dash length for whisper-style outlines; 0 is a solid line. */
  dash: number;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  padding: number;
  text: string;
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  textColor: string;
  align: "left" | "center" | "right";
  letterSpacing: number;
  lineHeight: number;
  language: BubbleLanguage;
  direction: "ltr" | "rtl";
  writing: "horizontal" | "vertical";
  fit: boolean;
  textStroke: string;
  textStrokeWidth: number;
  textShadow: number;
};

export type OutlinePoint = { x: number; y: number; sharp: boolean };

/** Offline, self-hosted (OFL) fonts plus generic families that every platform resolves. */
export const BUBBLE_FONTS = [
  { family: "Noto Sans", label: "Noto Sans", sample: "Hello there!" },
  { family: "Noto Sans KR", label: "Noto Sans KR · 한국어", sample: "안녕하세요!" },
  { family: "Noto Sans JP", label: "Noto Sans JP · 日本語", sample: "こんにちは！" },
  { family: "Noto Sans Arabic", label: "Noto Sans Arabic · العربية", sample: "مرحبا!" },
  { family: "Bangers", label: "Bangers · comic", sample: "WATCH OUT!" },
  { family: "Outfit", label: "Outfit · clean", sample: "Narration" },
  { family: "Fraunces", label: "Fraunces · serif", sample: "Long ago…" },
  { family: "serif", label: "System serif", sample: "Long ago…" },
  { family: "monospace", label: "System monospace", sample: "SYSTEM: online" },
] as const;

export const FONT_FALLBACK = `"Noto Sans KR", "Noto Sans JP", "Noto Sans Arabic", "Noto Sans", sans-serif`;
export function bubbleFont(b: Pick<Bubble, "font" | "weight" | "italic">, size: number) {
  const family = /^(serif|sans-serif|monospace|cursive|fantasy)$/.test(b.font)
    ? b.font
    : `"${b.font}"`;
  return `${b.italic ? "italic " : ""}${b.weight} ${size}px ${family}, ${FONT_FALLBACK}`;
}

const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u;
const STRONG = /[\p{L}]/u;
/** First-strong-character direction, as in the Unicode bidi paragraph rule P2/P3. */
export function detectDirection(text: string): "ltr" | "rtl" {
  for (const c of text) if (STRONG.test(c)) return RTL.test(c) ? "rtl" : "ltr";
  return "ltr";
}
export function detectLanguage(text: string): BubbleLanguage {
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u.test(text)) return "ko";
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\u4e00-\u9fff]/u.test(text)) return "zh";
  if (/[\u0600-\u06ff\u0750-\u077f]/u.test(text)) return "ar";
  if (/^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\s]*$/u.test(text)) return "en";
  return "other";
}
export function fontForLanguage(language: BubbleLanguage) {
  return language === "ko"
    ? "Noto Sans KR"
    : language === "ja" || language === "zh"
      ? "Noto Sans JP"
      : language === "ar"
        ? "Noto Sans Arabic"
        : "Noto Sans";
}

const SPIKY: BubbleShape[] = ["Burst", "Jagged", "Scream"];
const ROUNDISH: BubbleShape[] = ["Oval", "Cloud", "Wobbly", "Electronic", ...SPIKY];

function ellipsePoint(w: number, h: number, a: number, k = 1) {
  return { x: w / 2 + Math.sin(a) * (w / 2) * k, y: h / 2 - Math.cos(a) * (h / 2) * k };
}
/** Closed base outline, clockwise from the top center. */
export function baseOutline(b: Bubble): OutlinePoint[] {
  const w = b.width,
    h = b.height,
    short = Math.min(w, h),
    points: OutlinePoint[] = [];
  const jitter = (i: number, scale = 0.05) =>
    b.roughness ? (noise(i * 7.31, b.seed % 9973, b.seed) - 0.5) * 2 * b.roughness * scale : 0;
  const spikes = Math.max(6, Math.min(96, Math.round(b.spikes)));
  if (b.shape === "None") return [];
  if (b.shape === "Rectangle" || b.shape === "Rounded") {
    const r = b.shape === "Rounded" ? Math.min(0.5, Math.max(0, b.radius)) * short : 0;
    let i = 0;
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1,
        steps = Math.max(2, Math.min(12, Math.round(len / 40)));
      for (let s = 1; s < steps; s++) {
        const t = s / steps,
          off = jitter(i++, 0.04) * short;
        points.push({
          x: x0 + (x1 - x0) * t - ((y1 - y0) / len) * off,
          y: y0 + (y1 - y0) * t + ((x1 - x0) / len) * off,
          sharp: false,
        });
      }
    };
    const corner = (cx: number, cy: number, a0: number) => {
      if (r < 0.5) {
        points.push({ x: cx, y: cy, sharp: true });
        return;
      }
      for (let s = 0; s <= 8; s++) {
        const a = a0 + (s / 8) * (Math.PI / 2),
          k = 1 + jitter(i++, 0.3);
        points.push({ x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k, sharp: false });
      }
    };
    points.push({ x: w / 2, y: 0, sharp: false });
    edge(w / 2, 0, w - r, 0);
    corner(w - r, r, -Math.PI / 2);
    edge(w, r, w, h - r);
    corner(w - r, h - r, 0);
    edge(w - r, h, r, h);
    corner(r, h - r, Math.PI / 2);
    edge(0, h - r, 0, r);
    corner(r, r, Math.PI);
    edge(r, 0, w / 2, 0);
    return points;
  }
  if (b.shape === "Cloud") {
    const bumps = Math.max(6, Math.min(32, Math.round(spikes / 2))),
      per = 10;
    for (let i = 0; i < bumps * per; i++) {
      const a = (i / (bumps * per)) * Math.PI * 2,
        phase = (i % per) / per,
        k = 0.86 + 0.14 * Math.sin(phase * Math.PI) + jitter(i, 0.08);
      points.push({ ...ellipsePoint(w, h, a, k), sharp: i % per === 0 });
    }
    return points;
  }
  if (SPIKY.includes(b.shape)) {
    const n = b.shape === "Jagged" ? Math.max(8, Math.round(spikes * 0.75)) : spikes,
      inner = b.shape === "Scream" ? 0.62 : b.shape === "Jagged" ? 0.74 : 0.8;
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      let k = i % 2 ? inner : 1;
      if (b.shape === "Jagged") k *= 0.86 + 0.14 * noise(i, 3, b.seed);
      k += jitter(i, 0.12);
      points.push({ ...ellipsePoint(w, h, a, k), sharp: true });
    }
    return points;
  }
  if (b.shape === "Electronic") {
    const n = Math.max(12, spikes);
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      points.push({ ...ellipsePoint(w, h, a, (i % 2 ? 0.93 : 1) + jitter(i, 0.05)), sharp: true });
    }
    return points;
  }
  const n = 96,
    wobble = b.shape === "Wobbly" ? 0.05 + b.roughness * 0.07 : 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2,
      k =
        1 +
        (wobble
          ? wobble * (Math.sin(a * 3 + (b.seed % 7)) * 0.6 + Math.sin(a * 5 + (b.seed % 11)) * 0.4)
          : 0) +
        jitter(i, 0.03);
    points.push({ ...ellipsePoint(w, h, a, k), sharp: false });
  }
  return points;
}

function perimeter(points: OutlinePoint[]) {
  const lengths = [0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    lengths.push(lengths[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return lengths;
}
/** Point at a perimeter fraction plus the polyline segment it falls on. */
export function outlineAt(points: OutlinePoint[], t: number, lengths = perimeter(points)) {
  const total = lengths.at(-1)!,
    target = (((t % 1) + 1) % 1) * total;
  let i = 0;
  while (i < points.length - 1 && lengths[i + 1]! < target) i++;
  const a = points[i]!,
    b = points[(i + 1) % points.length]!,
    span = lengths[i + 1]! - lengths[i]! || 1,
    f = (target - lengths[i]!) / span;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, index: i };
}
/** Nearest perimeter fraction for a local point; used by the tail-base handle. */
export function nearestAttachment(b: Bubble, point: { x: number; y: number }) {
  const points = baseOutline(b);
  if (!points.length) return 0.5;
  const lengths = perimeter(points),
    total = lengths.at(-1)! || 1;
  let best = { d: Infinity, t: 0 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      c = points[(i + 1) % points.length]!,
      dx = c.x - a.x,
      dy = c.y - a.y,
      len2 = dx * dx + dy * dy || 1,
      f = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)),
      d = Math.hypot(a.x + dx * f - point.x, a.y + dy * f - point.y);
    if (d < best.d) best = { d, t: (lengths[i]! + f * Math.sqrt(len2)) / total };
  }
  return best.t;
}

export type BubbleGeometry = {
  outline: OutlinePoint[];
  dots: { x: number; y: number; r: number }[];
  /** Local inner rectangle available to text, before padding. */
  textBox: { x: number; y: number; width: number; height: number };
};
/** Outline with tails merged into it, so one stroke surrounds bubble and tail. */
export function bubbleGeometry(b: Bubble): BubbleGeometry {
  const base = baseOutline(b),
    dots: BubbleGeometry["dots"] = [];
  const inset = SPIKY.includes(b.shape) ? 0.2 : ROUNDISH.includes(b.shape) ? 0.15 : 0;
  const textBox = {
    x: b.width * inset,
    y: b.height * inset,
    width: b.width * (1 - inset * 2),
    height: b.height * (1 - inset * 2),
  };
  if (!base.length) return { outline: base, dots, textBox };
  const lengths = perimeter(base),
    total = lengths.at(-1)! || 1;
  const spans = b.tails
    .map((tail) => {
      const half = Math.min(0.2, Math.max(0.002, tail.width / total)) / 2;
      return { tail, start: tail.attachment - half, end: tail.attachment + half };
    })
    .sort((x, y) => x.start - y.start);
  // Overlapping tails are skipped instead of breaking the whole bubble.
  const accepted: typeof spans = [];
  for (const s of spans) {
    const last = accepted.at(-1);
    if (last && s.start < last.end) continue;
    if (accepted.length && s.end - 1 > accepted[0]!.start) continue;
    accepted.push(s);
  }
  const positionOf = (p: number) => (((p % 1) + 1) % 1) * total;
  type Insert = { at: number; until: number; points: OutlinePoint[] };
  const inserts: Insert[] = [];
  for (const { tail, start, end } of accepted) {
    const a = outlineAt(base, start, lengths),
      c = outlineAt(base, end, lengths),
      mid = outlineAt(base, tail.attachment, lengths),
      tip = tail.tip;
    if (tail.style === "Dots") {
      const r0 = Math.max(2, tail.width / 3);
      for (const [f, k] of [
        [0.3, 1],
        [0.62, 0.7],
        [0.92, 0.45],
      ] as const)
        dots.push({ x: mid.x + (tip.x - mid.x) * f, y: mid.y + (tip.y - mid.y) * f, r: r0 * k });
      continue;
    }
    const pts: OutlinePoint[] = [{ x: a.x, y: a.y, sharp: true }];
    const dx = tip.x - mid.x,
      dy = tip.y - mid.y,
      len = Math.hypot(dx, dy) || 1;
    const bend = {
      x: (-dy / len) * tail.curvature * len * 0.35,
      y: (dx / len) * tail.curvature * len * 0.35,
    };
    const side = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      reverse: boolean,
    ) => {
      const out: OutlinePoint[] = [];
      const steps = tail.style === "Straight" ? 1 : tail.style === "Zigzag" ? 6 : 10;
      for (let s = 1; s < steps; s++) {
        const t = s / steps,
          q = reverse ? 1 - t : t;
        let x = from.x + (to.x - from.x) * t,
          y = from.y + (to.y - from.y) * t;
        if (tail.style === "Curved") {
          const k = 4 * q * (1 - q);
          x += bend.x * k;
          y += bend.y * k;
        }
        if (tail.style === "Zigzag") {
          const sign = s % 2 ? 1 : -1,
            amp = Math.max(4, tail.width * 0.35) * (1 - q * 0.6);
          x += (-dy / len) * amp * sign;
          y += (dx / len) * amp * sign;
        }
        out.push({ x, y, sharp: tail.style !== "Curved" });
      }
      return out;
    };
    pts.push(...side(a, tip, false), { x: tip.x, y: tip.y, sharp: true });
    pts.push(...side(tip, c, true), { x: c.x, y: c.y, sharp: true });
    inserts.push({ at: positionOf(start), until: positionOf(end), points: pts });
  }
  if (!inserts.length) return { outline: base, dots, textBox };
  const outline: OutlinePoint[] = [];
  const inside = (pos: number) =>
    inserts.some((s) =>
      s.at <= s.until ? pos > s.at && pos < s.until : pos > s.at || pos < s.until,
    );
  const events = [
    ...base.map((p, i) => ({
      pos: lengths[i]!,
      point: p as OutlinePoint | null,
      insert: null as Insert | null,
    })),
    ...inserts.map((s) => ({ pos: s.at, point: null, insert: s })),
  ].sort((x, y) => x.pos - y.pos || (x.insert ? -1 : 1));
  for (const e of events) {
    if (e.insert) outline.push(...e.insert.points);
    else if (e.point && !inside(e.pos)) outline.push(e.point);
  }
  return { outline, dots, textBox };
}

/** Anything implementing the Canvas path subset; lets tests record path commands. */
export type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
  arc?(x: number, y: number, r: number, a0: number, a1: number): void;
};
const mid = (a: OutlinePoint, b: OutlinePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Smooth points become quadratic curves through edge midpoints; sharp points stay corners. */
export function traceOutline(sink: PathSink, points: OutlinePoint[]) {
  const n = points.length;
  if (n < 3) return;
  const start = Math.max(
    0,
    points.findIndex((p) => p.sharp),
  );
  const first = points[start]!;
  if (first.sharp) sink.moveTo(first.x, first.y);
  else {
    const m = mid(first, points[(start + 1) % n]!);
    sink.moveTo(m.x, m.y);
  }
  for (let k = 1; k <= n; k++) {
    const p = points[(start + k) % n]!;
    if (k === n && first.sharp) break;
    if (p.sharp) sink.lineTo(p.x, p.y);
    else {
      const next = points[(start + k + 1) % n]!,
        m = next.sharp ? next : mid(p, next);
      sink.quadraticCurveTo(p.x, p.y, m.x, m.y);
    }
  }
  sink.closePath();
}

/** Local extent beyond the 0..width/height box (tails, stroke and shadow halo). */
export function bubbleOverflow(b: Bubble) {
  let over = 0;
  for (const t of b.tails) {
    over = Math.max(over, -t.tip.x, -t.tip.y, t.tip.x - b.width, t.tip.y - b.height);
  }
  const roughness = b.roughness * Math.min(b.width, b.height) * 0.15;
  return (
    Math.max(0, over) +
    roughness +
    b.strokeWidth +
    Math.max(
      b.shadowBlur * 3 + Math.max(Math.abs(b.shadowX), Math.abs(b.shadowY)),
      b.textShadow * 3,
    ) +
    b.textStrokeWidth * 2
  );
}

function letteringLanguage(b: Bubble): "en" | "ar" | "ko" | "ja" {
  if (b.writing === "vertical") return "ja";
  return b.language === "zh" ? "ja" : b.language === "other" ? "en" : b.language;
}
/** Wrap/fit text inside the padded text box using the shared Dialogue layout engine. */
export function layoutBubbleText(
  b: Bubble,
  measure: (s: string, size: number) => number,
): LetteringLayout & { box: { x: number; y: number; width: number; height: number } } {
  const g = bubbleGeometry(b),
    pad = Math.min(b.padding, Math.max(0, Math.min(g.textBox.width, g.textBox.height) / 2 - 1));
  const box = {
    x: g.textBox.x + pad,
    y: g.textBox.y + pad,
    width: Math.max(1, g.textBox.width - pad * 2),
    height: Math.max(1, g.textBox.height - pad * 2),
  };
  const layer = {
    text: b.text,
    width: box.width,
    height: box.height,
    fontSize: b.size,
    fontWeight: b.weight,
    lineHeight: b.lineHeight,
    letterSpacing: b.letterSpacing,
    align: b.align,
    lettering: {
      version: 1,
      language: letteringLanguage(b),
      direction: b.direction,
      writing: b.writing,
      font: "Noto Sans",
      italic: b.italic,
      paragraphSpacing: 0,
      wrap: true,
      fit: b.fit,
      padding: 0,
      outlineFirst: true,
    },
  } as unknown as Layer;
  return { ...layoutLettering(layer, measure), box };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
function rgba(color: string, alpha: number) {
  if (color === "transparent") return "rgba(0,0,0,0)";
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return `rgba(${rgb.join(",")},${Math.max(0, Math.min(1, alpha))})`;
}
export function paintBubble(ctx: Ctx, b: Bubble) {
  const g = bubbleGeometry(b),
    m = ctx.getTransform(),
    filterScale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  const body = () => {
    ctx.beginPath();
    traceOutline(ctx, g.outline);
    for (const d of g.dots) {
      ctx.moveTo(d.x + d.r, d.y);
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    }
  };
  if (g.outline.length) {
    if (b.shadowBlur || b.shadowX || b.shadowY) {
      ctx.save();
      body();
      ctx.shadowColor = b.shadowColor === "transparent" ? "rgba(0,0,0,0)" : b.shadowColor;
      ctx.shadowBlur = b.shadowBlur * filterScale;
      ctx.shadowOffsetX = b.shadowX * m.a + b.shadowY * m.c;
      ctx.shadowOffsetY = b.shadowX * m.b + b.shadowY * m.d;
      ctx.fillStyle = rgba(
        b.fill === "transparent" ? "#000000" : b.fill,
        b.fill === "transparent" ? 0.001 : 1,
      );
      ctx.globalAlpha *= Math.max(0.35, b.fillOpacity);
      ctx.fill();
      ctx.restore();
    }
    body();
    ctx.fillStyle = rgba(b.fill, b.fillOpacity);
    ctx.fill();
    if (b.strokeWidth > 0 && b.stroke !== "transparent") {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.miterLimit = 4;
      ctx.lineWidth = b.strokeWidth;
      ctx.strokeStyle = b.stroke;
      if (b.dash > 0) ctx.setLineDash([b.dash, b.dash * 0.8]);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (!b.text.trim()) return;
  const cache = new Map<string, number>();
  const measure = (s: string, size: number) => {
    const key = `${size}\u0000${s}`;
    let v = cache.get(key);
    if (v === undefined) {
      ctx.font = bubbleFont(b, size);
      ctx.letterSpacing = "0px";
      v = ctx.measureText(s).width;
      cache.set(key, v);
    }
    return v;
  };
  const layout = layoutBubbleText(b, measure);
  ctx.save();
  ctx.font = bubbleFont(b, layout.fontSize);
  ctx.direction = b.direction;
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${b.letterSpacing}px`;
  ctx.lineJoin = "round";
  // Center the laid-out block in the text box.
  const offset =
    b.writing === "vertical"
      ? { x: -Math.max(0, (layout.box.width - layout.width) / 2), y: 0 }
      : { x: 0, y: Math.max(0, (layout.box.height - layout.height) / 2) };
  const runs = (paint: "fill" | "stroke") => {
    for (const run of layout.runs) {
      ctx.save();
      ctx.textAlign = run.align;
      ctx.translate(layout.box.x + run.x + offset.x, layout.box.y + run.y + offset.y);
      ctx.rotate(run.rotation);
      if (paint === "fill") ctx.fillText(run.text, 0, 0);
      else ctx.strokeText(run.text, 0, 0);
      ctx.restore();
    }
  };
  if (b.textShadow > 0) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = b.textShadow * filterScale;
    ctx.fillStyle = b.textColor;
    runs("fill");
    ctx.restore();
  }
  if (b.textStrokeWidth > 0 && b.textStroke !== "transparent") {
    ctx.strokeStyle = b.textStroke;
    ctx.lineWidth = b.textStrokeWidth * 2;
    runs("stroke");
  }
  ctx.fillStyle = b.textColor;
  runs("fill");
  ctx.restore();
}

/** Stable local points bounding the painted bubble (for stable segment rasterization). */
export function bubbleExtentPoints(b: Bubble) {
  const o = bubbleOverflow(b);
  return [
    { x: -o, y: -o },
    { x: b.width + o, y: -o },
    { x: -o, y: b.height + o },
    { x: b.width + o, y: b.height + o },
  ];
}

const color = (v: unknown) => typeof v === "string" && /^(#[0-9a-f]{6}|transparent)$/i.test(v);
const n = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function validateBubbleObject(o: Bubble) {
  const ok =
    BUBBLE_SHAPES.includes(o.shape) &&
    (o.preset === undefined || (typeof o.preset === "string" && o.preset.length <= 80)) &&
    n(o.seed, 0, 0xffffffff) &&
    n(o.roughness, 0, 1) &&
    n(o.radius, 0, 0.5) &&
    n(o.spikes, 4, 128) &&
    Array.isArray(o.tails) &&
    o.tails.length <= 8 &&
    new Set(o.tails.map((t) => t?.id)).size === o.tails.length &&
    o.tails.every(
      (t) =>
        t &&
        typeof t.id === "string" &&
        t.id.length > 0 &&
        t.id.length <= 128 &&
        n(t.attachment, 0, 1) &&
        n(t.width, 1, 10000) &&
        t.tip &&
        n(t.tip.x, -1e6, 1e6) &&
        n(t.tip.y, -1e6, 1e6) &&
        n(t.curvature, -1, 1) &&
        TAIL_STYLES.includes(t.style),
    ) &&
    color(o.fill) &&
    n(o.fillOpacity, 0, 1) &&
    color(o.stroke) &&
    n(o.strokeWidth, 0, 200) &&
    n(o.dash, 0, 500) &&
    color(o.shadowColor) &&
    n(o.shadowBlur, 0, 200) &&
    n(o.shadowX, -1000, 1000) &&
    n(o.shadowY, -1000, 1000) &&
    n(o.padding, 0, 2000) &&
    typeof o.text === "string" &&
    o.text.length <= 10000 &&
    typeof o.font === "string" &&
    o.font.length > 0 &&
    o.font.length <= 100 &&
    /^[\p{L}\p{N} _-]+$/u.test(o.font) &&
    n(o.size, 1, 2000) &&
    n(o.weight, 100, 900) &&
    typeof o.italic === "boolean" &&
    color(o.textColor) &&
    ["left", "center", "right"].includes(o.align) &&
    n(o.letterSpacing, -100, 500) &&
    n(o.lineHeight, 0.5, 5) &&
    BUBBLE_LANGUAGES.includes(o.language) &&
    ["ltr", "rtl"].includes(o.direction) &&
    ["horizontal", "vertical"].includes(o.writing) &&
    typeof o.fit === "boolean" &&
    color(o.textStroke) &&
    n(o.textStrokeWidth, 0, 100) &&
    n(o.textShadow, 0, 100) &&
    isBlendMode(o.blend);
  if (!ok) throw Error("Invalid composition: speech bubble.");
}
