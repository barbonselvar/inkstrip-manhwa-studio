/** Area-sample row-bounded selection coverage into a bounded preview. No native
 * RGBA mask needs to be allocated to display a small thumbnail. Analysis and
 * native output still use the original source-resolution coverage. */
export function previewCoverage(
  width: number,
  height: number,
  runs: number[],
  outWidth: number,
  outHeight: number,
) {
  const alpha = new Float32Array(outWidth * outHeight),
    sx = outWidth / width,
    sy = outHeight / height;
  for (let i = 0; i < runs.length; i += 3) {
    const row = Math.floor(runs[i]! / width),
      x0 = (runs[i]! % width) * sx,
      x1 = ((runs[i]! % width) + runs[i + 1]!) * sx,
      y0 = row * sy,
      y1 = (row + 1) * sy,
      value = runs[i + 2]!;
    for (let y = Math.floor(y0); y < Math.min(outHeight, Math.ceil(y1)); y++)
      for (let x = Math.floor(x0); x < Math.min(outWidth, Math.ceil(x1)); x++)
        alpha[y * outWidth + x] +=
          value *
          Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0)) *
          Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
  }
  return Uint8Array.from(alpha, (n) => Math.max(0, Math.min(255, Math.round(n))));
}
