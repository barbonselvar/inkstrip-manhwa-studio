/** Re-runs the 26 Oct 2026 audit's independent probes (audit/probe.mjs) against this checkout
 * with the audit's exact inputs, recording the outcome instead of assuming acceptance.
 * The provider transport is a local stub: no network request is made. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeBackup, encodeBackup } from "../src/lib/studio/backup.ts";
import { imageEdit } from "../src/lib/ai/image-edit.server.ts";

const findings = [];
const outcome = async (fn) => {
  try {
    return { accepted: true, value: await fn() };
  } catch (error) {
    return { accepted: false, error: error.message };
  }
};

// INK-AUD-001: invalid titles and chapter settings.
for (const title of [42, { invalid: "object" }, null]) {
  const project = { id: "audit-invalid-title", title, createdAt: 1, updatedAt: 1 };
  const r = await outcome(() =>
    decodeBackup(encodeBackup({ project, chapters: [], panels: [], blobs: new Map() })),
  );
  findings.push({ id: "INK-AUD-001", probe: "invalid-project-title", input: title, ...r });
}
const chapter = {
  id: "c",
  projectId: "p",
  title: "QA",
  createdAt: 1,
  updatedAt: 1,
  width: -1,
  seam: -1000000,
  format: "application/javascript",
  strip: null,
};
const settings = await outcome(() =>
  decodeBackup(
    encodeBackup({
      project: { id: "p", title: "QA", createdAt: 1, updatedAt: 1 },
      chapters: [chapter],
      panels: [],
      blobs: new Map(),
    }),
  ),
);
findings.push({ id: "INK-AUD-001", probe: "invalid-chapter-settings", ...settings });

// INK-AUD-002/003: the audit's 24-byte container and four-byte provider payload.
const four = Buffer.from([137, 80, 78, 71]).toString("base64");
const send = async (image, mask) => {
  let calls = 0;
  const fd = new FormData();
  fd.set("operation", "erase");
  fd.set("image", new Blob([image], { type: "image/png" }), "image.png");
  fd.set("mask", new Blob([mask], { type: "image/png" }), "mask.png");
  const response = await imageEdit(
    new Request("https://audit.invalid/api/studio/ai-edit", {
      method: "POST",
      headers: { origin: "https://audit.invalid", "x-inkstrip-access": "test-only" },
      body: fd,
    }),
    { key: "test-only", access: "test-only" },
    async () => {
      calls++;
      return Response.json({ data: [{ b64_json: four }] });
    },
  );
  return { status: response.status, stubProviderCalls: calls, noNetworkRequests: true };
};
const truncated = Buffer.alloc(24);
truncated.writeUInt32BE(0x89504e47, 0);
truncated.writeUInt32BE(0x0d0a1a0a, 4);
truncated.writeUInt32BE(16, 16);
truncated.writeUInt32BE(16, 20);
findings.push({
  id: "INK-AUD-002",
  probe: "truncated-png-input",
  ...(await send(truncated, truncated)),
});
const valid = await readFile(
  new URL("../src/lib/ai/fixtures/audit-alpha-red.png", import.meta.url),
);
findings.push({
  id: "INK-AUD-003",
  probe: "invalid-provider-output-with-valid-input",
  ...(await send(valid, valid)),
});

console.log(JSON.stringify(findings, null, 2));
for (const f of findings.filter((f) => f.id === "INK-AUD-001")) assert.equal(f.accepted, false);
assert.deepEqual(
  findings.filter((f) => f.id !== "INK-AUD-001").map((f) => [f.status, f.stubProviderCalls]),
  [
    [400, 0],
    [502, 1],
  ],
);
console.log("All audit probes now fail closed.");
