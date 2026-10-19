/** Exemplar texture synthesis. Traditional, not a neural/generative model.
 * Fill from known boundary inward, choosing source patches by known-neighbour SSD.
 * A bounded context and deterministic sampling make memory and runtime predictable. */
export function textureRepair(
  input: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  progress: (n: number) => void = () => {},
) {
  if (input.length !== width * height * 4 || mask.length !== input.length)
    throw new Error("Invalid repair buffers.");
  const out = input.slice(),
    known = new Uint8Array(width * height),
    pending: number[] = [],
    sources: number[] = [];
  for (let p = 0; p < known.length; p++) {
    known[p] = mask[p * 4 + 3]! < 8 ? 1 : 0;
    if (!known[p]) pending.push(p);
    else if (p % 3 === 0) sources.push(p);
  }
  if (!pending.length) throw new Error("The selection is empty.");
  if (sources.length < 16) throw new Error("Leave some unselected background for texture repair.");
  const neighbors = [-width, -1, 1, width];
  const total = pending.length;
  let seed = 19;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  let left = pending;
  while (left.length) {
    const next: number[] = [];
    let made = 0;
    for (const p of left) {
      const x = p % width,
        y = Math.floor(p / width);
      const ns = neighbors.filter((d) => {
        const q = p + d;
        return q >= 0 && q < known.length && Math.abs((q % width) - x) <= 1 && known[q];
      });
      if (!ns.length) {
        next.push(p);
        continue;
      }
      let best = -1,
        cost = Infinity;
      for (let i = 0; i < 48; i++) {
        const q = sources[random() % sources.length]!,
          qx = q % width,
          qy = Math.floor(q / width);
        if (qx < 2 || qy < 2 || qx >= width - 2 || qy >= height - 2) continue;
        let score = 0,
          n = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const a = (y + dy) * width + x + dx,
              b = (qy + dy) * width + qx + dx;
            if (
              x + dx < 0 ||
              x + dx >= width ||
              y + dy < 0 ||
              y + dy >= height ||
              !known[a] ||
              mask[b * 4 + 3]! >= 8
            )
              continue;
            for (let c = 0; c < 3; c++) score += (out[a * 4 + c]! - input[b * 4 + c]!) ** 2;
            n++;
          }
        if (n && score / n < cost) {
          cost = score / n;
          best = q;
        }
      }
      if (best < 0) best = sources[random() % sources.length]!;
      for (let c = 0; c < 3; c++) out[p * 4 + c] = input[best * 4 + c]!;
      known[p] = 1;
      made++;
    }
    if (!made) throw new Error("Selection cannot be reconstructed. Leave more context.");
    left = next;
    progress((total - left.length) / total);
  }
  return out;
}
