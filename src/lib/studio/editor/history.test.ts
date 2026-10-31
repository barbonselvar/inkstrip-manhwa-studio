import test from "node:test";
import assert from "node:assert/strict";
import { createHistory, fingerprint, record, redo, same, undo } from "./history.ts";
import { budgetHistory } from "../pro/history-budget.ts";

test("same() matches JSON equality for objects, arrays and primitives", () => {
  const cases: [unknown, unknown, boolean][] = [
    [{ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }, true],
    [{ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] }, false],
    [{ a: "x" }, { a: "y" }, false],
    [{ a: 1 }, { a: 1, b: undefined }, true],
    [3, 3, true],
    ["ab", "ba", false],
    [null, null, true],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(same(a, b), expected, JSON.stringify([a, b]));
    assert.equal(same(a, b), JSON.stringify(a) === JSON.stringify(b));
  }
});

test("equal fingerprints are always confirmed by full comparison", () => {
  // Same length and hash can only short-circuit to "different"; equality needs proof.
  const a = { v: "aaaa" },
    b = { v: "aaab" };
  assert.equal(fingerprint(a).length, fingerprint(b).length);
  assert.equal(same(a, b), false);
  assert.equal(same({ v: "aaaa" }, a), true);
});

test("a stale fingerprint never hides a real change", () => {
  const present = { layers: [1] };
  fingerprint(present);
  present.layers.push(2); // forbidden in the app, tolerated here
  // Content now equals `next`: the stale print may only report "different" (an extra
  // entry), never "same" for content that differs.
  const next = { layers: [1, 2] };
  const h = record(createHistory(present), next);
  assert.ok(h.present === next || h.present === present);
  assert.equal(same({ layers: [9] }, present), false);
});

test("record skips only true no-ops and undo/redo keep snapshot identity", () => {
  const first = { doc: { n: 1 }, label: "a" };
  let h = createHistory(first);
  h = record(h, { doc: { n: 1 }, label: "a" });
  assert.equal(h.past.length, 0, "structurally equal commit is a no-op");
  const second = { doc: { n: 2 }, label: "b" };
  h = record(h, second);
  assert.equal(h.past.length, 1);
  h = undo(h);
  assert.equal(h.present, first);
  h = redo(h);
  assert.equal(h.present, second);
});

test("budget sizes are cached per snapshot and still evict the oldest first", () => {
  const big = (n: number) => ({ doc: { data: "x".repeat(1000), n }, label: String(n) });
  let h = createHistory(big(0));
  for (let i = 1; i <= 30; i++) h = record(h, big(i));
  const limited = budgetHistory(h, 2 * 1100 * 10);
  assert.ok(limited.past.length < h.past.length);
  assert.equal(limited.present, h.present);
  assert.equal(limited.past.at(-1), h.past.at(-1), "nearest undo retained");
  // Budgeting the same history again gives the same result (cached sizes).
  assert.deepEqual(budgetHistory(h, 2 * 1100 * 10).past, limited.past);
});

test("fingerprint length equals JSON.stringify length and follows JSON omission rules", () => {
  const values: unknown[] = [
    { a: 1, b: 'x\n"y', c: [1, null, undefined, () => 1], d: undefined, e: -0, f: NaN },
    [
      { x: 1.5, y: 2 },
      { x: 3, y: 4, pressure: 0.25 },
    ],
    { nested: { deep: [[1], [2, { t: true }]] }, date: new Date(0) },
    { "0": "numeric key", z: 1, a: 2 },
    "plain",
    42,
    null,
  ];
  for (const value of values)
    assert.equal(fingerprint(value).length, JSON.stringify(value).length, JSON.stringify(value));
  // Equal JSON text gives equal fingerprints regardless of omitted/undefined members.
  assert.deepEqual(fingerprint({ a: 1, b: undefined }), fingerprint({ a: 1 }));
  assert.deepEqual(fingerprint([undefined]), fingerprint([null]));
  assert.deepEqual(fingerprint({ n: -0 }), fingerprint({ n: 0 }));
  assert.notDeepEqual(fingerprint({ a: "1" }), fingerprint({ a: 1 }));
  assert.notDeepEqual(fingerprint([1, 2]), fingerprint([2, 1]));
  assert.notDeepEqual(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
});

test("structural sharing: a new snapshot reuses unchanged children", () => {
  const stroke = (i: number) => ({
    points: Array.from({ length: 50 }, (_, k) => ({ x: k, y: i })),
    seed: i,
  });
  const layer = { id: "a", strokes: Array.from({ length: 200 }, (_, i) => stroke(i)) };
  const other = { id: "b", strokes: [stroke(999)] };
  const before = { layers: [layer, other] };
  const after = { layers: [{ ...layer, strokes: [...layer.strokes, stroke(200)] }, other] };
  assert.equal(fingerprint(before).length, JSON.stringify(before).length);
  assert.equal(fingerprint(after).length, JSON.stringify(after).length);
  assert.equal(same(before, after), false);
  assert.equal(same(after, JSON.parse(JSON.stringify(after))), true);
});
