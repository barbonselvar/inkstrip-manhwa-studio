import { test } from "node:test";
import assert from "node:assert/strict";
import { backupFileName, decodeBackup, encodeBackup, type ProjectData } from "./backup.ts";
import type { Chapter, Panel, Project } from "./types.ts";

const png = (fill: number, size = 40) =>
  new Blob([new Uint8Array(size).fill(fill)], { type: "image/png" });

function sample(): ProjectData {
  const project: Project = {
    id: "p1",
    title: "Night Market",
    createdAt: 1,
    updatedAt: 2,
    characters: [
      {
        id: "c1",
        name: "Hero",
        notes: "",
        primaryId: "r1",
        updatedAt: 3,
        references: [{ id: "r1", angle: "front", blob: png(9, 30) }],
      },
    ],
  };
  const chapter: Chapter = {
    id: "ch1",
    projectId: "p1",
    title: "Chapter 1",
    createdAt: 1,
    updatedAt: 2,
    width: 800,
    seam: 0,
    format: "image/jpeg",
    strip: {
      width: 800,
      totalHeight: 10,
      parts: [{ blobId: "s1", height: 10 }],
      panelIds: ["pa1"],
      widthSetting: 800,
      seam: 0,
      format: "image/jpeg",
      createdAt: 2,
    },
  };
  const panel: Panel = {
    id: "pa1",
    chapterId: "ch1",
    name: "page-1.png",
    order: 0,
    createdAt: 1,
    blobId: "b1",
    thumbId: "t1",
    mime: "image/png",
    width: 10,
    height: 10,
  };
  return {
    project,
    chapters: [chapter],
    panels: [panel],
    blobs: new Map([
      ["b1", png(1, 100)],
      ["t1", png(2, 20)],
      ["s1", png(3, 60)],
    ]),
  };
}

async function bytes(blob: Blob) {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

test("backup round-trips records, images and character references", async () => {
  const data = sample();
  const restored = await decodeBackup(encodeBackup(data));
  assert.deepEqual(restored.chapters, data.chapters);
  assert.deepEqual(restored.panels, data.panels);
  assert.equal(restored.project.title, "Night Market");
  assert.deepEqual([...restored.blobs.keys()].sort(), ["b1", "s1", "t1"]);
  for (const [id, blob] of data.blobs)
    assert.deepEqual(await bytes(restored.blobs.get(id)!), await bytes(blob));
  const reference = restored.project.characters![0].references[0];
  assert.equal(reference.blob.type, "image/png");
  assert.deepEqual(await bytes(reference.blob), await bytes(png(9, 30)));
});

test("backup refuses to export a project with a missing image", () => {
  const data = sample();
  data.blobs.delete("t1");
  assert.throws(() => encodeBackup(data), /missing/);
});

test("restore rejects foreign, truncated and inconsistent files", async () => {
  await assert.rejects(decodeBackup(new Blob(["hello world, not a backup"])), /not a valid/);
  const valid = encodeBackup(sample());
  await assert.rejects(decodeBackup(valid.slice(0, valid.size - 5)), /not a valid/);
  const orphan = sample();
  orphan.panels[0] = { ...orphan.panels[0], chapterId: "elsewhere" };
  await assert.rejects(decodeBackup(encodeBackup(orphan)), /not a valid/);
});

test("backup file names are safe on every platform", () => {
  const name = backupFileName('My: "Story"/1', new Date("2026-10-23T12:00:00Z"));
  assert.equal(name, "My-Story-1-2026-10-23.inkstrip-project");
  assert.equal(
    backupFileName("   ", new Date("2026-10-23T00:00:00Z")),
    "project-2026-10-23.inkstrip-project",
  );
});

test("project backup v2 preserves native dialogue documents and immutable assets as binary slices", async () => {
  const { fromPanel } = await import("./pro/model.ts"),
    { createBubble } = await import("./dialogue/operations.ts");
  const data = sample(),
    panel = data.panels[0]!;
  const document = createBubble(fromPanel({ ...panel, name: "Dialogue page" }), "speech").document;
  document.dialogue!.regions = [
    {
      id: "r1",
      x: 1,
      y: 2,
      width: 4,
      height: 5,
      sourceLanguage: "ja",
      targetLanguage: "ar",
      original: "世界",
      corrected: "世界",
      replacement: "عالم",
      status: "corrected",
    },
  ];
  const source = data.blobs.get("b1")!;
  data.sessions = [
    { document, assets: { source }, revision: 8, acceptedBlobId: panel.blobId, updatedAt: 4 },
  ];
  const file = encodeBackup(data, 123),
    restored = await decodeBackup(file);
  assert.deepEqual(restored.sessions![0]!.document, JSON.parse(JSON.stringify(document)));
  assert.equal(restored.sessions![0]!.revision, 8);
  assert.deepEqual(await bytes(restored.sessions![0]!.assets.source!), await bytes(source));
  assert.deepEqual([...restored.blobs.keys()], ["b1", "t1", "s1"]);
  const twice = await decodeBackup(encodeBackup(restored, 123));
  assert.deepEqual(twice.sessions![0]!.document, JSON.parse(JSON.stringify(document)));
});

test("project backup rejects duplicate or unrelated native page associations", async () => {
  const { fromPanel } = await import("./pro/model.ts"),
    data = sample();
  const session = {
    document: fromPanel({ ...data.panels[0]!, name: "Dialogue page" }),
    assets: { source: data.blobs.get("b1")! },
    revision: 0,
    acceptedBlobId: "b1",
    updatedAt: 0,
  };
  assert.throws(() => encodeBackup({ ...data, sessions: [session, session] }), /association/);
  assert.throws(
    () =>
      encodeBackup({
        ...data,
        sessions: [{ ...session, document: { ...session.document, panelId: "other" } }],
      }),
    /association/,
  );
});
