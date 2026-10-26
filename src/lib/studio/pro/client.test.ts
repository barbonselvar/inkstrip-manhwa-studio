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
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((e: { data: { id: number; type: string } }) => void) | undefined;
    onerror: unknown;
    constructor() {
      FakeWorker.instances.push(this);
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
    FakeWorker.instances[0]!.onmessage!({ data: { id: 1, type: "ready" } });
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

test("cancelling a merge rejects pending results without changing the input document", async () => {
  const originalWorker = globalThis.Worker,
    originalCanvas = globalThis.OffscreenCanvas;
  let stopped = false;
  class FakeWorker {
    postMessage() {}
    terminate() {
      stopped = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker, OffscreenCanvas: class {} });
  try {
    const document = fromPanel({ id: "p", name: "art", width: 8, height: 8 }),
      before = structuredClone(document),
      renderer = new ProRenderer();
    const pending = renderer.merge(document, 1000, "flatten", [], () => {});
    renderer.dispose();
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(stopped);
    assert.deepEqual(document, before);
  } finally {
    Object.assign(globalThis, { Worker: originalWorker, OffscreenCanvas: originalCanvas });
  }
});

test("repair cancellation rejects pending work without publishing document edits", async () => {
  const originalWorker = globalThis.Worker,
    originalCanvas = globalThis.OffscreenCanvas;
  let terminated = false;
  class FakeWorker {
    postMessage() {}
    terminate() {
      terminated = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker, OffscreenCanvas: class {} });
  try {
    const document = fromPanel({ id: "p", name: "art", width: 8, height: 8 }),
      before = structuredClone(document),
      renderer = new ProRenderer();
    const pending = renderer.repair(document, 1000, {
      kind: "spot",
      layerId: document.layers[0]!.id,
      stroke: {
        points: [{ x: 4, y: 4 }],
        size: 2,
        hardness: 1,
        opacity: 1,
        flow: 1,
        color: "#000000",
        erase: false,
      },
    });
    renderer.dispose();
    await assert.rejects(pending, { name: "AbortError" });
    assert.ok(terminated);
    assert.deepEqual(document, before);
  } finally {
    Object.assign(globalThis, { Worker: originalWorker, OffscreenCanvas: originalCanvas });
  }
});

test("R8 latest previews retain one active worker job and replace intermediate queued edits", async () => {
  const originalWorker = globalThis.Worker,
    originalCanvas = globalThis.OffscreenCanvas;
  let posted: () => void = () => {};
  class FakeWorker {
    static current: FakeWorker;
    messages: { id: number; type: string; document?: { name: string } }[] = [];
    onmessage:
      | ((e: { data: { id: number; type: string; bitmap?: { close: () => void } } }) => void)
      | undefined;
    constructor() {
      FakeWorker.current = this;
    }
    postMessage(m: { id: number; type: string; document?: { name: string } }) {
      this.messages.push(m);
      posted();
    }
    terminate() {}
  }
  Object.assign(globalThis, { Worker: FakeWorker, OffscreenCanvas: class {} });
  try {
    const r = new ProRenderer(),
      doc = fromPanel({ id: "p", name: "one", width: 8, height: 8 }),
      first = r.renderLatest(doc, 1000),
      firstResult = first.then(
        () => "resolved",
        (e) => e.name,
      ),
      second = r.renderLatest({ ...doc, name: "two" }, 1000),
      secondResult = second.then(
        () => "resolved",
        (e) => e.name,
      ),
      last = r.renderLatest({ ...doc, name: "three" }, 1000),
      w = FakeWorker.current;
    assert.equal(w.messages.length, 1);
    let closed = 0;
    const dispatched = new Promise<void>((resolve) => {
      posted = () => {
        if (w.messages.length === 2) resolve();
      };
    });
    w.onmessage!({
      data: { id: w.messages[0]!.id, type: "preview", bitmap: { close: () => closed++ } },
    });
    await dispatched;
    assert.equal(await firstResult, "AbortError");
    assert.equal(await secondResult, "AbortError");
    assert.equal(closed, 1);
    assert.equal(w.messages.length, 2);
    assert.equal(w.messages[1]!.document!.name, "three");
    const bitmap = { close: () => closed++ };
    w.onmessage!({ data: { id: w.messages[1]!.id, type: "preview", bitmap } });
    assert.equal((await last).bitmap, bitmap);
    bitmap.close();
    r.dispose();
  } finally {
    Object.assign(globalThis, { Worker: originalWorker, OffscreenCanvas: originalCanvas });
  }
});
test("R8 latest preview disposal rejects active and queued work without dispatching a stale job", async () => {
  const originalWorker = globalThis.Worker,
    originalCanvas = globalThis.OffscreenCanvas;
  class FakeWorker {
    static current: FakeWorker;
    messages = 0;
    stopped = false;
    constructor() {
      FakeWorker.current = this;
    }
    postMessage() {
      this.messages++;
    }
    terminate() {
      this.stopped = true;
    }
  }
  Object.assign(globalThis, { Worker: FakeWorker, OffscreenCanvas: class {} });
  try {
    const r = new ProRenderer(),
      d = fromPanel({ id: "p", name: "stop", width: 8, height: 8 }),
      a = r.renderLatest(d, 1000),
      b = r.renderLatest(d, 1000),
      assertA = assert.rejects(a, { name: "AbortError" }),
      assertB = assert.rejects(b, { name: "AbortError" });
    r.dispose();
    await Promise.all([assertA, assertB]);
    assert.equal(FakeWorker.current.messages, 1);
    assert.equal(FakeWorker.current.stopped, true);
    await assert.rejects(r.renderLatest(d, 1000), /closed/);
  } finally {
    Object.assign(globalThis, { Worker: originalWorker, OffscreenCanvas: originalCanvas });
  }
});
