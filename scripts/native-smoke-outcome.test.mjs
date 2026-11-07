import assert from "node:assert/strict";
import { test } from "node:test";
import { smokeOutcome } from "../apps/scripts/native-smoke-outcome.mjs";

test("optional Android warnings are not reported as passes", () => {
  const results = [
    { ok: true, required: true },
    { ok: false, required: false },
    { ok: true, required: false },
  ];
  assert.deepEqual(smokeOutcome(results), { passed: 2, total: 3, failed: 0, warnings: 1 });
});

test("required failures and optional warnings are counted separately", () => {
  assert.deepEqual(smokeOutcome([
    { ok: false, required: true },
    { ok: false, required: false },
  ]), { passed: 0, total: 2, failed: 1, warnings: 1 });
});
