export type Point = { x: number; y: number };
export type SelectionTool = "brush" | "lasso" | "ellipse" | "rectangle";
export type Selection = {
  tool: SelectionTool;
  mode: "add" | "subtract";
  size: number;
  feather: number;
  points: Point[];
};
export function validateSelection(strokes: Selection[]) {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 128)
    throw new Error("Select an area first (maximum 128 strokes).");
  let count = 0;
  for (const s of strokes) {
    if (
      !["brush", "lasso", "ellipse", "rectangle"].includes(s.tool) ||
      !["add", "subtract"].includes(s.mode) ||
      !Number.isFinite(s.size) ||
      s.size < 1 ||
      s.size > 512 ||
      !Number.isFinite(s.feather) ||
      s.feather < 0 ||
      s.feather > 32 ||
      !s.points.length ||
      s.points.length > 512
    )
      throw new Error("Invalid selection.");
    for (const p of s.points)
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 1 ||
        p.y < 0 ||
        p.y > 1
      )
        throw new Error("Selection outside image.");
    count += s.points.length;
  }
  if (count > 8192) throw new Error("Selection too complex. Clear some strokes.");
}
export function paintSelection(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  strokes: Selection[],
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  for (const s of strokes) {
    ctx.save();
    ctx.globalCompositeOperation = s.mode === "add" ? "source-over" : "destination-out";
    ctx.fillStyle = ctx.strokeStyle = "white";
    ctx.lineWidth = (s.size * width) / 1000;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.filter = s.feather ? `blur(${(s.feather * width) / 1000}px)` : "none";
    const a = s.points[0]!,
      b = s.points.at(-1)!;
    ctx.beginPath();
    if (s.tool === "ellipse")
      ctx.ellipse(
        ((a.x + b.x) * width) / 2,
        ((a.y + b.y) * height) / 2,
        Math.max(0.5, (Math.abs(a.x - b.x) * width) / 2),
        Math.max(0.5, (Math.abs(a.y - b.y) * height) / 2),
        0,
        0,
        Math.PI * 2,
      );
    else if (s.tool === "rectangle")
      ctx.rect(
        Math.min(a.x, b.x) * width,
        Math.min(a.y, b.y) * height,
        Math.abs(a.x - b.x) * width,
        Math.abs(a.y - b.y) * height,
      );
    else {
      ctx.moveTo(a.x * width, a.y * height);
      for (const p of s.points) ctx.lineTo(p.x * width, p.y * height);
      if (s.tool === "brush" && s.points.length === 1)
        ctx.lineTo(a.x * width + 0.01, a.y * height + 0.01);
    }
    if (s.tool === "brush") ctx.stroke();
    else {
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
export function selectionBox(strokes: Selection[]) {
  validateSelection(strokes);
  const add = strokes.filter((s) => s.mode === "add");
  if (!add.length) throw new Error("Add a selection first.");
  return {
    left: Math.max(
      0,
      Math.min(...add.flatMap((s) => s.points.map((p) => p.x - s.size / 2000 - s.feather / 500))),
    ),
    top: Math.max(
      0,
      Math.min(...add.flatMap((s) => s.points.map((p) => p.y - s.size / 2000 - s.feather / 500))),
    ),
    right: Math.min(
      1,
      Math.max(...add.flatMap((s) => s.points.map((p) => p.x + s.size / 2000 + s.feather / 500))),
    ),
    bottom: Math.min(
      1,
      Math.max(...add.flatMap((s) => s.points.map((p) => p.y + s.size / 2000 + s.feather / 500))),
    ),
  };
}
