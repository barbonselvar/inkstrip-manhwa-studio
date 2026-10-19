import { test } from "node:test";
import assert from "node:assert/strict";
import { ProRenderer } from "./client.ts";
import { fromPanel } from "./model.ts";
test("worker cancellation rejects pending preview and terminates rendering resources", async () => {
  const originalWorker = globalThis.Worker,
    originalCanvas = globalThis.OffscreenCanvas;
  let stopped = false;
  class FakeWorker {
    onmessage: ((e: unknown) => void) | undefined;
    onerror: unknown;
    postMessage() {}
    terminate() {
      stopped = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker, OffscreenCanvas: class {} });
  try {
    const renderer = new ProRenderer(),
      pending = renderer.render(fromPanel({ id: "p", name: "art", width: 8, height: 8 }), 1000);
    renderer.dispose();
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(stopped);
  } finally {
    Object.assign(globalThis, { Worker: originalWorker, OffscreenCanvas: originalCanvas });
  }
});
