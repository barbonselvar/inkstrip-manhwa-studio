import test from "node:test";
import assert from "node:assert/strict";
import { EnhancementEngine } from "../enhance/client.ts";
import { DEFAULT_ENHANCE } from "../enhance/types.ts";
test("the restoration runtime reuses a completed worker and cancellation isolates a later worker", async () => {
  const original = globalThis.Worker;
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    constructor() {
      FakeWorker.instances.push(this);
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker });
  const engine = new EnhancementEngine(),
    blob = new Blob(["fixture"], { type: "image/png" });
  try {
    const first = engine.run(blob, DEFAULT_ENHANCE, () => {});
    FakeWorker.instances[0]!.onmessage!({
      data: { type: "result", result: { blob, width: 1, height: 1 } },
    });
    await first;
    const warm = engine.run(blob, DEFAULT_ENHANCE, () => {});
    assert.equal(FakeWorker.instances.length, 1);
    engine.dispose();
    await assert.rejects(warm, { name: "AbortError" });
    assert.equal(FakeWorker.instances[0]!.terminated, true);
    const next = engine.run(blob, DEFAULT_ENHANCE, () => {});
    assert.equal(FakeWorker.instances.length, 2);
    FakeWorker.instances[1]!.onmessage!({
      data: { type: "result", result: { blob, width: 1, height: 1 } },
    });
    await next;
  } finally {
    engine.dispose();
    Object.assign(globalThis, { Worker: original });
  }
});
