import test from "node:test";
import assert from "node:assert/strict";
import { proposeEditingPlan } from "./assistant-prototype.mjs";
test("bubble instructions propose real masked preview controls without executing", () => {
  for (const text of [
    "Remove this speech bubble and reconstruct the background.",
    "Supprime cette bulle.",
    "احذف فقاعة النص",
  ]) {
    const p = proposeEditingPlan(text);
    assert.equal(p.tool, "Object Eraser & Retouch");
    assert.equal(p.requiresSelection, true);
    assert.equal(p.executesEdits, false);
  }
});
test("line cleanup keeps color boost off and does not promise identical pixels", () => {
  const p = proposeEditingPlan("Clean the line art without changing the colors.");
  assert.equal(p.settings.color, false);
  assert.equal(p.settings.scale, 1);
  assert.match(p.limitation, /change RGB/);
  assert.equal(p.executesEdits, false);
});
test("face consistency is deferred rather than simulated or sent to a paid provider", () => {
  const p = proposeEditingPlan(
    "Improve this character's face while preserving the original manhwa style.",
  );
  assert.equal(p.status, "deferred");
  assert.equal(p.executesEdits, false);
});
test("ambiguous, unsupported and oversized input cannot execute commands", () => {
  assert.equal(
    proposeEditingPlan("Remove a bubble and clean line art").status,
    "needs-clarification",
  );
  assert.equal(proposeEditingPlan("delete all files").status, "needs-clarification");
  assert.throws(() => proposeEditingPlan("x".repeat(1001)));
  assert.throws(() => proposeEditingPlan(null));
});
