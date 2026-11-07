import { Images, Rows3, Blend, Zap } from "lucide-react";
import type { Align } from "@/lib/studio/composition/geometry";
/** Four primary categories; each owns related sub-tools. Advanced keeps technical tools. */
export const PRIMARY = [
  { label: "Panels", icon: Images, tools: ["Panels"] },
  { label: "Spacing", icon: Rows3, tools: ["Spacing"] },
  { label: "Fades & Transitions", icon: Blend, tools: ["Fade Shapes", "Fades", "Transitions"] },
  {
    label: "Manhwa SFX",
    icon: Zap,
    tools: ["Built-in SFX", "My Assets", "Import", "Extract", "Favorites"],
  },
] as const;
export const ADVANCED = ["Layers", "Effects Library", "Overlays & Sources", "All presets"];
export const SUBTAB: Record<string, string> = {
  "Fade Shapes": "Shapes",
  Fades: "Fade types",
  Transitions: "Transitions",
  "Built-in SFX": "Built-in",
};
/** Earlier tool names (saved sessions, notices, tests) map onto the consolidated sections. */
export const LEGACY_TOOL: Record<string, string> = {
  "Manhwa SFX": "Built-in SFX",
  "SFX Library": "Built-in SFX",
  "My SFX Assets": "My Assets",
  Presets: "All presets",
};
export const normalizeTool = (tool: string) => LEGACY_TOOL[tool] ?? tool;
export const ALIGN: { mode: Align; label: string }[] = [
  { mode: "left", label: "Left" },
  { mode: "center", label: "Center" },
  { mode: "right", label: "Right" },
  { mode: "spread-x", label: "Spread ↔" },
  { mode: "top", label: "Top" },
  { mode: "middle", label: "Middle" },
  { mode: "bottom", label: "Bottom" },
  { mode: "spread-y", label: "Spread ↕" },
];
export const LETTERING_TOOLS = ["Bubbles", "Text", "Dialogue", "Smart placement"] as const;
export const LETTERING_ADVANCED = ["Layers", "Panel documents"] as const;
