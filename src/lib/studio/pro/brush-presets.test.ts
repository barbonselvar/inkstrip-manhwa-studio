import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BRUSH_PRESETS,
  loadBrushPresets,
  saveBrushPresets,
  upsertBrushPreset,
} from "./brush-presets.ts";

test("built-in brush presets are distinct, validated settings", () => {
  assert.equal(DEFAULT_BRUSH_PRESETS.length, 3);
  assert.equal(DEFAULT_BRUSH_PRESETS[2]!.settings.tip, "square");
  assert.notDeepEqual(DEFAULT_BRUSH_PRESETS[0]!.settings, DEFAULT_BRUSH_PRESETS[1]!.settings);
});

test("custom presets replace by name and persist without damaging defaults on corrupt storage", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
  const custom = {
    name: "Speed lines",
    settings: { size: 7, hardness: 1, opacity: 0.9, flow: 1, color: "#111111", tip: "square" as const },
  };
  const presets = upsertBrushPreset(DEFAULT_BRUSH_PRESETS, custom);
  assert.equal(presets.length, 4);
  assert.equal(saveBrushPresets(storage, presets), true);
  assert.deepEqual(loadBrushPresets(storage), presets);
  data.set("inkstrip-pro-brush-presets-v1", "not json");
  assert.equal(loadBrushPresets(storage).length, DEFAULT_BRUSH_PRESETS.length);
});
