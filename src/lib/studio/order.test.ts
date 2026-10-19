import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOrder, validateOrder, insertPanel } from "./order.ts";
test("drop insertion moves first to third and handles reverse / invalid moves", () => {
  assert.deepEqual(insertPanel(["1", "2", "3"], "1", "3", true), ["2", "3", "1"]);
  assert.deepEqual(insertPanel(["1", "2", "3"], "3", "1", false), ["3", "1", "2"]);
  assert.deepEqual(insertPanel(["1", "2", "3"], "missing", "3", true), ["1", "2", "3"]);
});
test("transaction order guard rejects additions, removals and duplicates", () => {
  validateOrder(["a", "b"], ["b", "a"]);
  assert.throws(() => validateOrder(["a", "b"], ["a", "a"]));
  assert.throws(() => validateOrder(["a", "b"], ["a", "c"]));
  assert.equal(sameOrder(["a", "b"], ["b", "a"]), false);
});
