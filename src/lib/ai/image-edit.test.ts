import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { encode } from "fast-png";
import { imageEdit } from "./image-edit.server.ts";
import { PngError, validatePng } from "./png-guard.server.ts";

/** A real RGBA PNG (fast-png), so every structural check sees genuine data. */
function pngBytes(width = 64, height = 64) {
  const data = new Uint8Array(width * height * 4).fill(200);
  return new Uint8Array(encode({ width, height, data, channels: 4, depth: 8 }));
}
const png = (width?: number, height?: number) =>
  new Blob([pngBytes(width, height)], { type: "image/png" });
/** The audit's 24-byte container: PNG signature plus 16x16 dimensions and nothing else. */
function truncated() {
  const b = new Uint8Array(24),
    v = new DataView(b.buffer);
  v.setUint32(0, 0x89504e47);
  v.setUint32(4, 0x0d0a1a0a);
  v.setUint32(16, 16);
  v.setUint32(20, 16);
  return new Blob([b], { type: "image/png" });
}
const audit = new Blob([readFileSync(new URL("./fixtures/audit-alpha-red.png", import.meta.url))], {
  type: "image/png",
});
function req(op = "erase", parts: { image?: Blob; mask?: Blob; reference?: Blob } = {}) {
  const f = new FormData();
  f.set("image", parts.image ?? png(), "i.png");
  f.set("mask", parts.mask ?? png(), "m.png");
  f.set("operation", op);
  if (op === "face") f.set("reference", parts.reference ?? png(32, 48), "r.png");
  return new Request("https://studio.test/api/studio/ai-edit", {
    method: "POST",
    headers: { origin: "https://studio.test", "x-inkstrip-access": "test-code" },
    body: f,
  });
}
const config = { key: "test-key", access: "test-code" };
const provider = (b64_json: unknown) => async () => Response.json({ data: [{ b64_json }] });
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

test("cloud route is disabled by default and protected before inference", async () => {
  assert.equal((await imageEdit(req(), {})).status, 503);
  assert.equal((await imageEdit(req(), { key: "test", access: "different" })).status, 403);
  const r = req();
  r.headers.set("origin", "https://other.test");
  assert.equal((await imageEdit(r, { key: "test", access: "test-code" })).status, 403);
});
test("real provider contract sends image, mask and identity reference, returns no-store PNG", async () => {
  for (const op of ["erase", "face"]) {
    let called = false;
    const result = await imageEdit(req(op), config, async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      const body = init!.body as FormData;
      assert.equal(body.get("model"), "gpt-image-1");
      assert.equal(body.getAll("image[]").length, op === "face" ? 2 : 1);
      assert.ok(body.get("mask"));
      called = true;
      return Response.json({ data: [{ b64_json: b64(pngBytes(1024, 1024)) }] });
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(
      validatePng(new Uint8Array(await result.arrayBuffer()), { maxSide: 1024, maxBytes: 16e6 })
        .width,
      1024,
    );
    assert.ok(called);
  }
});
test("provider errors stay generic, never relay private response or credentials", async () => {
  const r = await imageEdit(req(), config, async () => new Response("private", { status: 429 }));
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes("private"));
});

test("INK-AUD-002: malformed or mismatched PNG input returns 400 with zero provider calls", async () => {
  const valid = pngBytes();
  const corrupt = valid.slice();
  corrupt[valid.length - 20] ^= 0xff; // flip a byte inside IDAT: CRC mismatch
  const cases: [string, Parameters<typeof req>[1], string?][] = [
    ["audit truncated 24-byte image and mask", { image: truncated(), mask: truncated() }],
    ["truncated image only", { image: truncated() }],
    ["missing end chunk", { image: new Blob([valid.slice(0, -12)], { type: "image/png" }) }],
    ["corrupt chunk CRC", { image: new Blob([corrupt], { type: "image/png" }) }],
    ["trailing bytes", { image: new Blob([valid, new Uint8Array(4)], { type: "image/png" }) }],
    ["dimensions over 1024px", { image: png(1025, 8), mask: png(1025, 8) }],
    ["mask of a different size", { mask: png(32, 64) }],
    ["wrong MIME type", { image: new Blob([valid], { type: "image/jpeg" }) }],
    ["invalid face reference", { reference: truncated() }, "face"],
  ];
  for (const [name, parts, op] of cases) {
    let calls = 0;
    const r = await imageEdit(req(op ?? "erase", parts), config, async () => {
      calls++;
      return Response.json({ data: [{ b64_json: b64(pngBytes(1024, 1024)) }] });
    });
    assert.equal(r.status, 400, name);
    assert.equal(calls, 0, name);
  }
  // The audit's valid fixture (64x64 RGBA) still reaches the provider.
  let calls = 0;
  const ok = await imageEdit(req("erase", { image: audit, mask: audit }), config, async () => {
    calls++;
    return Response.json({ data: [{ b64_json: b64(pngBytes(1024, 1024)) }] });
  });
  assert.equal(ok.status, 200);
  assert.equal(calls, 1);
});

test("INK-AUD-003: invalid provider output returns 502 and no image", async () => {
  const valid = pngBytes(1024, 1024);
  const cases: [string, unknown][] = [
    ["audit four-byte payload", b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))],
    ["invalid base64", "iVBORw0KGgo!!!!"],
    ["base64 with whitespace", b64(valid).replace(/(.{76})/g, "$1\n")],
    ["truncated PNG", b64(valid.slice(0, valid.length - 30))],
    ["wrong dimensions", b64(pngBytes(512, 512))],
    ["excessive dimensions", b64(pngBytes(1025, 4))],
    ["not a string", 42],
    ["missing", undefined],
  ];
  for (const [name, payload] of cases) {
    const r = await imageEdit(
      req("erase", { image: audit, mask: audit }),
      config,
      provider(payload),
    );
    assert.equal(r.status, 502, name);
    assert.match(r.headers.get("content-type") ?? "", /json/, name);
    assert.match((await r.json()).error, /artwork is unchanged|no usable image/, name);
  }
});

test("PNG guard rejects decompression bombs and structural tricks before allocating", () => {
  const limits = { maxSide: 1024, maxBytes: 2_000_000 };
  // An 8x8 RGBA header whose IDAT inflates to 4 MB of zeros.
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length),
      v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    let c = 0xffffffff;
    for (const byte of out.subarray(4, 8 + data.length))
      c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    v.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
    return out;
  };
  const ihdr = new Uint8Array(13),
    h = new DataView(ihdr.buffer);
  h.setUint32(0, 8);
  h.setUint32(4, 8);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const build = (...chunks: Uint8Array[]) =>
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
  const bomb = build(
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(new Uint8Array(4_000_000))),
    chunk("IEND", new Uint8Array()),
  );
  assert.throws(() => validatePng(bomb, limits), /larger than its header declares/);
  const scanlines = deflateSync(new Uint8Array(8 * (1 + 8 * 4)));
  assert.equal(
    validatePng(
      build(chunk("IHDR", ihdr), chunk("IDAT", scanlines), chunk("IEND", new Uint8Array())),
      limits,
    ).width,
    8,
  );
  for (const [name, bytes, error] of [
    [
      "unknown critical chunk",
      build(
        chunk("IHDR", ihdr),
        chunk("ABCD", new Uint8Array(1)),
        chunk("IDAT", scanlines),
        chunk("IEND", new Uint8Array()),
      ),
      /critical/,
    ],
    [
      "IDAT split by another chunk",
      build(
        chunk("IHDR", ihdr),
        chunk("IDAT", scanlines.subarray(0, 4)),
        chunk("tEXt", new Uint8Array(2)),
        chunk("IDAT", scanlines.subarray(4)),
        chunk("IEND", new Uint8Array()),
      ),
      /contiguous/,
    ],
    [
      "chunk after IEND",
      build(
        chunk("IHDR", ihdr),
        chunk("IDAT", scanlines),
        chunk("IEND", new Uint8Array()),
        chunk("tEXt", new Uint8Array(1)),
      ),
      /after the PNG end/,
    ],
    [
      "invalid colour format",
      build(
        chunk("IHDR", Uint8Array.from([0, 0, 0, 8, 0, 0, 0, 8, 4, 2, 0, 0, 0])),
        chunk("IDAT", scanlines),
        chunk("IEND", new Uint8Array()),
      ),
      /colour format/,
    ],
    [
      "indexed without palette",
      build(
        chunk("IHDR", Uint8Array.from([0, 0, 0, 8, 0, 0, 0, 8, 8, 3, 0, 0, 0])),
        chunk("IDAT", scanlines),
        chunk("IEND", new Uint8Array()),
      ),
      /palette/,
    ],
  ] as const)
    assert.throws(
      () => validatePng(bytes, limits),
      (e: unknown) => e instanceof PngError && error.test(e.message),
      name,
    );
});
