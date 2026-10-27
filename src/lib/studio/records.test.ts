import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeBackup, encodeBackup, projectBlobIds, type ProjectData } from "./backup.ts";
import { partitionLibrary, validateChapterRecord, validatePanelRecord } from "./records.ts";
import type { Chapter, Panel, Project } from "./types.ts";

const png = () => new Blob([new Uint8Array(16).fill(7)], { type: "image/png" });
const project = (): Project => ({ id: "p", title: "QA", createdAt: 1, updatedAt: 1 });
const chapter = (): Chapter => ({
  id: "c",
  projectId: "p",
  title: "Chapter 1",
  createdAt: 1,
  updatedAt: 1,
  width: 800,
  seam: 0,
  format: "image/jpeg",
  strip: null,
});
const panel = (): Panel => ({
  id: "pa",
  chapterId: "c",
  name: "page.png",
  mime: "image/png",
  width: 10,
  height: 10,
  blobId: "b",
  thumbId: "t",
  order: 0,
  createdAt: 1,
});
const data = (): ProjectData => ({
  project: project(),
  chapters: [chapter()],
  panels: [panel()],
  blobs: new Map([
    ["b", png()],
    ["t", png()],
  ]),
});
/** Encode a structurally valid backup, then tamper with its header like a hostile file would. */
async function tampered(edit: (header: Record<string, never>) => void) {
  const blob = encodeBackup(data()),
    bytes = new Uint8Array(await blob.arrayBuffer()),
    prefix = 16,
    length = new DataView(bytes.buffer).getUint32(prefix),
    header = JSON.parse(new TextDecoder().decode(bytes.slice(prefix + 4, prefix + 4 + length)));
  edit(header);
  const json = new TextEncoder().encode(JSON.stringify(header)),
    size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, json.length);
  return new Blob([bytes.slice(0, prefix), size, json, bytes.slice(prefix + 4 + length)]);
}

test("INK-AUD-001: non-string, empty and oversized titles are rejected before restore", async () => {
  for (const title of [42, { invalid: "object" }, null, "", "   ", "x".repeat(201)])
    await assert.rejects(
      decodeBackup(await tampered((h) => ((h.project as { title: unknown }).title = title))),
      /invalid project metadata \(Invalid project title\)/,
      JSON.stringify(title),
    );
  for (const title of [42, null])
    await assert.rejects(
      decodeBackup(await tampered((h) => ((h.chapters as { title: unknown }[])[0]!.title = title))),
      /Invalid chapter title/,
    );
  await assert.rejects(
    decodeBackup(await tampered((h) => ((h.panels as { name: unknown }[])[0]!.name = 7))),
    /Invalid page name/,
  );
});

test("INK-AUD-001: invalid chapter output settings and unknown fields are rejected", async () => {
  const cases: [string, unknown, RegExp][] = [
    ["width", -1, /chapter width/],
    ["width", 319, /chapter width/],
    ["width", 800.5, /chapter width/],
    ["seam", -1_000_000, /chapter seam/],
    ["seam", 513, /chapter seam/],
    ["format", "application/javascript", /chapter output format/],
    ["strip", { width: 800 }, /chapter strip \(missing/],
    ["orderHistory", "x", /order history/],
    ["script", "<x>", /unknown field script/],
  ];
  for (const [key, value, error] of cases)
    await assert.rejects(
      decodeBackup(
        await tampered((h) => ((h.chapters as Record<string, unknown>[])[0]![key] = value)),
      ),
      error,
      `${key}=${JSON.stringify(value)}`,
    );
  for (const [key, value] of [
    ["width", 0],
    ["height", 70000],
    ["order", -1],
    ["mime", "text/html"],
    ["blobId", ""],
    ["edit", { version: 1, source: {}, recipe: {} }],
    ["__proto__x", 1],
  ] as const)
    await assert.rejects(
      decodeBackup(
        await tampered((h) => ((h.panels as Record<string, unknown>[])[0]![key] = value)),
      ),
      /invalid project metadata/,
      `${key}=${JSON.stringify(value)}`,
    );
  await assert.rejects(
    decodeBackup(await tampered((h) => ((h.project as Record<string, unknown>).presets = {}))),
    /Invalid project presets/,
  );
});

test("valid backups from production 5f9c537 still restore with identical records", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/backup/production-5f9c537-records.json", import.meta.url),
      "utf8",
    ),
  ) as { project: Project; chapters: Chapter[]; panels: Panel[] };
  // Real historical metadata (strip, original media, media revisions); image bytes are stand-ins.
  const ids = projectBlobIds(fixture.chapters, fixture.panels);
  const restored = await decodeBackup(
    encodeBackup({
      project: fixture.project,
      chapters: fixture.chapters,
      panels: fixture.panels,
      blobs: new Map(ids.map((id) => [id, png()])),
    }),
  );
  assert.deepEqual(restored.project, fixture.project);
  assert.deepEqual(restored.chapters, fixture.chapters);
  assert.deepEqual(restored.panels, fixture.panels);
  assert.ok(fixture.chapters[0]!.strip?.mediaRevisions);
  assert.ok(fixture.panels.some((p) => p.original && p.mediaUpdatedAt));
});

test("INK-AUD-001: an invalid stored record is set aside; other projects still load", () => {
  const good = project(),
    bad = { ...project(), id: "bad", title: 42 },
    badChapter = { ...chapter(), id: "bc", projectId: "bad" },
    badPanel = { ...panel(), id: "bp", chapterId: "bc" },
    brokenChapter = { ...chapter(), id: "w", seam: -5 },
    orphan = { ...panel(), id: "orphan", chapterId: "deleted-long-ago" };
  const result = partitionLibrary({
    projects: [good, bad, null],
    chapters: [chapter(), badChapter, brokenChapter],
    panels: [panel(), badPanel, orphan, { ...panel(), id: "wp", chapterId: "w" }],
  });
  assert.deepEqual(
    result.projects.map((p) => p.id),
    ["p"],
  );
  assert.deepEqual(
    result.chapters.map((c) => c.id),
    ["c"],
  );
  // Pages of set-aside chapters are set aside; a pre-existing orphan stays as before.
  assert.deepEqual(
    result.panels.map((p) => p.id),
    ["pa", "orphan"],
  );
  assert.deepEqual(
    result.quarantined.map((q) => [q.store, q.key]),
    [
      ["projects", "bad"],
      ["projects", "(unknown)"],
      ["chapters", "bc"],
      ["chapters", "w"],
      ["panels", "bp"],
      ["panels", "wp"],
    ],
  );
  // The Library's search consumer works for everything that is published.
  for (const p of result.projects) assert.equal(typeof p.title.toLowerCase(), "string");
});

test("record validators accept every field the app writes", () => {
  validateChapterRecord({
    ...chapter(),
    orderHistory: [{ before: ["a", "b"], after: ["b", "a"] }],
    strip: {
      width: 800,
      totalHeight: 100,
      parts: [{ blobId: "s", height: 100 }],
      panelIds: ["pa"],
      widthSetting: 800,
      seam: 0,
      format: "image/png",
      createdAt: 1,
      mediaRevisions: { pa: "rev" },
    },
  });
  const media = { blobId: "o", thumbId: "ot", mime: "image/png", width: 10, height: 10 };
  const recipe = {
    crop: { x: 0, y: 0, width: 10, height: 10 },
    rotation: 0,
    flipX: false,
    flipY: false,
    width: 10,
    height: 10,
  };
  validatePanelRecord({
    ...panel(),
    mediaUpdatedAt: 2,
    original: media,
    edit: { version: 1, source: media, recipe },
    draft: { expectedBlobId: "b", source: media, recipe, updatedAt: 3 },
  });
});
