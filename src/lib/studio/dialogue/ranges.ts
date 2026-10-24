/** One-based page ranges in Chapter reading order. Never reorder or silently drop invalid pages. */
export function pageRange(value: string, total: number) {
  if (!Number.isInteger(total) || total < 1 || total > 10000)
    throw Error("Invalid Chapter page count.");
  if (!value.trim()) {
    if (total > 250) throw Error("Export up to250 pages at a time. Enter a smaller range.");
    return Array.from({ length: total }, (_, i) => i);
  }
  const set = new Set<number>();
  for (const token of value.split(",")) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(token);
    if (!m) throw Error("Use page ranges such as1-3,5.");
    const a = Number(m[1]),
      b = Number(m[2] ?? m[1]);
    if (a < 1 || b < a || b > total) throw Error("Page range is outside this Chapter.");
    for (let n = a; n <= b; n++) {
      set.add(n - 1);
      if (set.size > 250) throw Error("Export up to250 pages at a time.");
    }
  }
  return [...set].sort((a, b) => a - b);
}
