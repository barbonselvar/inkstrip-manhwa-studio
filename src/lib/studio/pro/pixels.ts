import type { Layer } from "./model";
/** RGB tone operations, alpha untouched. Piecewise-linear five-point curve; no AI claim. */
export function tonePixels(
  data: Uint8ClampedArray,
  l: Pick<Layer, "hue" | "black" | "white" | "gamma" | "curve">,
) {
  const theta = (l.hue * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta);
  const identity = !l.curve.some((n, i) => n !== [0, 64, 128, 192, 255][i]);
  const tone = (n: number) => {
    const v = Math.max(0, Math.min(1, (n - l.black) / (l.white - l.black))) ** (1 / l.gamma) * 4,
      i = Math.min(3, Math.floor(v)),
      f = v - i;
    return identity ? (v * 255) / 4 : l.curve[i]! * (1 - f) + l.curve[i + 1]! * f;
  };
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    data[i] = tone(
      (0.213 + c * 0.787 - s * 0.213) * r +
        (0.715 - c * 0.715 - s * 0.715) * g +
        (0.072 - c * 0.072 + s * 0.928) * b,
    );
    data[i + 1] = tone(
      (0.213 - c * 0.213 + s * 0.143) * r +
        (0.715 + c * 0.285 + s * 0.14) * g +
        (0.072 - c * 0.072 - s * 0.283) * b,
    );
    data[i + 2] = tone(
      (0.213 - c * 0.213 - s * 0.787) * r +
        (0.715 - c * 0.715 + s * 0.715) * g +
        (0.072 + c * 0.928 + s * 0.072) * b,
    );
  }
  return data;
}
