export type InspectorPanel =
  "properties" | "transform" | "geometry" | "paths" | "appearance" | "typography" | "artboards";
/** Navigate existing controls; this does not switch tools or change artwork. */
export function contextualInspector(
  tool: string,
  mode: "raster" | "vector",
  dialogue = false,
): { panel: InspectorPanel; section?: string } {
  if (dialogue) return { panel: "properties" };
  if (tool === "crop") return { panel: "geometry" };
  if (tool === "transform") return { panel: "transform" };
  if (tool === "artboard" && mode === "vector") return { panel: "artboards" };
  if (tool === "gradient") return { panel: "appearance" };
  if (tool === "text-path") return { panel: "typography" };
  if ((tool === "pen" || tool === "direct") && mode === "raster") return { panel: "paths" };
  if (["brush", "pencil", "eraser", "clone", "heal", "spot", "patch", "fill"].includes(tool))
    return { panel: "properties", section: "pro-brush-settings" };
  if (tool === "text") return { panel: "properties", section: "pro-text-settings" };
  return { panel: "properties" };
}
export function inspectorKeyIndex(key: string, current: number, count: number) {
  if (count < 1 || current < 0 || current >= count) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current + count - 1) % count;
  return undefined;
}
