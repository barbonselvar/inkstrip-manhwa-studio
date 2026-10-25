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
    bubble = { ...layer("text", 64, 48), dialogueRole: "text" as const, textPath: undefined };
  d.layers.push(shape, text, paint, adjustment, bubble);
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
  const withGradient = doc();
  withGradient.layers.push(layer("gradient", 64, 48));
  assert.equal(hasLegacyVectorContent(withGradient), true);
  const withAppearance = doc();
  withAppearance.layers.push({ ...layer("shape", 64, 48), appearance: [{} as never] });
  assert.equal(hasLegacyVectorContent(withAppearance), true);
  const withClip = doc();
  withClip.layers.push({ ...layer("shape", 64, 48), vectorClips: [{} as never] });
  assert.equal(hasLegacyVectorContent(withClip), true);
  const withTextPath = doc();
  withTextPath.layers.push({ ...layer("text", 64, 48), textPath: {} as never });
  assert.equal(hasLegacyVectorContent(withTextPath), true);
});

test("only ?vector=legacy requests the legacy entry points", () => {
  assert.equal(legacyVectorRequested("?vector=legacy"), true);
  assert.equal(legacyVectorRequested("?a=1&vector=legacy"), true);
  assert.equal(legacyVectorRequested(""), false);
  assert.equal(legacyVectorRequested("?vector=1"), false);
});
