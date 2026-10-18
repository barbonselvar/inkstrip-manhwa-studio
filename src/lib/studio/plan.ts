export type Frame = { id: string; sw: number; sh: number };

export type PlannedPanel = {
  id: string;
  drawW: number;
  drawH: number;
  x: number;
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

export function planStrip(
  frames: Frame[],
  targetWidth: number,
  gap: number,
  limits: CanvasLimits,
): StripPlan {
  const safeGap = Math.max(0, Math.round(gap));
  const requested = Math.max(1, Math.round(targetWidth));
  if (frames.length === 0) {
    return { width: requested, totalHeight: 0, parts: [] };
  }

  const minWidth = Math.min(320, requested);

  const measure = (width: number): PlannedPanel[] => {
    const maxH = Math.max(
      1,
      Math.min(limits.maxSide, Math.floor(limits.maxArea / width)) - safeGap,
    );
    return frames.map((frame) => {
      const sw = Math.max(1, frame.sw);
      const sh = Math.max(1, frame.sh);
      let drawW = width;
      let drawH = Math.max(1, Math.round(sh * (width / sw)));
      if (drawH > maxH) {
        drawH = maxH;
        drawW = Math.max(1, Math.min(width, Math.round(drawH * (sw / sh))));
      }
      return {
        id: frame.id,
        drawW,
        drawH,
        x: Math.round((width - drawW) / 2),
      };
    });
  };

  let width = requested;
  let panels = measure(width);
  const stacked = (items: PlannedPanel[]) =>
    items.reduce((sum, item) => sum + item.drawH, 0) + safeGap * Math.max(0, items.length - 1);

  while (width > minWidth) {
    const height = stacked(panels);
    const tooTall = height > limits.maxSide || width * height > limits.maxArea;
    if (!tooTall) break;
    const next = Math.max(minWidth, Math.floor(width * 0.85));
    if (next === width) break;
    width = next;
    panels = measure(width);
  }

  const fits = (height: number) => height <= limits.maxSide && width * height <= limits.maxArea;
  const parts: PlannedPart[] = [];
  let current: PlannedPanel[] = [];
  let height = 0;

  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index];
    if (!panel) continue;
    const gapBefore = current.length > 0 ? safeGap : 0;
    const next = height + gapBefore + panel.drawH;
    const isLast = index === panels.length - 1;
    const padded = next + (isLast ? 0 : safeGap);
    if (current.length > 0 && !fits(padded)) {
      parts.push({ height, panels: current });
      current = [panel];
      height = panel.drawH;
    } else {
      current = [...current, panel];
      height = next;
    }
  }
  if (current.length > 0) parts.push({ height, panels: current });

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!part) continue;
    parts[index] = { ...part, height: part.height + safeGap };
  }

  const totalHeight = parts.reduce((sum, part) => sum + part.height, 0);
  return { width, totalHeight, parts };
}
