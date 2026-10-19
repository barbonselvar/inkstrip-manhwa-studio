import { test } from "node:test";
import assert from "node:assert/strict";
import { imageEdit } from "./image-edit.server.ts";
function png() {
  const b = new Uint8Array(24);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x89504e47);
  v.setUint32(4, 0x0d0a1a0a);
  v.setUint32(16, 1024);
  v.setUint32(20, 1024);
  return new Blob([b], { type: "image/png" });
}
function req(op = "erase") {
  const f = new FormData();
  f.set("image", png(), "i.png");
  f.set("mask", png(), "m.png");
  f.set("operation", op);
  if (op === "face") f.set("reference", png(), "r.png");
  return new Request("https://studio.test/api/studio/ai-edit", {
    method: "POST",
    headers: { origin: "https://studio.test", "x-inkstrip-access": "test-code" },
    body: f,
  });
}
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
    const result = await imageEdit(
      req(op),
      { key: "test-key", access: "test-code" },
      async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/images/edits");
        const body = init!.body as FormData;
        assert.equal(body.get("model"), "gpt-image-1");
        assert.equal(body.getAll("image[]").length, op === "face" ? 2 : 1);
        assert.ok(body.get("mask"));
        called = true;
        return Response.json({
          data: [{ b64_json: Buffer.from(await png().arrayBuffer()).toString("base64") }],
        });
      },
    );
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.ok(called);
  }
});
test("provider errors stay generic, never relay private response or credentials", async () => {
  const r = await imageEdit(
    req(),
    { key: "test", access: "test-code" },
    async () => new Response("private", { status: 429 }),
  );
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes("private"));
});
