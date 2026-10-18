import test from "node:test";
import assert from "node:assert/strict";
import { readerScroll } from "./reader-scroll.ts";

test("reader metadata hides down, shows up, and is always visible at the top", () => {
  assert.equal(readerScroll(100, 130, 1, 15).visible, false);
  assert.equal(readerScroll(130, 100, -1, 15).visible, true);
  assert.equal(readerScroll(40, 0, 1, 0).visible, true);
  assert.equal(readerScroll(0, -20, 0, 0).visible, true);
});

test("small direction changes do not flicker metadata", () => {
  assert.equal(readerScroll(100, 101, 1, 0).visible, undefined);
  assert.equal(readerScroll(100, 99, 1, 20).visible, undefined);
  const state = readerScroll(100, 105, 1, 8);
  assert.equal(state.visible, false);
});
