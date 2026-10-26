import test from "node:test";
import assert from "node:assert/strict";
import { hasLegacyVectorContent, legacyVectorRequested } from "./legacy-vector.ts";
import { fromPanel, layer } from "./pro/model.ts";
import { DEFAULT_LAYOUT } from "./pro/artboards.ts";

const doc = () => fromPanel({ id: "p", name: "p", width: 64, height: 48 });

test("raster work, shared layout settings and Dialogue layers do not reveal Vector Studio", () => {
  const d = doc();
  const shape = layer("shape", 64, 48),
    text = layer("text", 64, 48),
    paint = layer("paint", 64, 48),
    adjustment = layer("adjustment", 64, 48),
    // Raster Studio adds gradient layers and edits text on a path (R9), Appearance stacks
    // and vector masks itself.
    gradient = layer("gradient", 64, 48),
    pathText = { ...layer("text", 64, 48), textPath: {} as never },
    styled = { ...layer("shape", 64, 48), appearance: [{} as never] },
    clipped = { ...layer("shape", 64, 48), vectorClips: [{} as never] },
    bubble = { ...layer("text", 64, 48), dialogueRole: "text" as const, textPath: undefined };
  d.layers.push(shape, text, paint, adjustment, gradient, pathText, styled, clipped, bubble);
  assert.equal(hasLegacyVectorContent(d), false);
  // Grid, snapping and guides are shared Raster settings, not vector content.
  d.layout = { ...structuredClone(DEFAULT_LAYOUT), grid: true, snapping: true };
  assert.equal(hasLegacyVectorContent(d), false);
});

test("vector-only content keeps legacy Vector Studio access", () => {
  const withArtboard = doc();
  withArtboard.artboards = [
    { id: "a", name: "A", x: 0, y: 0, width: 64, height: 48, background: "#fff" },
  ];
  assert.equal(hasLegacyVectorContent(withArtboard), true);
});

test("only ?vector=legacy requests the legacy entry points", () => {
  assert.equal(legacyVectorRequested("?vector=legacy"), true);
  assert.equal(legacyVectorRequested("?a=1&vector=legacy"), true);
  assert.equal(legacyVectorRequested(""), false);
  assert.equal(legacyVectorRequested("?vector=1"), false);
});
