export type Frame = { id: string; sw: number; sh: number };

export type PlannedPanel = {
  id: string;
  drawW: number;
  /** Height of this segment on the page. */
  drawH: number;
  x: number;
  /** Top of this segment within its part. */
  y: number;
  /** Offset of this segment within the scaled panel (0 unless the panel continues from the previous part). */
  srcY: number;
  /** Full scaled height of the panel; larger than drawH when the panel spans parts. */
  fullH: number;
};

export type PlannedPart = {
  height: number;
  panels: PlannedPanel[];
};

export type StripPlan = {
  width: number;
  totalHeight: number;
  parts: PlannedPart[];
};

export type CanvasLimits = { maxSide: number; maxArea: number };

/** Every panel is drawn at the full page width, in reading order. A panel taller than one
 * device canvas continues seamlessly into the next part instead of being shrunk, so long
 * vertical images keep their resolution. Whole panels move to a new part when they would
 * otherwise be cut and fit on their own. The seam gap keeps its size across part breaks. */
export function planStrip(
  frames: Frame[],
  targetWidth: number,
  gap: number,
  limits: CanvasLimits,
): StripPlan {
  const safeGap = Math.max(0, Math.round(gap));
  const width = Math.max(1, Math.min(Math.round(targetWidth), limits.maxSide, limits.maxArea));
  if (frames.length === 0) return { width, totalHeight: 0, parts: [] };
  const maxPartH = Math.max(1, Math.min(limits.maxSide, Math.floor(limits.maxArea / width)));

  const parts: PlannedPart[] = [];
  let current: PlannedPanel[] = [],
    height = 0;
  const close = () => {
    if (current.length) parts.push({ height, panels: current });
    current = [];
    height = 0;
  };

  frames.forEach((frame, index) => {
    const sw = Math.max(1, frame.sw),
      sh = Math.max(1, frame.sh),
      fullH = Math.max(1, Math.round(sh * (width / sw)));
    if (index > 0) {
      // Keep whole panels together when they fit on a fresh part; the gap then opens the
      // next part so the visual seam is unchanged.
      if (height + safeGap + fullH > maxPartH && fullH + safeGap <= maxPartH) close();
      if (height + safeGap >= maxPartH) close();
      height += safeGap;
    }
    let srcY = 0;
    while (srcY < fullH) {
      if (height >= maxPartH) close();
      const segment = Math.min(fullH - srcY, maxPartH - height);
      current.push({ id: frame.id, drawW: width, drawH: segment, x: 0, y: height, srcY, fullH });
      height += segment;
      srcY += segment;
    }
  });
  close();

  const totalHeight = parts.reduce((sum, part) => sum + part.height, 0);
  return { width, totalHeight, parts };
}
