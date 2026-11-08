import assert from "node:assert/strict";
import { test } from "node:test";
import { stabilityOutcome } from "./stability-outcome.mjs";

const complete = {
  minutes: 60, elapsedMs: 3_600_000, cycles: 1000, crashed: null, errorCount: 0,
  samples: [{ label: "start" }, { label: "end" }],
};

test("a full error-free workload passes", () => {
  assert.deepEqual(stabilityOutcome(complete), { completed: true, passed: true });
});
test("caught workload or console errors fail even when the app survives the full hour", () => {
  assert.equal(stabilityOutcome({ ...complete, errorCount: 1 }).passed, false);
});
test("a crash fails even after the requested duration", () => {
  assert.equal(stabilityOutcome({ ...complete, crashed: "renderer crashed" }).passed, false);
});
test("short, idle-only and unmeasured runs cannot pass", () => {
  for (const change of [{ elapsedMs: 3_599_999 }, { cycles: 0 }, { samples: [] },
    { samples: [{ label: "start" }, { label: "cycle 1" }] }]) {
    assert.deepEqual(stabilityOutcome({ ...complete, ...change }), { completed: false, passed: false });
  }
});
test("invalid durations cannot pass", () => {
  for (const minutes of [0, -1, NaN, Infinity]) {
    assert.equal(stabilityOutcome({ ...complete, minutes }).passed, false);
  }
});
