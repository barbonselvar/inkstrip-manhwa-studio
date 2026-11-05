import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionCapabilities, requestExtension, type ExtensionProvider } from "./ai.ts";
test("AI remains explicitly unavailable without a compatible backend", async () => {
  assert.equal((await extensionCapabilities()).available, false);
  await assert.rejects(
    requestExtension(undefined, {
      source: new Blob(["source"]),
      edge: "top",
      pixels: 300,
      signal: new AbortController().signal,
    }),
    /No compatible/,
  );
});
test("failed or malformed capability probes cannot enable AI controls", async () => {
  const p = {
    capabilities: async () => {
      throw Error("Backend offline");
    },
    extend: async () => {
      throw Error("Must not run");
    },
  };
  assert.equal((await extensionCapabilities(p)).available, false);
  assert.match((await extensionCapabilities(p)).reason!, /offline/);
});
test("cancellation and unsupported edges stop before any extension call", async () => {
  let calls = 0;
  const p: ExtensionProvider = {
    capabilities: async () => ({
      available: true,
      name: "Test adapter contract",
      edges: ["bottom"],
      maxPixels: 100000,
    }),
    extend: async () => {
      calls++;
      return new Blob(["fixture"], { type: "image/png" });
    },
  };
  await assert.rejects(
    requestExtension(p, {
      source: new Blob(["source"]),
      edge: "top",
      pixels: 300,
      signal: new AbortController().signal,
    }),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(extensionCapabilities(p, abort.signal));
  assert.equal(calls, 0);
});
