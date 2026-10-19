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
test("superseding previews retain initialization and closed workers reject new work", async () => {
  const originalWorker = globalThis.Worker,
    originalCanvas = globalThis.OffscreenCanvas;
  let instance: FakeWorker;
  class FakeWorker {
    onmessage: ((e: { data: { id: number; type: string } }) => void) | undefined;
    onerror: unknown;
    constructor() {
      instance = this;
    }
    postMessage() {}
    terminate() {}
  }
  Object.assign(globalThis, { Worker: FakeWorker, OffscreenCanvas: class {} });
  try {
    const r = new ProRenderer(),
      document = fromPanel({ id: "p", name: "art", width: 8, height: 8 });
    const initializing = r.init({
      document,
      assets: {},
      revision: 0,
      acceptedBlobId: "old",
      updatedAt: 0,
    });
    const first = r.render(document, 1000);
    instance!.onmessage!({ data: { id: 1, type: "ready" } });
    await initializing;
    const next = r.render(document, 1000);
    await assert.rejects(first, { name: "AbortError" });
    r.dispose();
    await assert.rejects(next, { name: "AbortError" });
    await assert.rejects(r.render(document, 1000), /worker is closed/);
  } finally {
    Object.assign(globalThis, { Worker: originalWorker, OffscreenCanvas: originalCanvas });
  }
});
