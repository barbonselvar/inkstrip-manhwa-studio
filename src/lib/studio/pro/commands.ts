/** Searchable access to existing tools, panels and document actions. The palette
 * only lists what the toolbar, inspector tabs and shortcuts already expose in
 * the current mode; choosing an entry runs the same handler they use. */
export const INSPECTOR_PANELS = [
  "dialogue",
  "refine",
  "properties",
  "transform",
  "geometry",
  "layers",
  "paths",
  "pathfinder",
  "artboards",
  "precision",
  "appearance",
  "typography",
  "history",
  "assets",
  "ai",
  "export",
] as const;
export type WorkspacePanel = (typeof INSPECTOR_PANELS)[number];
const DIALOGUE_PANELS = new Set<WorkspacePanel>([
  "dialogue",
  "properties",
  "transform",
  "layers",
  "history",
  "assets",
  "export",
]);

/** The inspector tabs offered in this workspace mode, in toolbar order. */
export function inspectorPanels(mode: "raster" | "vector", dialogue: boolean) {
  return INSPECTOR_PANELS.filter(
    (t) =>
      (t !== "dialogue" || dialogue) &&
      (!dialogue || DIALOGUE_PANELS.has(t)) &&
      // Pathfinder, masks from paths and path ↔ selection live in Raster's
      // Paths tab; Appearance, Precision (guides, snapping, align) and
      // Typography (text on a path, R9) are shared by both modes.
      (t !== "paths" || mode === "raster") &&
      (!["pathfinder", "artboards"].includes(t) || mode === "vector"),
  );
}
export const panelLabel = (t: WorkspacePanel) =>
  t === "ai" ? "AI tools" : t[0]!.toUpperCase() + t.slice(1);

export type WorkspaceCommand = {
  id: string;
  group: "Tools" | "Panels" | "Document";
  label: string;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
};

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Every query word must prefix a word of the label or keywords. Label-prefix
 * matches rank first, then label-word matches, then keyword matches; ties keep
 * the given order, so results are deterministic. Disabled entries are kept and
 * shown as unavailable rather than hidden. */
export function searchCommands(commands: WorkspaceCommand[], query: string) {
  const q = words(query);
  if (!q.length) return commands;
  const ranked: { command: WorkspaceCommand; rank: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = words(command.label),
      all = [...label, ...words(command.keywords ?? "")];
    if (!q.every((part) => all.some((w) => w.startsWith(part)))) return;
    const rank = label.join(" ").startsWith(q.join(" "))
      ? 0
      : q.every((part) => label.some((w) => w.startsWith(part)))
        ? 1
        : 2;
    ranked.push({ command, rank, index });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((r) => r.command);
}
