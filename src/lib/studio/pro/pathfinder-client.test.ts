import { test } from "node:test";
import assert from "node:assert/strict";
import { PathfinderJob } from "./pathfinder-client.ts";
import { fromPanel } from "./model.ts";
class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  input: unknown;
  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(input: unknown) {
    this.input = input;
  }
  terminate() {
    this.terminated = true;
  }
}
const d = fromPanel({ id: "p", name: "worker", width: 128, height: 96 });
function install() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: FakeWorker,
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "Worker", original);
    else Reflect.deleteProperty(globalThis, "Worker");
  };
}
test("geometry worker receives metadata only, resolves and is terminated after success", async () => {
  const restore = install();
  try {
    const job = new PathfinderJob(d, ["a", "b"], "unite", { tolerance: 0.1 }),
      worker = FakeWorker.latest;
    assert.deepEqual(worker.input, {
      document: d,
      ids: ["a", "b"],
      operation: "unite",
      options: { tolerance: 0.1 },
    });
    worker.onmessage!({
      data: { result: { document: d, ids: [], operation: "unite", tolerance: 0.1 } },
    });
    assert.equal((await job.result).document, d);
    assert.ok(worker.terminated);
  } finally {
    restore();
  }
});
test("cancellation rejects the transaction, terminates its worker and leaves source data unchanged", async () => {
  const restore = install();
  try {
    const before = structuredClone(d),
      job = new PathfinderJob(d, [], "unite", {});
    job.cancel();
    await assert.rejects(job.result, { name: "AbortError" });
    assert.ok(FakeWorker.latest.terminated);
    assert.deepEqual(d, before);
    job.cancel();
  } finally {
    restore();
  }
});
test("worker failures and geometric errors are visible and cannot commit partial geometry", async () => {
  const restore = install();
  try {
    for (const crash of [true, false]) {
      const job = new PathfinderJob(d, [], "divide", {});
      if (crash) FakeWorker.latest.onerror!();
      else FakeWorker.latest.onmessage!({ data: { error: "Geometry budget exceeded" } });
      await assert.rejects(job.result, /worker stopped|budget/);
      assert.ok(FakeWorker.latest.terminated);
    }
  } finally {
    restore();
  }
});
test("a geometry time budget terminates synchronous clipping even when the worker cannot reply", async (t) => {
  const restore = install();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const job = new PathfinderJob(d, [], "divide", {});
    t.mock.timers.tick(12000);
    await assert.rejects(job.result, /12-second/);
    assert.ok(FakeWorker.latest.terminated);
  } finally {
    t.mock.timers.reset();
    restore();
  }
});
