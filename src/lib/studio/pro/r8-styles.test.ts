import { test } from "node:test";
import assert from "node:assert/strict";
import { advancedEffect, effectPixels, validateEffects } from "./effects.ts";
import { advancedGradient } from "./gradient.ts";
import { fromPanel, layer, validateDocument, type ProDocument } from "./model.ts";
import { r8Document, addGradientFill } from "./r8-document.ts";
import { selectionTransformTarget } from "./selection-transform.ts";
const square = () => {
  const p = new Uint8ClampedArray(21 * 21 * 4);
  for (let y = 5; y < 16; y++)
    for (let x = 5; x < 16; x++) p.set([128, 128, 128, 255], (y * 21 + x) * 4);
  return p;
};
const at = (p: Uint8ClampedArray, x: number, y: number) => [
  ...p.slice((y * 21 + x) * 4, (y * 21 + x) * 4 + 4),
];
test("inner choke and outer spread change actual edge coverage without mutating source", () => {
  const p = square(),
    snapshot = p.slice(),
    inner = advancedEffect("innerShadow");
  inner.radius = 1;
  inner.distance = 0;
  inner.color = "#ff0000";
  const plain = effectPixels(p, 21, 21, [inner]);
  inner.choke = 3;
  const choked = effectPixels(p, 21, 21, [inner]);
  assert.notDeepEqual(at(plain, 7, 10), at(choked, 7, 10));
  const glow = advancedEffect("outerGlow");
  glow.radius = 1;
  const small = effectPixels(p, 21, 21, [glow]);
  glow.spread = 3;
  const spread = effectPixels(p, 21, 21, [glow]);
  assert.ok(spread[(10 * 21 + 2) * 4 + 3]! > small[(10 * 21 + 2) * 4 + 3]!);
  assert.deepEqual(p, snapshot);
});
test("gradient stroke uses its field colors on true inside/outside alpha geometry", () => {
  const e = advancedEffect("stroke");
  e.position = "outside";
  e.size = 2;
  e.fillKind = "gradient";
  e.gradient = {
    ...advancedGradient(),
    stops: [
      { position: 0, color: "#ff0000", opacity: 1 },
      { position: 1, color: "#0000ff", opacity: 1 },
    ],
  };
  const out = effectPixels(square(), 21, 21, [e]);
  assert.deepEqual(at(out, 3, 10), [255, 0, 0, 255]);
  assert.deepEqual(at(out, 17, 10), [0, 0, 255, 255]);
  assert.deepEqual(at(out, 10, 10), [128, 128, 128, 255]);
});
test("Pattern Overlay repeats recipe pixels and honors offset scale opacity and blend", () => {
  const e = advancedEffect("patternOverlay");
  e.color = "#ff0000";
  e.pattern!.color2 = "#0000ff";
  const a = effectPixels(square(), 21, 21, [e]);
  assert.deepEqual(at(a, 6, 6), [255, 0, 0, 255]);
  assert.deepEqual(at(a, 14, 6), [0, 0, 255, 255]);
  e.pattern!.offsetX = 8;
  assert.deepEqual(at(effectPixels(square(), 21, 21, [e]), 6, 6), [0, 0, 255, 255]);
  e.pattern!.scale = 2;
  assert.notDeepEqual(effectPixels(square(), 21, 21, [e]), a);
  e.opacity = 0;
  assert.deepEqual(effectPixels(square(), 21, 21, [e]), square());
});
test("Bevel zero depth is exact; relief direction and lighting change colors while retaining original alpha", () => {
  const e = advancedEffect("bevel");
  e.size = 2;
  e.bevel!.depth = 0;
  const p = square();
  assert.deepEqual(effectPixels(p, 21, 21, [e]), p);
  e.bevel!.depth = 2;
  const up = effectPixels(p, 21, 21, [e]);
  e.bevel!.direction = "down";
  const down = effectPixels(p, 21, 21, [e]);
  assert.notDeepEqual(up, down);
  for (let i = 3; i < p.length; i += 4) {
    assert.equal(up[i], p[i]);
    assert.equal(down[i], p[i]);
  }
});
test("inner glow center/edge modes and ordered overlays are distinct real processing", () => {
  const e = advancedEffect("innerGlow");
  e.radius = 2;
  e.color = "#ffffff";
  const edge = effectPixels(square(), 21, 21, [e]);
  e.glowSource = "center";
  assert.notDeepEqual(effectPixels(square(), 21, 21, [e]), edge);
  const red = advancedEffect("colorOverlay"),
    gradient = advancedEffect("gradientOverlay");
  red.color = "#ff0000";
  assert.notDeepEqual(
    effectPixels(square(), 21, 21, [red, gradient]),
    effectPixels(square(), 21, 21, [gradient, red]),
  );
});
test("strict style validation rejects invalid relief patterns versions and advanced gradient envelopes", () => {
  const bevel = advancedEffect("bevel");
  bevel.bevel!.depth = Infinity;
  assert.throws(() => validateEffects([bevel]));
  const pattern = advancedEffect("patternOverlay");
  pattern.pattern!.scale = 0;
  assert.throws(() => validateEffects([pattern]));
  const effect = advancedEffect("gradientOverlay");
  effect.gradient = advancedGradient();
  delete effect.version;
  assert.throws(() => validateEffects([effect]), /version 2/);
});
test("Quick Mask import and cyclic draft documents reject safely before processing or locked-parent traversal", () => {
  const d = fromPanel({ id: "p", name: "Trust", width: 64, height: 64 });
  d.version = 3;
  const q = layer("paint", 64, 64, "q");
  q.name = "Quick Mask (temporary)";
  q.effects = [advancedEffect("colorOverlay")];
  d.layers.push(q);
  assert.throws(() => validateDocument(d), /Quick Mask/);
  const cycle = fromPanel({ id: "p", name: "Cycle", width: 64, height: 64 });
  const g = layer("group", 64, 64, "g");
  g.parentId = "g";
  cycle.layers.push(g);
  cycle.layers[0]!.parentId = "g";
  assert.throws(
    () => r8Document({ origin: cycle, layerId: cycle.layers[0]!.id }, {}, 16_777_216),
    /hierarchy|group/i,
  );
  assert.throws(
    () =>
      addGradientFill(cycle, advancedGradient(), { regions: [], inverted: false, feather: 0 }, "g"),
    /hierarchy|group/i,
  );
});
test("selected-pixel guard retains editable filters while whole-layer source metadata stays unchanged", () => {
  const d: ProDocument = {
      ...fromPanel({ id: "p", name: "R5", width: 64, height: 64 }),
      version: 3,
      selection: {
        regions: [
          {
            kind: "rectangle",
            operation: "add",
            points: [
              { x: 0, y: 0 },
              { x: 32, y: 32 },
            ],
          },
        ],
        inverted: false,
        feather: 0,
      },
    },
    paint = layer("paint", 64, 64, "paint");
  paint.smartFilters = [{ id: "blur", enabled: true, operation: { kind: "gaussian", radius: 2 } }];
  d.layers = [paint];
  const snapshot = structuredClone(d);
  assert.throws(() => selectionTransformTarget(d, "paint"), /Smart Filters/);
  assert.deepEqual(d, snapshot);
  paint.smartFilters[0]!.enabled = false;
  assert.equal(selectionTransformTarget(d, "paint"), paint);
});
