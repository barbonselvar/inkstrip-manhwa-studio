import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFERENCES, parsePreferences, PREFERENCES_KEY } from "./preferences.ts";
test("appearance preferences fail safely without reading or migrating project data", () => {
  for (const raw of [null, "broken", "null", "[]", "17"]) {
    assert.deepEqual(parsePreferences(raw), DEFAULT_PREFERENCES);
  }
  assert.equal(PREFERENCES_KEY, "inkstrip-studio-appearance-v1");
});
test("only supported motion and boolean settings survive persisted input", () => {
  assert.deepEqual(
    parsePreferences(
      '{"motion":"quiet","atmosphere":false,"transparency":false,"artwork":"ignored"}',
    ),
    { motion: "quiet", atmosphere: false, transparency: false },
  );
  assert.deepEqual(
    parsePreferences('{"motion":"strobe","atmosphere":"false","transparency":0}'),
    DEFAULT_PREFERENCES,
  );
  assert.deepEqual(Object.keys(parsePreferences('{"__proto__":{"polluted":true}}')).sort(), [
    "atmosphere",
    "motion",
    "transparency",
  ]);
});
