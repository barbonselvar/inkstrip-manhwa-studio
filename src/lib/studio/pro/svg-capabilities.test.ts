import { test } from "node:test";
import assert from "node:assert/strict";
import { SVG_ELEMENTS, SVG_IMPORT_HELP, svgImportHelp } from "./svg-capabilities.ts";

test("INK-AUD-004: SVG help claims agree with the importer allow-list", () => {
  const allowed = new Set<string>(SVG_ELEMENTS);
  for (const claim of SVG_IMPORT_HELP.supported)
    for (const element of claim.elements)
      assert.ok(allowed.has(element), `${claim.text}: ${element}`);
  for (const claim of SVG_IMPORT_HELP.rejected)
    for (const element of claim.elements)
      assert.ok(!allowed.has(element), `${claim.text}: ${element}`);
  const help = svgImportHelp();
  // The audit's fixture (linear gradient + local clipPath) imports, so help must not reject them.
  assert.match(help, /local linear and radial gradients/);
  assert.match(help, /local clipping paths/);
  assert.doesNotMatch(help, /Gradients, clipping paths, masks .* are rejected/);
  assert.match(help, /scripts and event handlers/);
  assert.match(help, /external or embedded images/);
});
