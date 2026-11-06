/** Original geometric lettering: Hangul is decomposed into jamo and built from
 * editable angular polygons. No font or reference manhwa artwork is traced. */
import type { Sfx } from "./model.ts";
import { INK_STYLES } from "./ink-catalog.ts";
type Point = { x: number; y: number };
const lines: Record<string, number[][]> = {
  ㄱ: [[10, 15, 90, 15, 90, 90]],
  ㄴ: [[10, 10, 10, 90, 90, 90]],
  ㄷ: [
    [90, 10, 10, 10, 10, 90, 90, 90],
    [10, 10, 90, 10],
  ],
  ㄹ: [[10, 10, 90, 10, 90, 50, 10, 50, 10, 90, 90, 90]],
  ㅁ: [[10, 10, 90, 10, 90, 90, 10, 90, 10, 10]],
  ㅂ: [
    [10, 10, 10, 90, 90, 90, 90, 10],
    [10, 50, 90, 50],
  ],
  ㅅ: [
    [50, 10, 10, 90],
    [50, 10, 90, 90],
  ],
  ㅇ: [[30, 8, 70, 8, 94, 30, 94, 70, 70, 92, 30, 92, 6, 70, 6, 30, 30, 8]],
  ㅈ: [
    [5, 10, 95, 10],
    [50, 10, 10, 90],
    [50, 10, 90, 90],
  ],
  ㅊ: [
    [30, 0, 70, 0],
    [5, 25, 95, 25],
    [50, 25, 10, 95],
    [50, 25, 90, 95],
  ],
  ㅋ: [
    [10, 10, 90, 10, 90, 95],
    [10, 50, 90, 50],
  ],
  ㅌ: [
    [90, 10, 10, 10, 10, 90, 90, 90],
    [10, 50, 90, 50],
  ],
  ㅍ: [
    [0, 10, 100, 10],
    [0, 90, 100, 90],
    [25, 10, 25, 90],
    [75, 10, 75, 90],
  ],
  ㅎ: [
    [35, 0, 65, 0],
    [5, 20, 95, 20],
    [30, 40, 70, 40, 90, 60, 90, 80, 70, 100, 30, 100, 10, 80, 10, 60, 30, 40],
  ],
  ㅏ: [
    [40, 0, 40, 100],
    [40, 50, 90, 50],
  ],
  ㅑ: [
    [40, 0, 40, 100],
    [40, 30, 90, 30],
    [40, 70, 90, 70],
  ],
  ㅓ: [
    [60, 0, 60, 100],
    [10, 50, 60, 50],
  ],
  ㅕ: [
    [60, 0, 60, 100],
    [10, 30, 60, 30],
    [10, 70, 60, 70],
  ],
  ㅗ: [
    [0, 75, 100, 75],
    [50, 10, 50, 75],
  ],
  ㅛ: [
    [0, 75, 100, 75],
    [30, 10, 30, 75],
    [70, 10, 70, 75],
  ],
  ㅜ: [
    [0, 25, 100, 25],
    [50, 25, 50, 95],
  ],
  ㅠ: [
    [0, 25, 100, 25],
    [30, 25, 30, 95],
    [70, 25, 70, 95],
  ],
  ㅡ: [[0, 50, 100, 50]],
  ㅣ: [[50, 0, 50, 100]],
  A: [
    [0, 100, 50, 0, 100, 100],
    [20, 65, 80, 65],
  ],
  B: [
    [0, 100, 0, 0, 70, 0, 100, 20, 70, 50, 0, 50],
    [70, 50, 100, 75, 70, 100, 0, 100],
  ],
  C: [[100, 0, 15, 0, 0, 20, 0, 80, 15, 100, 100, 100]],
  D: [[0, 100, 0, 0, 65, 0, 100, 25, 100, 75, 65, 100, 0, 100]],
  E: [
    [100, 0, 0, 0, 0, 100, 100, 100],
    [0, 50, 75, 50],
  ],
  F: [
    [100, 0, 0, 0, 0, 100],
    [0, 50, 75, 50],
  ],
  G: [[100, 0, 15, 0, 0, 20, 0, 80, 15, 100, 100, 100, 100, 55, 55, 55]],
  H: [
    [0, 0, 0, 100],
    [100, 0, 100, 100],
    [0, 50, 100, 50],
  ],
  I: [
    [0, 0, 100, 0],
    [50, 0, 50, 100],
    [0, 100, 100, 100],
  ],
  J: [[0, 0, 100, 0, 100, 80, 75, 100, 20, 100, 0, 80]],
  K: [
    [0, 0, 0, 100],
    [100, 0, 0, 50, 100, 100],
  ],
  L: [[0, 0, 0, 100, 100, 100]],
  M: [[0, 100, 0, 0, 50, 55, 100, 0, 100, 100]],
  N: [[0, 100, 0, 0, 100, 100, 100, 0]],
  O: [[20, 0, 80, 0, 100, 20, 100, 80, 80, 100, 20, 100, 0, 80, 0, 20, 20, 0]],
  P: [[0, 100, 0, 0, 80, 0, 100, 20, 80, 50, 0, 50]],
  Q: [
    [20, 0, 80, 0, 100, 20, 100, 80, 80, 100, 20, 100, 0, 80, 0, 20, 20, 0],
    [55, 65, 110, 110],
  ],
  R: [
    [0, 100, 0, 0, 80, 0, 100, 20, 80, 50, 0, 50],
    [50, 50, 100, 100],
  ],
  S: [[100, 0, 15, 0, 0, 20, 0, 40, 100, 60, 100, 80, 85, 100, 0, 100]],
  T: [
    [0, 0, 100, 0],
    [50, 0, 50, 100],
  ],
  U: [[0, 0, 0, 80, 20, 100, 80, 100, 100, 80, 100, 0]],
  V: [[0, 0, 50, 100, 100, 0]],
  W: [[0, 0, 20, 100, 50, 50, 80, 100, 100, 0]],
  X: [
    [0, 0, 100, 100],
    [100, 0, 0, 100],
  ],
  Y: [
    [0, 0, 50, 50, 100, 0],
    [50, 50, 50, 100],
  ],
  Z: [[0, 0, 100, 0, 0, 100, 100, 100]],
  "!": [
    [50, 0, 50, 65],
    [50, 90, 50, 100],
  ],
  ".": [[50, 90, 50, 100]],
  "-": [[10, 50, 90, 50]],
};
const initial = [
  "ㄱ",
  "ㄱㄱ",
  "ㄴ",
  "ㄷ",
  "ㄷㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅂㅂ",
  "ㅅ",
  "ㅅㅅ",
  "ㅇ",
  "ㅈ",
  "ㅈㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
const vowels = [
  "ㅏ",
  "ㅏㅣ",
  "ㅑ",
  "ㅑㅣ",
  "ㅓ",
  "ㅓㅣ",
  "ㅕ",
  "ㅕㅣ",
  "ㅗ",
  "ㅗㅏ",
  "ㅗㅏㅣ",
  "ㅗㅣ",
  "ㅛ",
  "ㅜ",
  "ㅜㅓ",
  "ㅜㅓㅣ",
  "ㅜㅣ",
  "ㅠ",
  "ㅡ",
  "ㅡㅣ",
  "ㅣ",
];
const final = [
  "",
  "ㄱ",
  "ㄱㄱ",
  "ㄱㅅ",
  "ㄴ",
  "ㄴㅈ",
  "ㄴㅎ",
  "ㄷ",
  "ㄹ",
  "ㄹㄱ",
  "ㄹㅁ",
  "ㄹㅂ",
  "ㄹㅅ",
  "ㄹㅌ",
  "ㄹㅍ",
  "ㄹㅎ",
  "ㅁ",
  "ㅂ",
  "ㅂㅅ",
  "ㅅ",
  "ㅅㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
export function inkGlyph(char: string): Point[][] | null {
  const result: Point[][] = [];
  const add = (text: string, x: number, y: number, w: number, h: number) =>
    [...text].forEach((j, i) => {
      for (const line of lines[j] ?? [])
        result.push(
          Array.from({ length: line.length / 2 }, (_, n) => ({
            x: x + ((i + line[n * 2] / 100) * w) / text.length,
            y: y + (line[n * 2 + 1] / 100) * h,
          })),
        );
    });
  const code = char.codePointAt(0)! - 0xac00;
  if (code >= 0 && code < 11172) {
    const lead = Math.floor(code / 588),
      v = Math.floor(code / 28) % 21,
      f = code % 28,
      h = f ? 64 : 94;
    if ([8, 12, 13, 17, 18].includes(v)) {
      add(initial[lead], 8, 0, 84, h * 0.57);
      add(vowels[v], 4, h * 0.65, 92, h * 0.3);
    } else if ([9, 10, 11, 14, 15, 16, 19].includes(v)) {
      add(initial[lead], 4, 0, 48, h * 0.58);
      add(vowels[v][0], 0, h * 0.64, 58, h * 0.32);
      add(vowels[v].slice(1), 63, 0, 30, h);
    } else {
      add(initial[lead], 0, 0, 52, h);
      add(vowels[v], 64, 0, 32, h);
    }
    if (f) add(final[f], 8, 77, 84, 23);
  } else if (lines[char.toUpperCase()]) add(char.toUpperCase(), 0, 0, 100, 100);
  else if (char !== " ") return null;
  return result;
}
export function inkSupported(text: string) {
  return [...text].every((c) => c === "\n" || inkGlyph(c) !== null);
}
export function inkPolygons(o: Sfx): Point[][] {
  const polygons: Point[][] = [];
  let x = 10,
    y = 12;
  const style = o.ink ?? INK_STYLES[0],
    jagged = /Jagged|Brush|Horror|Speed|Sharp/.test(style),
    thin = /Thin/.test(style),
    weight = /Heavy/.test(style) ? 15 : thin ? 4 : 10;
  [...o.text].forEach((c, index) => {
    if (c === "\n") {
      x = 10;
      y += o.size * o.lineHeight;
      return;
    }
    const glyph = inkGlyph(c) ?? [],
      latin = /[A-Za-z !.-]/.test(c),
      sx = (o.size * (latin ? 0.55 : 0.85)) / 100,
      sy = o.size / 100;
    for (const line of glyph)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i],
          dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.hypot(dx, dy) || 1,
          nx = -dy / len,
          ny = dx / len,
          r =
            weight *
            (1 +
              (jagged
                ? Math.sin(index * 7 + i) *
                  (/Jagged/.test(style) ? 0.45 : /Brush/.test(style) ? 0.32 : 0.2)
                : 0));
        const pts = [
          { x: a.x + nx * r, y: a.y + ny * r },
          {
            x: (a.x + b.x) * 0.5 + nx * r * (jagged ? 0.5 : 1),
            y: (a.y + b.y) * 0.5 + ny * r * (jagged ? 0.5 : 1),
          },
          { x: b.x + nx * r * 0.6, y: b.y + ny * r * 0.6 },
          { x: b.x + (dx / len) * (jagged ? 12 : 0), y: b.y + (dy / len) * (jagged ? 12 : 0) },
          { x: b.x - nx * r, y: b.y - ny * r },
          {
            x: (a.x + b.x) * 0.5 - nx * r * (jagged ? 1.3 : 1),
            y: (a.y + b.y) * 0.5 - ny * r * (jagged ? 1.3 : 1),
          },
          { x: a.x - nx * r * 0.7, y: a.y - ny * r * 0.7 },
        ];
        polygons.push(
          pts.map((p) => ({
            x: x + p.x * sx + (jagged ? (100 - p.y) * 0.12 : 0),
            y: y + p.y * sy + (jagged ? Math.sin(index * 3) * 4 : 0),
          })),
        );
      }
    x += (latin ? 0.65 : 1) * o.size + o.spacing;
  });
  return polygons;
}
export function paintInk(ctx: CanvasRenderingContext2D, o: Sfx) {
  const path = new Path2D();
  for (const poly of inkPolygons(o)) {
    poly.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
  }
  ctx.save();
  ctx.lineJoin = "miter";
  ctx.miterLimit = 4;
  if (o.gradient) {
    const g = ctx.createLinearGradient(0, 0, 0, o.size);
    g.addColorStop(0, o.fill);
    g.addColorStop(1, o.fill2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = o.fill;
  const m = ctx.getTransform(),
    scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  if (o.shadow || o.glow) {
    ctx.save();
    ctx.shadowColor = o.glow ? o.fill : "#000000";
    ctx.shadowBlur = Math.max(o.shadow, o.glow) * scale;
    ctx.shadowOffsetX = o.shadow * 0.4 * scale;
    ctx.shadowOffsetY = o.shadow * 0.5 * scale;
    ctx.fill(path);
    ctx.restore();
  }
  for (const s of [...o.strokes].sort((a, b) => b.width - a.width)) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * 2;
    ctx.stroke(path);
  }
  ctx.fill(path);
  if (o.texture) {
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha *= o.texture * 0.7;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < o.width / 9; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 9, 0);
      ctx.lineTo(i * 9 + 20, o.height);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
