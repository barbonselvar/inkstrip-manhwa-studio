import test from "node:test";
import assert from "node:assert/strict";
import { GALLERY, GALLERY_INTERVAL, galleryIndex, galleryPosition } from "./gallery.ts";
test("gallery cycles through nine distinct original genres and wraps both directions", () => {
  assert.equal(GALLERY.length, 9);
  assert.equal(new Set(GALLERY.map((a) => a.id)).size, 9);
  assert.equal(new Set(GALLERY.map((a) => a.genre)).size, 9);
  assert.equal(GALLERY_INTERVAL, 3000);
  assert.equal(galleryIndex(-1), 8);
  assert.equal(galleryIndex(9), 0);
});
test("every gallery position retains exactly one front and two supporting artworks", () => {
  for (let current = 0; current < GALLERY.length; current++) {
    const positions = GALLERY.map((_, i) => galleryPosition(i, current));
    for (const visible of ["front", "left", "right"])
      assert.equal(positions.filter((p) => p === visible).length, 1);
    assert.equal(galleryPosition(galleryIndex(current + 1), galleryIndex(current + 1)), "front");
    assert.equal(galleryPosition(current, galleryIndex(current + 1)), "left");
  }
});
test("lettering distribution is four multilingual dialogues, two action effects and three silent scenes", () => {
  assert.equal(GALLERY.filter((a) => "dialogue" in a).length, 4);
  assert.equal(GALLERY.filter((a) => "effect" in a).length, 2);
  assert.equal(GALLERY.filter((a) => !("dialogue" in a) && !("effect" in a)).length, 3);
  assert.deepEqual(
    new Set(GALLERY.flatMap((a) => ("language" in a ? [a.language] : []))),
    new Set(["en", "ja", "ko"]),
  );
});
