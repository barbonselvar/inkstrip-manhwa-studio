import test from "node:test";
import assert from "node:assert/strict";
import { crc32, zipStore, zipPath, safeAssetName } from "../dialogue/zip.ts";
test("archive CRC matches the published CRC32 check value", async () => {
  assert.equal(await crc32(new Blob(["123456789"])), 0xcbf43926);
  assert.equal(await crc32(new Blob([])), 0);
});
test("archive entries retain exact bytes and deterministic UTF8 directory offsets", async () => {
  const input = [
    { name: "001/日本語.txt", blob: new Blob(["مرحبا بالعالم"]) },
    { name: "002/image.bin", blob: new Blob([new Uint8Array([0, 255, 32, 1])]) },
  ];
  const a = new Uint8Array(await (await zipStore(input)).arrayBuffer()),
    b = new Uint8Array(await (await zipStore(input)).arrayBuffer());
  assert.deepEqual(a, b);
  const v = new DataView(a.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint16(6, true), 0x800);
  const n = v.getUint16(26, true),
    size = v.getUint32(18, true);
  assert.equal(new TextDecoder().decode(a.slice(30, 30 + n)), input[0]!.name);
  assert.deepEqual(
    a.slice(30 + n, 30 + n + size),
    new Uint8Array(await input[0]!.blob.arrayBuffer()),
  );
  const end = a.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 8, true), 2);
  const dir = v.getUint32(end + 16, true);
  assert.equal(v.getUint32(dir, true), 0x02014b50);
  assert.equal(v.getUint32(dir + 42, true), 0);
});
test("archives reject traversal, duplicates, oversized entry counts and honour cancellation", async () => {
  for (const path of ["../x", "/x", "x/../y", "x\\y", "x//y", "x\u0000y"])
    assert.throws(() => zipPath(path));
  assert.equal(safeAssetName("../章/One:*"), "-章-One--");
  await assert.rejects(
    zipStore([
      { name: "x", blob: new Blob() },
      { name: "x", blob: new Blob() },
    ]),
    /Duplicate/,
  );
  await assert.rejects(zipStore([]), /between/);
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    zipStore([{ name: "x", blob: new Blob() }], c.signal),
    (e) => (e as Error).name === "AbortError",
  );
});

test("Chapter page ranges preserve reading order, reject invalid input and bound exports", async () => {
  const { pageRange } = await import("../dialogue/ranges.ts");
  assert.deepEqual(pageRange("5,1-3,2", 6), [0, 1, 2, 4]);
  assert.deepEqual(pageRange("", 3), [0, 1, 2]);
  for (const input of ["0", "7", "4-2", "1-3,", "1.5", "-1"])
    assert.throws(() => pageRange(input, 6));
  assert.throws(() => pageRange("", 251), /250/);
  assert.throws(() => pageRange("1-251", 300), /250/);
});
