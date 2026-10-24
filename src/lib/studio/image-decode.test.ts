import test from "node:test";
import assert from "node:assert/strict";
import { boundedBitmap, imageLease, matchingDimensions } from "./image-decode.ts";
import type { ImageInfo } from "./image-policy.ts";
const info: ImageInfo = {
  width: 32,
  height: 24,
  mime: "image/png",
  type: "png",
  frames: 1,
  pixels: 768,
  memory: 1,
  headerBytes: 0,
};
test("bounded decoder closes a mismatching result and never publishes it", async () => {
  let closed = 0;
  const decoder = (async () => ({
    width: 65535,
    height: 65535,
    close() {
      closed++;
    },
  })) as typeof createImageBitmap;
  await assert.rejects(boundedBitmap(new Blob(), info, undefined, decoder), /dimensions/);
  assert.equal(closed, 1);
});
test("orientation transposes the validated plane without relaxing dimensions", () => {
  assert.ok(matchingDimensions(24, 32, info));
  assert.ok(!matchingDimensions(24, 32000, info));
});
test("late decoder responses after cancellation are closed rather than accepted", async () => {
  let finish!: (bitmap: ImageBitmap) => void,
    closed = 0;
  const decoder = (() =>
    new Promise<ImageBitmap>((resolve) => {
      finish = resolve;
    })) as typeof createImageBitmap;
  const controller = new AbortController(),
    pending = boundedBitmap(new Blob(), info, controller.signal, decoder);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(boundedBitmap(new Blob(), info, undefined, decoder), {
    name: "DecodeBusyError",
  });
  finish({
    width: 32,
    height: 24,
    close() {
      closed++;
    },
  } as ImageBitmap);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closed, 1);
});
test("timeout rejects, clears bookkeeping and closes a late bitmap", async () => {
  let finish!: (bitmap: ImageBitmap) => void,
    closed = 0;
  const decoder = (() =>
    new Promise<ImageBitmap>((resolve) => {
      finish = resolve;
    })) as typeof createImageBitmap;
  await assert.rejects(boundedBitmap(new Blob(), info, undefined, decoder, 1), {
    name: "TimeoutError",
  });
  finish({
    width: 32,
    height: 24,
    close() {
      closed++;
    },
  } as ImageBitmap);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed, 1);
});
test("main decode leases serialize temporary surfaces and cancellation does not unlock an active lease", async () => {
  const release = await imageLease();
  const controller = new AbortController();
  const second = imageLease(controller.signal);
  controller.abort();
  await assert.rejects(second, { name: "AbortError" });
  let started = false;
  const third = imageLease().then((next) => {
    started = true;
    return next;
  });
  await Promise.resolve();
  assert.equal(started, false);
  release();
  (await third)();
});
test("decoder failures propagate and an already cancelled request never calls the decoder", async () => {
  const decoder = (async () => {
    throw Error("bad codec");
  }) as typeof createImageBitmap;
  await assert.rejects(boundedBitmap(new Blob(), info, undefined, decoder), /bad codec/);
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  assert.throws(
    () =>
      boundedBitmap(new Blob(), info, controller.signal, (async () => {
        calls++;
      }) as unknown as typeof createImageBitmap),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
});
