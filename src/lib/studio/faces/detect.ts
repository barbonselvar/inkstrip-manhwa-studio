export type FaceBox = { x: number; y: number; width: number; height: number; neighbors: number };
export type Cascade = {
  stages: { threshold: number; trees: { nodes: number[]; leaves: number[] }[] }[];
  features: number[][];
};
export function equalize(gray: Uint8Array) {
  const hist = new Uint32Array(256);
  for (const p of gray) hist[p]++;
  const table = new Uint8Array(256);
  let sum = 0,
    min = 0;
  while (min < 255 && !hist[min]) min++;
  const first = hist[min]!;
  for (let i = 0; i < 256; i++) {
    sum += hist[i]!;
    table[i] = Math.max(0, Math.round(((sum - first) * 255) / Math.max(1, gray.length - first)));
  }
  return Uint8Array.from(gray, (p) => table[p]!);
}
export function integral(gray: Uint8Array, width: number, height: number) {
  const s = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]!;
      s[(y + 1) * (width + 1) + x + 1] = row + s[y * (width + 1) + x + 1]!;
    }
  }
  return s;
}
export function scanCascade(gray: Uint8Array, width: number, height: number, model: Cascade) {
  if (gray.length !== width * height || width > 1024 || height > 1024)
    throw new Error("Invalid detector image.");
  const s = integral(equalize(gray), width, height),
    stride = width + 1;
  const sum = (x: number, y: number, w: number, h: number) =>
    s[(y + h) * stride + x + w]! -
    s[y * stride + x + w]! -
    s[(y + h) * stride + x]! +
    s[y * stride + x]!;
  const hits: FaceBox[] = [];
  for (let y = 0; y <= height - 24; y += 2)
    for (let x = 0; x <= width - 24; x += 2) {
      let pass = true;
      for (const stage of model.stages) {
        let value = 0;
        for (const tree of stage.trees) {
          const n = tree.nodes,
            f = model.features[n[2]!]!,
            fx = x + f[0]!,
            fy = y + f[1]!,
            w = f[2]!,
            h = f[3]!;
          const center = sum(fx + w, fy + h, w, h);
          const cells = [
            [0, 0],
            [1, 0],
            [2, 0],
            [2, 1],
            [2, 2],
            [1, 2],
            [0, 2],
            [0, 1],
          ];
          let code = 0;
          for (let k = 0; k < 8; k++) {
            const c = cells[k]!;
            if (sum(fx + c[0]! * w, fy + c[1]! * h, w, h) >= center) code |= 1 << (7 - k);
          }
          const left = !!(n[3 + (code >> 5)]! & (1 << (code & 31)));
          value += tree.leaves[-(left ? n[0]! : n[1]!)]!;
        }
        if (value < stage.threshold - 1e-5) {
          pass = false;
          break;
        }
      }
      if (pass) hits.push({ x, y, width: 24, height: 24, neighbors: 1 });
    }
  return hits;
}
export function overlap(a: FaceBox, b: FaceBox) {
  const area =
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return area / (a.width * a.height + b.width * b.height - area);
}
export function groupFaces(boxes: FaceBox[], minimum = 3) {
  const groups: FaceBox[][] = [];
  for (const b of boxes) {
    const g = groups.find((g) => g.some((a) => overlap(a, b) > 0.3));
    if (g) g.push(b);
    else groups.push([b]);
  }
  return groups
    .filter((g) => g.length >= minimum)
    .map((g) => ({
      x: g.reduce((s, b) => s + b.x, 0) / g.length,
      y: g.reduce((s, b) => s + b.y, 0) / g.length,
      width: g.reduce((s, b) => s + b.width, 0) / g.length,
      height: g.reduce((s, b) => s + b.height, 0) / g.length,
      neighbors: g.length,
    }))
    .sort((a, b) => b.neighbors - a.neighbors)
    .filter((b, i, a) => !a.slice(0, i).some((x) => overlap(x, b) > 0.3))
    .slice(0, 40);
}
