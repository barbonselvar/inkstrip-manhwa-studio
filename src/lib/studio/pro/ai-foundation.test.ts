import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, validateAssets, validateDocument, type ProSession } from "./model.ts";
import { acceptAiResult } from "./ai-result.ts";
import { validateAiReceipt, type AiReceipt } from "./ai-receipt.ts";
import { nativeFile, readNative, mergeNativeSession } from "./files.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { duplicateLayers } from "./layers.ts";
import { planRegion, assertFresh } from "../ai/plan.ts";
import { SWIN, localCapability, CANDIDATES } from "../ai/registry.ts";
import { gpuEndpoint, validateCapabilities, discoverGpu } from "../ai/connector.ts";
import { blendClippedPixels } from "./clipping.ts";
const png = () => new Blob([Uint8Array.of(1, 2, 3)], { type: "image/png" });
function session(): ProSession {
  return {
    document: fromPanel({ id: "panel", name: "Original", width: 64, height: 48 }),
    assets: { source: png() },
    revision: 0,
    acceptedBlobId: "accepted",
    updatedAt: 0,
  };
}
function receipt(): AiReceipt {
  return {
    version: 1,
    task: "restoration",
    composite: "preserve-alpha",
    modelId: SWIN.id,
    modelRevision: SWIN.revision,
    weightsSha256: SWIN.sha256,
    backend: "browser-wasm",
    sourceAssetId: "snapshot",
    sourceWidth: 64,
    sourceHeight: 48,
    sourceDocumentSha256: "a".repeat(64),
    region: { x: 8, y: 8, width: 16, height: 16 },
    settings: { denoise: 0, sharpen: 0, color: false, artifacts: false },
    createdAt: 0,
    elapsedMs: 20,
  };
}
test("AI acceptance preserves all source layers, IDs, selection frames and Chapter revision; one undoable layer", () => {
  const s = session();
  s.document.layers[0]!.mask = {
    enabled: true,
    selection: { regions: [], inverted: true, feather: 0 },
    strokes: [],
  };
  s.document.selection = {
    regions: [
      {
        kind: "rectangle",
        operation: "add",
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
      },
    ],
    inverted: false,
    feather: 1,
  };
  const r = receipt();
  r.selection = structuredClone(s.document.selection);
  const next = acceptAiResult(s, r, png(), png(), 4e6, r.selection).session;
  assert.equal(next.document.layers[0], s.document.layers[0]);
  assert.equal(next.document.selection, s.document.selection);
  assert.equal(s.document.layers.length, 1);
  assert.equal(next.acceptedBlobId, "accepted");
  assert.equal(next.assets.source, s.assets.source);
  const l = next.document.layers[1]!;
  assert.equal(l.transform.x, 8);
  assert.equal(l.width, 16);
  assert.equal(l.mask?.width, 64);
  assert.deepEqual(l.mask?.selection, s.document.selection);
  const h = record(createHistory(s.document), next.document);
  assert.deepEqual(undo(h).present, s.document);
  assert.deepEqual(redo(undo(h)).present, next.document);
});
test("AI portable v6 retains referenced source snapshots once, remaps import IDs and reads old v5", async () => {
  const s = acceptAiResult(session(), receipt(), png(), png(), 4e6).session;
  s.assets.unused = png();
  const file = await nativeFile(s),
    v = JSON.parse(await file.text());
  assert.equal(v.version, 6);
  assert.equal(v.assets.unused, undefined);
  assert.ok(v.assets.snapshot);
  const restored = await readNative(file, "another", "accepted");
  assert.deepEqual(restored.document.layers, s.document.layers);
  const imported = mergeNativeSession(session(), restored);
  validateAssets(imported);
  const a = imported.document.layers[1]!.ai!;
  assert.notEqual(a.sourceAssetId, "snapshot");
  assert.ok(imported.assets[a.sourceAssetId]);
  assert.notEqual(imported.document.layers[1]!.assetId, s.document.layers[1]!.assetId);
  const old = JSON.parse(await (await nativeFile(session())).text());
  old.version = 5;
  const legacy = await readNative(new Blob([JSON.stringify(old)]), "panel", "accepted");
  assert.equal(legacy.document.layers.length, 1);
});
test("duplicate/delete/hide/opacity/blend preserve AI provenance without copying assets", () => {
  const s = acceptAiResult(session(), receipt(), png(), png(), 4e6).session,
    d = duplicateLayers(s.document, [s.document.layers[1]!.id]).document;
  assert.equal(d.layers[1]!.assetId, d.layers[2]!.assetId);
  assert.deepEqual(d.layers[1]!.ai, d.layers[2]!.ai);
  d.layers[2]!.visible = false;
  d.layers[1]!.opacity = 0.4;
  d.layers[1]!.blend = "multiply";
  validateAssets({ ...s, document: d });
});
test("missing receipt sources, invalid metadata/coordinates/settings/secrets fail atomically", () => {
  const base = session();
  for (const bad of [
    { sourceWidth: NaN },
    { sourceWidth: 0 },
    { elapsedMs: Infinity },
    { weightsSha256: "bad" },
    { token: "secret" },
    { region: { x: 63, y: 0, width: 2, height: 1 } },
    { settings: { denoise: -1, sharpen: 0, color: false, artifacts: false } },
  ])
    assert.throws(() =>
      acceptAiResult(base, { ...receipt(), ...bad } as AiReceipt, png(), png(), 4e6),
    );
  assert.equal(base.document.layers.length, 1);
  const accepted = acceptAiResult(base, receipt(), png(), png(), 4e6).session;
  delete accepted.assets.snapshot;
  assert.throws(() => validateAssets(accepted), /immutable input/);
  const d = structuredClone(base.document);
  d.layers[0]!.ai = { ...receipt(), selection: { regions: [], inverted: false, feather: NaN } };
  assert.throws(() => validateDocument(d));
});
test("source budgets reject oversized acceptance with unchanged document and pool", () => {
  const s = session();
  assert.throws(
    () =>
      acceptAiResult(
        s,
        receipt(),
        new Blob([new Uint8Array(48_000_001)], { type: "image/png" }),
        png(),
        4e6,
      ),
    /48MB/,
  );
  assert.equal(s.document.layers.length, 1);
  assert.deepEqual(Object.keys(s.assets), ["source"]);
});
test("region planning preserves pixel dimensions and adds clipped context, never implicit downscaling", () => {
  assert.deepEqual(planRegion(100, 100, { x: 3, y: 4, width: 10, height: 12 }), {
    x: 0,
    y: 0,
    width: 29,
    height: 32,
  });
  assert.deepEqual(planRegion(12, 20, undefined, 0), { x: 0, y: 0, width: 12, height: 20 });
  assert.throws(() => planRegion(4096, 4096), /no resolution was reduced/);
  assert.throws(() => planRegion(100, 100, { x: 99, y: 0, width: 2, height: 1 }));
  assert.throws(() => planRegion(NaN, 10));
});
test("document edit, source change and malformed provenance cannot be accepted as fresh", () => {
  assert.doesNotThrow(() => assertFresh("same", "same", "a", "a"));
  assert.throws(() => assertFresh("old", "new", "a", "a"), /changed/);
  assert.throws(() => assertFresh("same", "same", "a", "b"), /changed/);
  assert.throws(() =>
    validateAiReceipt({ ...receipt(), sourceDocumentSha256: "javascript:alert(1)" }),
  );
});
test("restoration overlay mathematically preserves alpha for opaque, half alpha and transparent pixels", () => {
  const b = Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 128, 0, 0, 0, 0]);
  const o = Uint8ClampedArray.from([100, 150, 200, 128, 100, 150, 200, 255, 255, 255, 255, 255]);
  const v = blendClippedPixels(b, o, 1, "source-over");
  assert.deepEqual([v[3], v[7], v[11]], [255, 128, 0]);
  assert.deepEqual([...v.slice(4, 8)], [100, 150, 200, 128]);
  assert.deepEqual([...v.slice(8)], [0, 0, 0, 0]);
});
test("registry exposes existing local runtime honestly, candidates remain unqualified", () => {
  assert.equal(localCapability({ worker: true, canvas: true, wasm: true }).available, true);
  assert.equal(localCapability({ worker: true, canvas: false, wasm: true }).available, false);
  assert.equal(SWIN.sha256.length, 64);
  assert.ok(CANDIDATES.find((c) => c.id === "codeformer")!.reason.startsWith("Excluded"));
});
test("GPU endpoint rejects private IPs, credentials, non-HTTPS, redirects targets and ambiguous URLs", () => {
  for (const u of [
    "http://gpu.example.org",
    "https://127.0.0.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://[::1]",
    "https://host.local",
    "https://localhost",
    "https://gpu.internal",
    "https://user:password@gpu.example.org",
    "https://gpu.example.org:8080",
    "https://gpu.example.org/path",
    "https://gpu.example.org?token=x",
    "https://gpu.example.org#frag",
  ])
    assert.throws(() => gpuEndpoint(u));
  assert.equal(gpuEndpoint("https://gpu.example.org/"), "https://gpu.example.org");
});
const capability = {
  protocol: "inkstrip-gpu/1",
  retention: "User-configured; no guarantee",
  models: [
    {
      id: "lama",
      revision: "v1",
      task: "inpainting",
      codeLicense: "Apache-2.0",
      weightsLicense: "Unqualified",
    },
  ],
};
test("GPU discovery is metadata-only GET, omits cookies/referrer, rejects redirects and never includes artwork", async () => {
  let calls = 0;
  const fake = (async (url: unknown, options: RequestInit) => {
    calls++;
    assert.equal(url, "https://gpu.example.org/v1/capabilities");
    assert.equal(options.body, undefined);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal((options.headers as Record<string, string>).Authorization, "Bearer temporary");
    return new Response(JSON.stringify({ ...capability, artifactUrl: "javascript:bad" }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const v = await discoverGpu("https://gpu.example.org", "temporary", undefined, fake);
  assert.equal(calls, 1);
  assert.equal("artifactUrl" in v, false);
  assert.equal(v.models[0]!.id, "lama");
});
test("GPU malformed, oversized, HTML, failure and duplicate models fail safely", async () => {
  for (const response of [
    new Response("bad", { status: 401 }),
    new Response("<script/>", { headers: { "Content-Type": "text/html" } }),
    new Response("x".repeat(65537), { headers: { "Content-Type": "application/json" } }),
    new Response("{", { headers: { "Content-Type": "application/json" } }),
  ])
    await assert.rejects(
      discoverGpu("https://gpu.example.org", "", undefined, (async () => response) as typeof fetch),
    );
  assert.throws(() =>
    validateCapabilities({ ...capability, models: [capability.models[0], capability.models[0]] }),
  );
  await assert.rejects(
    discoverGpu("https://gpu.example.org", "bad\nheader", undefined, (async () => {
      throw Error("must not fetch");
    }) as typeof fetch),
    /credential/,
  );
});

test("benchmark integrity metrics detect out-of-mask, alpha and pixel changes without inventing quality scores", async () => {
  const { integrityMetrics } = await import("../ai/benchmark.ts");
  const a = Uint8ClampedArray.from([0, 0, 0, 0, 100, 100, 100, 255]),
    b = Uint8ClampedArray.from([0, 0, 0, 0, 110, 110, 110, 255]);
  assert.deepEqual(integrityMetrics(a, b, Uint8Array.of(0, 255)), {
    protectedPixels: 1,
    protectedMaxError: 0,
    alphaChanges: 0,
    changedPixels: 1,
    meanChannelChange: 5,
  });
  b[3] = 10;
  assert.equal(integrityMetrics(a, b, Uint8Array.of(0, 255)).protectedMaxError, 10);
  assert.throws(() => integrityMetrics(a, b, Uint8Array.of(1)));
});

test("an already cancelled GPU request never reaches the network, and control characters never enter auth headers", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fake = (async () => {
    calls++;
    throw Error("must not fetch");
  }) as typeof fetch;
  await assert.rejects(
    discoverGpu("https://gpu.example.org", "", controller.signal, fake),
    (e) => (e as Error).name === "AbortError",
  );
  for (const token of ["bad\tvalue", "bad\u0000value", "not-ascii-\u00e9"])
    await assert.rejects(
      discoverGpu("https://gpu.example.org", token, undefined, fake),
      /credential/,
    );
  assert.equal(calls, 0);
});

test("v1–v6 representative feature envelopes round-trip without dropping legacy or AI data", async () => {
  const { layer } = await import("./model.ts");
  for (let version = 1; version <= 6; version++) {
    let s = session();
    if (version >= 2) {
      const path = layer("shape", 64, 48);
      path.shape = "path";
      path.anchors = [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 40 },
      ];
      path.closed = true;
      path.fillRule = "evenodd";
      path.subpaths = [
        {
          anchors: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
          ],
          closed: true,
        },
      ];
      s.document.layers.push(path);
    }
    if (version >= 3)
      s.document.artboards = [
        {
          id: "board",
          name: "Artwork",
          x: 0,
          y: 0,
          width: 64,
          height: 48,
          background: "transparent",
        },
      ];
    if (version >= 4) s.document.layers[1]!.appearance = [];
    if (version >= 5)
      s.document.layers[0]!.mask = {
        enabled: true,
        selection: { regions: [], inverted: true, feather: 0 },
        strokes: [],
        density: 0.7,
        feather: 1,
      };
    if (version === 6) s = acceptAiResult(s, receipt(), png(), png(), 4e6).session;
    const file = await nativeFile(s);
    assert.equal(JSON.parse(await file.text()).version, version);
    const restored = await readNative(file, "panel", "accepted");
    assert.deepEqual(restored.document, s.document);
    for (const id of Object.keys(restored.assets))
      assert.deepEqual(await restored.assets[id]!.arrayBuffer(), await s.assets[id]!.arrayBuffer());
  }
});
test("v6 repeated save/import cycles retain shared sources once and reject corrupt envelopes atomically", async () => {
  let s = acceptAiResult(session(), receipt(), png(), png(), 4e6).session;
  const original = s.document;
  for (let n = 0; n < 8; n++) {
    const file = await nativeFile(s),
      envelope = JSON.parse(await file.text());
    assert.equal(Object.keys(envelope.assets).length, 3);
    const incoming = await readNative(file, "panel", "accepted");
    s = mergeNativeSession(s, incoming);
    assert.deepEqual(s.document.layers.at(-1)!.ai!.settings, receipt().settings);
  }
  const v = JSON.parse(await (await nativeFile(s)).text());
  for (const alter of [
    (x: typeof v) => (x.version = 7),
    (x: typeof v) => delete x.assets[x.document.layers.at(-1).ai.sourceAssetId],
    (x: typeof v) => (x.document.layers.at(-1).ai.settings.token = "secret"),
    (x: typeof v) => (x.assets = undefined),
  ]) {
    const bad = structuredClone(v);
    alter(bad);
    await assert.rejects(readNative(new Blob([JSON.stringify(bad)]), "panel", "accepted"));
  }
  await assert.rejects(readNative(new Blob(['{"format":']), "panel", "accepted"));
  await assert.rejects(
    readNative(new Blob([new Uint8Array(70_000_001)]), "panel", "accepted"),
    /70MB/,
  );
  assert.equal(original.layers.length, 2);
});
