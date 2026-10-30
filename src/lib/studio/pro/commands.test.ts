import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INSPECTOR_PANELS,
  inspectorPanels,
  panelLabel,
  searchCommands,
  type WorkspaceCommand,
} from "./commands.ts";

test("inspector panels match the R10 tab rules for each workspace mode", () => {
  assert.deepEqual(inspectorPanels("raster", false), [
    "refine",
    "properties",
    "transform",
    "geometry",
    "layers",
    "paths",
    "precision",
    "appearance",
    "typography",
    "history",
    "assets",
    "ai",
    "export",
  ]);
  assert.deepEqual(inspectorPanels("vector", false), [
    "refine",
    "properties",
    "transform",
    "geometry",
    "layers",
    "pathfinder",
    "artboards",
    "precision",
    "appearance",
    "typography",
    "history",
    "assets",
    "ai",
    "export",
  ]);
  for (const mode of ["raster", "vector"] as const)
    assert.deepEqual(inspectorPanels(mode, true), [
      "dialogue",
      "properties",
      "transform",
      "layers",
      "history",
      "assets",
      "export",
    ]);
  assert.equal(panelLabel("ai"), "AI tools");
  assert.equal(panelLabel("pathfinder"), "Pathfinder");
  assert.equal(new Set(INSPECTOR_PANELS).size, INSPECTOR_PANELS.length);
});

const commands: WorkspaceCommand[] = [
  { id: "tool:brush", group: "Tools", label: "Brush", keywords: "tool", shortcut: "B" },
  { id: "tool:eraser", group: "Tools", label: "Eraser", keywords: "tool" },
  { id: "tool:clone", group: "Tools", label: "Clone Stamp", keywords: "tool" },
  { id: "panel:layers", group: "Panels", label: "Layers panel", keywords: "inspector tab" },
  { id: "doc:tool-settings", group: "Document", label: "Tool settings", keywords: "brush options" },
  { id: "doc:undo", group: "Document", label: "Undo", disabled: true },
  { id: "doc:ruler", group: "Document", label: "Show rulers", keywords: "guides" },
];
const ids = (q: string) => searchCommands(commands, q).map((c) => c.id);

test("command search ranks label prefixes, then label words, then keywords; ties keep order", () => {
  assert.deepEqual(
    ids(""),
    commands.map((c) => c.id),
  );
  assert.deepEqual(
    ids("   "),
    commands.map((c) => c.id),
  );
  assert.deepEqual(ids("br"), ["tool:brush", "doc:tool-settings"]);
  assert.deepEqual(ids("stamp"), ["tool:clone"]);
  assert.deepEqual(ids("tool"), ["doc:tool-settings", "tool:brush", "tool:eraser", "tool:clone"]);
  assert.deepEqual(ids("guides"), ["doc:ruler"]);
  assert.deepEqual(ids("LAYERS  pan"), ["panel:layers"]);
  assert.deepEqual(ids("clone tool"), ["tool:clone"]);
  assert.deepEqual(ids("zzz"), []);
  assert.deepEqual(ids("rush"), [], "words match by prefix, not substring");
});

test("disabled commands stay listed so search never hides an existing control", () => {
  const [undo] = searchCommands(commands, "undo");
  assert.equal(undo?.id, "doc:undo");
  assert.equal(undo?.disabled, true);
});

test("search is case-, accent- and punctuation-insensitive and accepts non-Latin labels", () => {
  const local: WorkspaceCommand[] = [
    { id: "a", group: "Panels", label: "Précision panel" },
    { id: "b", group: "Panels", label: "الطبقات" },
    { id: "c", group: "Document", label: "Save draft", shortcut: "Ctrl/⌘+S" },
  ];
  assert.deepEqual(
    searchCommands(local, "PRECI").map((c) => c.id),
    ["a"],
  );
  assert.deepEqual(
    searchCommands(local, "الطب").map((c) => c.id),
    ["b"],
  );
  assert.deepEqual(
    searchCommands(local, "save-draft").map((c) => c.id),
    ["c"],
  );
});
