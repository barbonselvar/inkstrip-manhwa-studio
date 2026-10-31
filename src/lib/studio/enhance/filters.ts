/** Conservative edge-aware cleanup: strong ink edges and alpha stay untouched. */
export function cleanPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
) {
  const strength = Math.max(0, Math.min(40, amount)) / 100;
  if (!strength) return;
  const source = data.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0,
          count = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const value = source[((y + dy) * width + x + dx) * 4 + c]!;
            if (Math.abs(value - source[p + c]!) < 20) {
              sum += value;
              count++;
            }
          }
        data[p + c] = source[p + c]! * (1 - strength) + (sum / count) * strength;
      }
    }
  }
}

export function finishPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sharpen: number,
  color: boolean,
) {
  const strength = Math.max(0, Math.min(40, sharpen)) / 100;
  if (!strength && !color) return;
  const source = data.slice();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const gray = source[p]! * 0.2126 + source[p + 1]! * 0.7152 + source[p + 2]! * 0.0722;
      for (let c = 0; c < 3; c++) {
        let value = source[p + c]!;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const blur =
            (source[p - 4 + c]! +
              source[p + 4 + c]! +
              source[p - width * 4 + c]! +
              source[p + width * 4 + c]!) /
            4;
          value += Math.max(-12, Math.min(12, (value - blur) * strength));
        }
        if (color) value = gray + (value - gray) * 1.04;
        data[p + c] = value;
      }
    }
}
