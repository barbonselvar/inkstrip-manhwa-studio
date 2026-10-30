import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { imagePolicy } from "../image-policy.ts";
import { needsSplit } from "../page-split.ts";
import { patternPolicy } from "../pro/pattern-assets.ts";
import {
  acceptsFile,
  canConfirm,
  clearRecent,
  compareNames,
  createPickerState,
  fileKey,
  gridMove,
  pickerReducer,
  recentFiles,
  rememberRecent,
  selectedFiles,
  type PickerAction,
  type PickerState,
} from "./selection.ts";
import { fitWithin, thumbTarget, UrlCache } from "./thumbnails.ts";
import { defaultValidate, shortReason } from "./validate.ts";

const IMAGE_ACCEPT = "image/*,.heic,.tiff";
const file = (name: string, size = 10, type = "image/png", lastModified = 1) =>
  new File([new Uint8Array(size)], name, { type, lastModified });
const fixture = async (name: string, type = "image/png") =>
  new File(
    [Uint8Array.from(await readFile(new URL(`../fixtures/import/${name}`, import.meta.url)))],
    name,
    { type },
  );

let seq = 0;
function add(state: PickerState, files: File[], extra: Partial<PickerAction> = {}) {
  const batchId = `b${seq++}`;
  return pickerReducer(state, {
    type: "add",
    files,
    source: "photos",
    batchId,
    label: "Photos",
    at: seq,
    ids: files.map((_, i) => `${batchId}-${i}`),
    accept: IMAGE_ACCEPT,
    ...extra,
  } as PickerAction);
}
const ready = (state: PickerState, ...ids: string[]) =>
  ids.reduce(
    (s, id) => pickerReducer(s, { type: "validated", id, ok: true, width: 10, height: 10 }),
    state,
  );
const allReady = (state: PickerState) => ready(state, ...state.items.map((i) => i.id));

test("multiple selection keeps the chosen order and confirms once validated", () => {
  let s = add(createPickerState("multiple"), [file("c.png"), file("a.png"), file("b.png")]);
  assert.deepEqual(
    s.selected,
    s.items.map((i) => i.id),
  );
  assert.equal(canConfirm(s), false, "pending validation blocks import");
  s = allReady(s);
  assert.equal(canConfirm(s), true);
  assert.deepEqual(
    selectedFiles(s).map((f) => f.name),
    ["c.png", "a.png", "b.png"],
  );
});

test("toggle, deselect, clear and remove individual selections", () => {
  let s = allReady(
    add(createPickerState("multiple"), [file("1.png"), file("2.png"), file("3.png")]),
  );
  const [a, b, c] = s.items.map((i) => i.id);
  s = pickerReducer(s, { type: "toggle", id: b! });
  assert.deepEqual(s.selected, [a, c]);
  s = pickerReducer(s, { type: "toggle", id: b! });
  assert.deepEqual(s.selected, [a, c, b], "re-selecting appends to the end of the order");
  s = pickerReducer(s, { type: "remove", id: a! });
  assert.equal(s.items.length, 2);
  assert.deepEqual(s.selected, [c, b]);
  s = pickerReducer(s, { type: "clear" });
  assert.deepEqual(s.selected, []);
  assert.equal(canConfirm(s), false, "nothing selected cannot be imported");
  assert.equal(s.items.length, 2, "clear keeps the gallery");
});

test("single selection mode never holds more than one image", () => {
  let s = add(createPickerState("single"), [file("x.png"), file("y.png")]);
  assert.equal(s.selected.length, 1);
  assert.equal(s.selected[0], s.items[0]!.id);
  s = allReady(s);
  s = pickerReducer(s, { type: "toggle", id: s.items[1]!.id });
  assert.deepEqual(s.selected, [s.items[1]!.id]);
  s = pickerReducer(s, { type: "select", ids: s.items.map((i) => i.id) });
  assert.equal(s.selected.length, 1);
  assert.equal(selectedFiles(s).length, 1);
});

test("duplicates are skipped across batches and reported", () => {
  const same = file("page.png", 99, "image/png", 5);
  let s = add(createPickerState("multiple"), [same, file("other.png")]);
  // Mobile pickers re-stamp lastModified; the same photo is still a duplicate.
  s = add(s, [new File([new Uint8Array(99)], "page.png", { type: "image/png", lastModified: 9 })]);
  assert.equal(s.items.length, 2);
  assert.match(s.notice ?? "", /1 duplicate skipped/);
  assert.equal(s.batches.length, 1, "an all-duplicate batch is not a collection");
  assert.notEqual(fileKey(file("page.png", 99)), fileKey(file("page.png", 98)));
});

test("unsupported types are rejected before validation and limits are enforced", () => {
  let s = add(createPickerState("multiple", 2), [
    file("notes.txt", 5, "text/plain"),
    file("a.png"),
    file("b.heic", 5, ""),
    file("c.png"),
  ]);
  assert.deepEqual(
    s.items.map((i) => i.file.name),
    ["a.png", "b.heic"],
  );
  assert.match(s.notice ?? "", /1 file not supported here/);
  assert.match(s.notice ?? "", /limit of 2 images reached/);
  s = add(s, [file("d.png")]);
  assert.equal(s.items.length, 2);
});

test("invalid images cannot be selected or imported", () => {
  let s = add(createPickerState("multiple"), [file("ok.png"), file("broken.png")]);
  const [ok, broken] = s.items.map((i) => i.id);
  s = ready(s, ok!);
  s = pickerReducer(s, { type: "validated", id: broken!, ok: false, reason: "Malformed header." });
  assert.deepEqual(s.selected, [ok], "a failed file leaves the selection");
  assert.equal(s.items.find((i) => i.id === broken)?.reason, "Malformed header.");
  s = pickerReducer(s, { type: "select", ids: [broken!] });
  assert.deepEqual(s.selected, [ok]);
  assert.match(s.notice ?? "", /can't be imported/);
  assert.deepEqual(
    selectedFiles(s).map((f) => f.name),
    ["ok.png"],
  );
});

test("selected images reorder and sort naturally by name", () => {
  let s = allReady(
    add(createPickerState("multiple"), [file("p10.png"), file("p2.png"), file("p1.png")]),
  );
  const names = () => selectedFiles(s).map((f) => f.name);
  s = pickerReducer(s, { type: "sortByName" });
  assert.deepEqual(names(), ["p1.png", "p2.png", "p10.png"]);
  s = pickerReducer(s, { type: "move", id: s.selected[2]!, delta: -1 });
  assert.deepEqual(names(), ["p1.png", "p10.png", "p2.png"]);
  s = pickerReducer(s, { type: "move", id: s.selected[0]!, delta: -5 });
  assert.deepEqual(names(), ["p1.png", "p10.png", "p2.png"], "moves clamp at the ends");
  assert.ok(compareNames("page 9", "page 10") < 0);
});

test("adding without selecting (recent files) leaves the selection unchanged", () => {
  let s = add(createPickerState("multiple"), [file("r.png")], { source: "recent", select: false });
  assert.deepEqual(s.selected, []);
  s = add(s, [file("n.png")]);
  assert.equal(s.selected.length, 1);
  s = pickerReducer(s, { type: "reset" });
  assert.equal(s.items.length + s.selected.length + s.batches.length, 0, "cancel/reopen is clean");
});

test("recent files are deduplicated, bounded and clearable", () => {
  clearRecent();
  rememberRecent([file("a.png"), file("b.png")]);
  rememberRecent([file("b.png"), file("c.png")]);
  assert.deepEqual(
    recentFiles().map((f) => f.name),
    ["b.png", "c.png", "a.png"],
  );
  rememberRecent(Array.from({ length: 80 }, (_, i) => file(`${i}.png`)));
  assert.equal(recentFiles().length, 48);
  clearRecent();
  assert.equal(recentFiles().length, 0);
});

test("accept matching mirrors the browser picker", () => {
  assert.ok(acceptsFile({ name: "a.JPG", type: "image/jpeg" }, "image/*"));
  assert.ok(acceptsFile({ name: "scan.TIFF", type: "" }, ".tif,.tiff"));
  assert.ok(acceptsFile({ name: "doc.inkstrip", type: "" }, "image/png,.inkstrip"));
  assert.ok(!acceptsFile({ name: "a.gif", type: "image/gif" }, "image/png,image/jpeg"));
  assert.ok(acceptsFile({ name: "anything", type: "" }));
});

test("keyboard grid movement clamps within the grid", () => {
  assert.equal(gridMove(0, "ArrowRight", 3, 7), 1);
  assert.equal(gridMove(0, "ArrowLeft", 3, 7), 0);
  assert.equal(gridMove(1, "ArrowDown", 3, 7), 4);
  assert.equal(gridMove(5, "ArrowDown", 3, 7), 6);
  assert.equal(gridMove(4, "ArrowUp", 3, 7), 1);
  assert.equal(gridMove(4, "Home", 3, 7), 0);
  assert.equal(gridMove(0, "End", 3, 7), 6);
  assert.equal(gridMove(0, "ArrowDown", 3, 0), -1);
});

test("thumbnail URLs are revoked on replace, removal and close", () => {
  const created: string[] = [],
    revoked: string[] = [];
  let n = 0;
  const cache = new UrlCache({
    createObjectURL: () => {
      const url = `blob:${n++}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url) => revoked.push(url),
  });
  cache.set("a", new Blob());
  cache.set("b", new Blob());
  cache.set("a", new Blob());
  assert.deepEqual(revoked, ["blob:0"], "replacing a thumbnail frees the old one");
  cache.retain(["a"]);
  assert.deepEqual(revoked, ["blob:0", "blob:1"]);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(revoked.length, created.length, "every created URL is released");
});

test("thumbnail targets stay small and never upscale", () => {
  assert.deepEqual(fitWithin(4000, 2000, 320), { width: 320, height: 160 });
  assert.deepEqual(fitWithin(100, 50, 320), { width: 100, height: 50 });
  const tall = thumbTarget(800, 40000, 320);
  assert.ok(tall.width * tall.height <= 320 * 320 * 4, "tall pages are bounded");
  assert.ok(tall.height <= 1280);
});

test("validation reuses the shared policy: real images pass, malformed and oversized fail", async () => {
  const signal = new AbortController().signal;
  const ok = await defaultValidate(await fixture("original.png"), signal);
  assert.deepEqual(ok, { ok: true, width: 32, height: 24 });

  const bad = await defaultValidate(file("fake.png", 64), signal);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.doesNotMatch(bad.reason, /Image was not decoded/);

  // tall.png is 1×50000: inside the 65535px side limit, so it is accepted and flagged
  // for lossless splitting instead of being resized.
  const tall = await defaultValidate(await fixture("tall.png"), signal);
  assert.equal(tall.ok, true);
  if (tall.ok) assert.ok(needsSplit(tall.width!, tall.height!, { maxSide: 16384, maxArea: 16e6 }));

  const small = { ...imagePolicy(true), maxBytes: 16 };
  const big = await defaultValidate(await fixture("original.png"), signal, small);
  assert.equal(big.ok, false);
  if (!big.ok) assert.match(big.reason, /encoded-file budget/);

  assert.equal(shortReason("Too big. Image was not decoded or imported."), "Too big.");
});

test("pattern swatches validate against the pattern importer's own budget", async () => {
  const signal = new AbortController().signal;
  const ok = await defaultValidate(await fixture("page.png"), signal, patternPolicy());
  assert.deepEqual(ok, { ok: true, width: 512, height: 512 }, "512px is the inclusive limit");
  const big = await defaultValidate(await fixture("batch-plane.png"), signal, patternPolicy());
  assert.equal(big.ok, false);
  const animated = await defaultValidate(
    await fixture("animated.gif", "image/gif"),
    signal,
    patternPolicy(),
  );
  assert.equal(animated.ok, false, "one frame only");
});
