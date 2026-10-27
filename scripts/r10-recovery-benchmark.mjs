import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const p = await browser.newPage(),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).waitFor();
  const results = await p.evaluate(async () => {
    const { canonicalNative } = await import("/src/lib/studio/pro/adjustment-schema.ts");
    const { fromPanel } = await import("/src/lib/studio/pro/model.ts"),
      { advancedEffect } = await import("/src/lib/studio/pro/effects.ts"),
      { saveSession, loadSession } = await import("/src/lib/studio/pro/storage.ts"),
      { listCheckpoints, readCheckpoint, verifyCheckpoint } =
        await import("/src/lib/studio/pro/recovery.ts");
    const rows = [],
      hash = async (blob) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
    for (const [width, height] of [
      [256, 256],
      [1024, 1024],
      [1080, 1920],
    ]) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d"),
        gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#173b2f");
      gradient.addColorStop(1, "#b4eed6");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      const blob = await new Promise((r) => canvas.toBlob(r));
      canvas.width = canvas.height = 1;
      const tile = document.createElement("canvas");
      tile.width = tile.height = 4;
      tile.getContext("2d").fillRect(0, 0, 4, 4);
      const texture = await new Promise((r) => tile.toBlob(r));
      tile.width = tile.height = 1;
      const id = crypto.randomUUID(),
        doc = fromPanel({ id, name: "Checkpoint benchmark", width, height });
      doc.version = 3;
      doc.layers[0].effects = [
        {
          ...advancedEffect("patternOverlay"),
          version: 3,
          pattern: {
            kind: "bitmap",
            assetId: "tile",
            width: 4,
            height: 4,
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            color2: "#ffffff",
          },
        },
      ];
      const session = {
          document: doc,
          assets: { source: blob, tile: texture },
          acceptedBlobId: crypto.randomUUID(),
          revision: 0,
          updatedAt: 0,
        },
        start = performance.now(),
        saved = await saveSession(session, 0),
        primaryMs = performance.now() - start;
      let headers = [];
      const deadline = performance.now() + 60000;
      while (performance.now() < deadline) {
        headers = (await listCheckpoints(id)).entries;
        if (headers.some((h) => h.revision === saved.revision)) break;
        await new Promise(requestAnimationFrame);
      }
      if (!headers.length)
        throw Error("Confirmed-save checkpoint did not finish within the benchmark window.");
      const checkpointMs = performance.now() - start,
        h = headers.find((h) => h.revision === saved.revision);
      if (!h) throw Error("Checkpoint revision does not match confirmed primary save.");
      const readStart = performance.now(),
        checkpoint = await readCheckpoint(h.id, id),
        restored = await verifyCheckpoint(checkpoint),
        verifyReadMs = performance.now() - readStart,
        primary = await loadSession(id);
      if (
        canonicalNative(primary.document) !== canonicalNative(saved.document) ||
        canonicalNative(restored.document) !== canonicalNative(saved.document)
      )
        throw Error("Benchmark persistence changed document settings.");
      if (
        (await hash(restored.assets.source)) !== (await hash(blob)) ||
        (await hash(restored.assets.tile)) !== (await hash(texture))
      )
        throw Error("Benchmark persistence changed source/pattern bytes.");
      rows.push({
        width,
        height,
        primaryMs,
        checkpointMs,
        verifyReadMs,
        nativeBytes: h.nativeBytes,
        originalBytes: blob.size,
        patternBytes: texture.size,
        revision: saved.revision,
        documentExact: true,
        sourceExact: true,
        bitmapPatternRetained: true,
      });
    }
    return rows;
  });
  assert.deepEqual(errors, []);
  const report = {
    results,
    errors,
    scope:
      "fresh local IndexedDB primary acknowledgement, worker checkpoint completion, integrity-verified read; no production data",
  };
  await writeFile(
    "/workspace/r10-evidence/recovery-benchmark.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
