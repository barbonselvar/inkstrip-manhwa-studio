import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPanel, layer, type ProSession } from "./model.ts";
import {
  createCheckpoint,
  verifyCheckpoint,
  validateCheckpointHeader,
  retainedCheckpoints,
  CHECKPOINT_MAX_TOTAL,
} from "./recovery.ts";
import { advancedGradient } from "./gradient.ts";
import { defaultOperation } from "./color-engine.ts";
import { canonicalNative } from "./adjustment-schema.ts";
import { CheckpointQueue } from "./checkpoint-queue.ts";
import { draftSaveStatus, saveFailure, acknowledgeDraft } from "./save-status.ts";
import { documentAssetIds, analyzeAssetReachability } from "./asset-references.ts";
import { createHistory, record, undo, redo } from "../editor/history.ts";
import { nativeFile, readNative } from "./files.ts";

function session(version: 1 | 2 | 3 = 1): ProSession {
  const document = fromPanel({ id: "page", name: "Original", width: 8, height: 8 });
  document.version = version;
  if (version >= 2) {
    const a = layer("adjustment", 8, 8, "adjustment");
    const operation = defaultOperation("levels");
    if (operation.kind !== "levels") throw Error("Expected Levels fixture.");
    a.adjustmentLayer = { version: 1, operation };
    document.layers.push(a);
  }
  if (version === 3) {
    const g = layer("gradient", 8, 8, "fill");
    g.gradient = advancedGradient();
    g.smartFilters = [{ id: "filter", enabled: true, operation: { kind: "gaussian", radius: 1 } }];
    document.layers.push(g);
  }
  return {
    document,
    assets: { source: new Blob(["exact immutable bytes"], { type: "image/png" }) },
    revision: 4,
    acceptedBlobId: "accepted",
    updatedAt: 100,
  };
}
for (const version of [1, 2, 3] as const)
  test(`checkpoint round trip preserves native schema${version}, all settings and source bytes`, async () => {
    const s = session(version),
      cp = await createCheckpoint(s, "checkpoint", 200),
      reopened = await verifyCheckpoint(cp);
    assert.equal(
      JSON.parse(await cp.native.text()).version,
      version === 1 ? 1 : version === 2 ? 8 : 9,
    );
    assert.equal(canonicalNative(reopened.document), canonicalNative(s.document));
    assert.equal(reopened.revision, s.revision);
    assert.equal(reopened.updatedAt, s.updatedAt);
    assert.equal(await reopened.assets.source!.text(), await s.assets.source!.text());
    const again = await createCheckpoint(s, "checkpoint", 200);
    assert.deepEqual(again.header, cp.header);
    assert.equal(await again.native.text(), await cp.native.text());
  });
test("checkpoint identity, revision, future versions, unsafe keys and content corruption fail closed", async () => {
  const cp = await createCheckpoint(session(), "checkpoint", 200);
  for (const patch of [
    { version: 2 },
    { revision: 0 },
    { revision: 1.5 },
    { createdAt: Infinity },
    { nativeBytes: 70_000_001 },
    { nativeSha256: "bad" },
    { documentId: "" },
    { unexpected: true },
  ])
    assert.throws(() => validateCheckpointHeader({ ...cp.header, ...patch }));
  assert.throws(() => validateCheckpointHeader(JSON.parse('{"__proto__":{}}')), /Unsafe/);
  await assert.rejects(
    verifyCheckpoint({ ...cp, header: { ...cp.header, revision: 5 } }),
    /integrity/,
  );
  await assert.rejects(
    verifyCheckpoint({ ...cp, native: new Blob(["corrupt"], { type: "application/json" }) }),
    /integrity/,
  );
  const bytes = new Uint8Array(await cp.native.arrayBuffer());
  bytes[bytes.length - 3] ^= 1;
  await assert.rejects(
    verifyCheckpoint({ ...cp, native: new Blob([bytes], { type: "application/json" }) }),
    /integrity/,
  );
  await assert.rejects(createCheckpoint({ ...session(), revision: 0 }), /metadata/);
  const missing = session();
  delete missing.assets.source;
  await assert.rejects(createCheckpoint(missing), /missing/);
});
test("retention keeps three versions per page with a bounded shared byte budget", async () => {
  const cp = await createCheckpoint(session(), "base", 200);
  const headers = Array.from({ length: 12 }, (_, i) => ({
    ...cp.header,
    id: `cp-${i}`,
    panelId: i < 6 ? "page" : "other",
    revision: i + 1,
    createdAt: i,
    nativeBytes: 30_000_000,
  }));
  const retained = retainedCheckpoints(headers, "cp-2");
  assert.equal(
    retained[0]!.id,
    "cp-2",
    "newly committed checkpoint is pinned even at equal/older timestamps",
  );
  assert.ok(retained.reduce((n, h) => n + h.nativeBytes, 0) <= CHECKPOINT_MAX_TOTAL);
  for (const page of ["page", "other"])
    assert.ok(retained.filter((h) => h.panelId === page).length <= 3);
  assert.deepEqual(
    headers.map((h) => h.id),
    Array.from({ length: 12 }, (_, i) => `cp-${i}`),
    "input index remains immutable",
  );
  assert.throws(() => retainedCheckpoints([cp.header, cp.header], cp.header.id), /Duplicate/);
});
test("late older checkpoint workers cannot evict newer confirmed revisions", async () => {
  const cp = await createCheckpoint(session(), "base", 200);
  let headers = [8, 7, 6].map((revision) => ({
    ...cp.header,
    id: `new-${revision}`,
    revision,
    createdAt: revision,
    savedAt: revision,
  }));
  for (const revision of [1, 2, 3]) {
    const old = {
      ...cp.header,
      id: `late-${revision}`,
      revision,
      createdAt: 1000 + revision,
      savedAt: revision,
    };
    headers = retainedCheckpoints([...headers, old], old.id);
    assert.ok(
      headers.some((h) => h.revision === 8),
      "latest confirmed revision survives late worker completion",
    );
  }
});
test("checkpoint queue coalesces rapid confirmed revisions and survives failed/interrupted writes", async () => {
  const writes: number[] = [],
    outcomes: string[] = [];
  let release: (() => void) | undefined;
  const q = new CheckpointQueue(
    async (s) => {
      writes.push(s.revision);
      if (s.revision === 1)
        await new Promise<void>((r) => {
          release = r;
        });
      if (s.revision === 3) throw new DOMException("Storage full", "QuotaExceededError");
      return s.revision;
    },
    (s, result) => outcomes.push(`${s.revision}:${"value" in result ? "stored" : "failed"}`),
  );
  q.enqueue({ ...session(), revision: 1 });
  q.enqueue({ ...session(), revision: 2 });
  q.enqueue({ ...session(), revision: 3 });
  let flushed = false;
  const flushedPromise = q.flush().then(() => {
    flushed = true;
  });
  await Promise.resolve();
  assert.equal(flushed, false);
  release!();
  await flushedPromise;
  assert.deepEqual(writes, [1, 3]);
  assert.deepEqual(outcomes, ["1:stored", "3:failed"]);
  q.enqueue({ ...session(), revision: 4 });
  await q.flush();
  assert.deepEqual(writes, [1, 3, 4]);
});
test("save status follows acknowledged primary state, not rendering or checkpoint results", () => {
  assert.equal(draftSaveStatus(true, 0, false, null).state, "unsaved");
  assert.equal(draftSaveStatus(true, 1, false, null).state, "saving");
  assert.equal(draftSaveStatus(true, 0, true, null).label, "Draft saved");
  const quota = saveFailure(new DOMException("full", "QuotaExceededError"));
  assert.equal(draftSaveStatus(true, 0, false, quota).label, "Save failed");
  assert.match(quota.message, /export a native backup/);
  assert.equal(
    draftSaveStatus(true, 0, false, saveFailure(new DOMException("denied", "SecurityError"))).label,
    "Storage unavailable",
  );
});
test("late acknowledgement retains new immutable assets and never redirects to another page", () => {
  const next = session(),
    live = {
      ...session(),
      assets: { ...session().assets, new: new Blob(["new"], { type: "image/png" }) },
    };
  const doc = { ...live.document, name: "Newer settings" };
  const merged = acknowledgeDraft(next, live, doc);
  assert.equal(merged.document, doc);
  assert.ok(merged.assets.new);
  assert.equal(merged.revision, next.revision);
  const other = { ...live, document: { ...doc, panelId: "other" } };
  assert.equal(acknowledgeDraft(next, other, other.document), other);
  const recovered = { ...live, recoveryId: "different-recovery-lineage" };
  assert.equal(acknowledgeDraft(next, recovered, recovered.document), recovered);
});
test("reachability retains Undo, Redo, pending, render and checkpoint roots; deletion remains disabled", async () => {
  const s = session(),
    hidden = layer("raster", 8, 8, "hidden");
  hidden.assetId = "hidden";
  hidden.visible = false;
  const old = { ...s.document, layers: [...s.document.layers, hidden] };
  let h = record(createHistory(old), { ...s.document, name: "Current" });
  h = undo(h);
  const b = new Blob(["retained"], { type: "image/png" });
  s.assets = { ...s.assets, hidden: b, pending: b, rendering: b, checkpoint: b, unused: b };
  const root = (id: string) => ({ ...s.document, layers: [{ ...hidden, id, assetId: id }] });
  const roots = {
    undo: redo(h).past,
    redo: h.future,
    pending: [root("pending")],
    rendering: [root("rendering")],
    checkpoints: [root("checkpoint")],
  };
  const analysis = analyzeAssetReachability(s, roots);
  assert.deepEqual(analysis.candidates, ["unused"]);
  assert.deepEqual(analysis.missing, []);
  assert.equal(analysis.deletionSafe, false);
  assert.ok(documentAssetIds(old).has("hidden"));
  const reopened = await readNative(await nativeFile(s), "page", "accepted");
  assert.deepEqual(Object.keys(reopened.assets), ["source"]);
  assert.deepEqual(Object.keys(s.assets).sort(), [
    "checkpoint",
    "hidden",
    "pending",
    "rendering",
    "source",
    "unused",
  ]);
  assert.equal(redo(h).present.name, "Current");
  assert.equal(undo(redo(h)).present.layers.at(-1)!.assetId, "hidden");
});
