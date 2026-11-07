/**
 * Unit tests for the Electron main-process modules that need no Electron runtime:
 * crash-safe project writing, container integrity, backups, settings, update release
 * selection and the project registry.
 *
 *   node --experimental-strip-types --test apps/desktop/test/main-modules.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { DEFAULT_SETTINGS } from "../../../src/lib/desktop/contract.ts";
import {
  CONTAINER_MAGIC,
  inspectContainer,
  ProjectFileError,
  pruneBackups,
  safeName,
  sha256File,
  sweepTemporaryFiles,
  WriteSession,
} from "../src/main/project-files.ts";
import { ProjectRegistry } from "../src/main/registry.ts";
import { mergeSettings, sanitizeSettings } from "../src/main/settings.ts";
import { compareVersions, isLoopbackFeed, pickRelease } from "../src/main/update-feed.ts";
import { readJson, writeJson } from "../src/main/json-store.ts";

const dirs: string[] = [];
const temp = async () => {
  const d = await mkdtemp(join(tmpdir(), "inkstrip-test-"));
  dirs.push(d);
  return d;
};
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** A minimal valid container, byte-compatible with src/lib/studio/backup.ts. */
function container(projectId = "proj-1", blobs: Uint8Array[] = [new Uint8Array([1, 2, 3])]) {
  const header = Buffer.from(
    JSON.stringify({
      format: "inkstrip-backup",
      version: 3,
      exportedAt: 1,
      project: { id: projectId, title: "Night / Market", createdAt: 1, updatedAt: 1 },
      chapters: [],
      panels: [],
      blobs: blobs.map((b, i) => ({ id: `b${i}`, type: "image/png", size: b.byteLength })),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([CONTAINER_MAGIC, length, header, ...blobs.map((b) => Buffer.from(b))]);
}

async function writeAll(target: string, data: Buffer, chunk = 7) {
  const session = await WriteSession.begin(target, data.length);
  for (let i = 0; i < data.length; i += chunk) await session.append(data.subarray(i, i + chunk));
  return session;
}

describe("project file writing", () => {
  test("streams, verifies and atomically publishes a project", async () => {
    const dir = await temp();
    const target = join(dir, "story.inkstrip");
    const data = container();
    const session = await writeAll(target, data);
    const result = await session.commit();
    assert.deepEqual(await readFile(target), data);
    assert.equal(result.sha256, await sha256File(target));
    assert.equal(result.summary.projectId, "proj-1");
    assert.deepEqual((await readdir(dir)).sort(), ["story.inkstrip"]); // no temp files left
  });

  test("a failed save never touches the existing file", async () => {
    const dir = await temp();
    const target = join(dir, "story.inkstrip");
    const original = container("proj-1", [new Uint8Array([9, 9])]);
    await writeFile(target, original);
    const data = container();
    const session = await WriteSession.begin(target, data.length);
    await session.append(data.subarray(0, 20)); // interrupted mid-save
    await assert.rejects(session.commit(), /interrupted/);
    assert.deepEqual(await readFile(target), original);
    assert.deepEqual(await readdir(dir), ["story.inkstrip"]);
  });

  test("rejects payloads that are not Inkstrip projects", async () => {
    const dir = await temp();
    const session = await WriteSession.begin(join(dir, "x.inkstrip"), 64);
    await assert.rejects(session.append(Buffer.alloc(64, 0x41)), /not an Inkstrip project/);
    await session.abort();
  });

  test("rejects more data than declared", async () => {
    const dir = await temp();
    const data = container();
    const session = await WriteSession.begin(join(dir, "x.inkstrip"), data.length - 1);
    await assert.rejects(session.append(data), /exceeded/);
    await session.abort();
  });

  test("refuses to start when the disk cannot hold the file", async () => {
    const dir = await temp();
    await assert.rejects(
      WriteSession.begin(join(dir, "huge.inkstrip"), 2 ** 52),
      (e: unknown) => e instanceof ProjectFileError && e.code === "space" && /Not enough disk space/.test(e.message),
    );
    assert.deepEqual(await readdir(dir), []);
  });

  test("keeps rotating backups of the previous version", async () => {
    const dir = await temp();
    const target = join(dir, "story.inkstrip");
    const backups = join(dir, "backups");
    for (let i = 0; i < 4; i++) {
      const session = await writeAll(target, container("proj-1", [new Uint8Array([i])]), 1000);
      await session.commit({ folder: backups, keep: 2 });
      await new Promise((r) => setTimeout(r, 5));
    }
    const kept = (await readdir(backups)).sort();
    assert.equal(kept.length, 2);
    // The newest backup is the version before the current file.
    const newest = await readFile(join(backups, kept[1]!));
    assert.equal(newest.at(-1), 2);
    assert.equal((await readFile(target)).at(-1), 3);
  });
});

describe("container integrity", () => {
  test("accepts a complete container and summarizes it", async () => {
    const dir = await temp();
    const file = join(dir, "a.inkstrip");
    await writeFile(file, container("abc"));
    const s = await inspectContainer(file);
    assert.equal(s.projectId, "abc");
    assert.equal(s.title, "Night / Market");
  });

  for (const [name, mutate] of [
    ["truncated", (b: Buffer) => b.subarray(0, b.length - 1)],
    ["padded", (b: Buffer) => Buffer.concat([b, Buffer.from([0])])],
    ["wrong magic", (b: Buffer) => Buffer.concat([Buffer.from("NOTINKSTRIP-BAK\n"), b.subarray(16)])],
    ["header length past end", (b: Buffer) => {
      const c = Buffer.from(b);
      c.writeUInt32BE(0x7fffffff, 16);
      return c;
    }],
    ["corrupt header JSON", (b: Buffer) => {
      const c = Buffer.from(b);
      c[21] = 0x7b;
      c[22] = 0x7b;
      return c;
    }],
    ["empty", () => Buffer.alloc(0)],
  ] as const) {
    test(`rejects a ${name} file`, async () => {
      const dir = await temp();
      const file = join(dir, "bad.inkstrip");
      await writeFile(file, mutate(container()));
      await assert.rejects(inspectContainer(file), ProjectFileError);
    });
  }

  test("sweeps abandoned temporary save files only", async () => {
    const dir = await temp();
    await writeFile(join(dir, ".story.inkstrip.0123456789ab.saving"), "x");
    await writeFile(join(dir, "story.inkstrip"), "keep");
    await sweepTemporaryFiles(dir, -60_000); // any age (NTFS mtime can lead Date.now())
    assert.deepEqual(await readdir(dir), ["story.inkstrip"]);
  });

  test("safe file names", () => {
    assert.equal(safeName('My: "Story" / 1'), "My-Story-1");
    assert.equal(safeName("..hidden"), "hidden");
    assert.equal(safeName(""), "project");
  });

  test("backup pruning keeps the newest", async () => {
    const dir = await temp();
    for (const n of ["2024-a.inkstrip", "2025-b.inkstrip", "2026-c.inkstrip", "note.txt"]) await writeFile(join(dir, n), n);
    await pruneBackups(dir, 1);
    assert.deepEqual((await readdir(dir)).sort(), ["2026-c.inkstrip", "note.txt"]);
  });
});

describe("settings", () => {
  test("defaults and clamping", () => {
    assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
    const s = sanitizeSettings({ autosave: { intervalMinutes: 999, enabled: "yes" }, backups: { keep: -3 } });
    assert.equal(s.autosave.intervalMinutes, 60);
    assert.equal(s.autosave.enabled, true);
    assert.equal(s.backups.keep, 0);
  });
  test("merge only changes known valid keys", () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { ai: { cloudEnabled: true }, evil: { x: 1 }, updates: { autoCheck: "no" } });
    assert.equal(next.ai.cloudEnabled, true);
    assert.equal(next.updates.autoCheck, true);
    assert.equal((next as unknown as Record<string, unknown>).evil, undefined);
  });
  test("a damaged settings file is set aside, not trusted", async () => {
    const dir = await temp();
    const file = join(dir, "settings.json");
    await writeFile(file, "{not json");
    assert.deepEqual(await readJson(file, DEFAULT_SETTINGS, (v) => sanitizeSettings(v)), DEFAULT_SETTINGS);
    assert.ok((await readdir(dir)).some((n) => n.startsWith("settings.json.corrupt-")));
    await writeJson(file, { a: 1 });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { a: 1 });
  });
});

describe("update release selection", () => {
  const repo = "barbonselvar/inkstrip-manhwa-studio";
  const assets = (v: string) => [
    { name: "latest.yml", state: "uploaded" },
    { name: `Inkstrip-Manhwa-Studio-Setup-${v}.exe`, state: "uploaded" },
    { name: `Inkstrip-Manhwa-Studio-Setup-${v}.exe.blockmap`, state: "uploaded" },
  ];
  const release = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    body: "notes",
    html_url: `https://github.com/${repo}/releases/tag/${tag}`,
    published_at: "2026-11-01T00:00:00Z",
    assets: assets(tag.replace(/^desktop-v/, "")),
    ...extra,
  });

  test("picks the newest stable desktop release", () => {
    const r = pickRelease([release("desktop-v1.0.1"), release("desktop-v1.2.0"), release("app-v9.0.0")], "1.0.0", repo);
    assert.equal(r?.version, "1.2.0");
    assert.equal(r?.feedUrl, `https://github.com/${repo}/releases/download/desktop-v1.2.0/`);
  });
  test("never downgrades or reinstalls the same version", () => {
    assert.equal(pickRelease([release("desktop-v1.0.0"), release("desktop-v0.9.0")], "1.0.0", repo), null);
  });
  test("ignores drafts, prereleases, Android releases and incomplete metadata", () => {
    assert.equal(
      pickRelease(
        [
          release("desktop-v2.0.0", { draft: true }),
          release("desktop-v2.0.1", { prerelease: true }),
          release("desktop-v2.0.2-beta.1"),
          release("app-v3.0.0"),
          release("desktop-v2.0.3", { assets: assets("2.0.3").slice(1) }),
          release("desktop-v2.0.4", { assets: assets("2.0.5") }),
          release("desktop-v2.0.6", { assets: assets("2.0.6").map((a) => ({ ...a, state: "starter" })) }),
        ],
        "1.0.0",
        repo,
      ),
      null,
    );
    assert.equal(pickRelease("not a list", "1.0.0", repo), null);
  });
  test("release page links stay on the repository", () => {
    const r = pickRelease([release("desktop-v1.1.0", { html_url: "https://evil.example/x" })], "1.0.0", repo);
    assert.equal(r?.pageUrl, `https://github.com/${repo}/releases/tag/desktop-v1.1.0`);
  });
  test("version comparison and loopback-only test feeds", () => {
    assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
    assert.throws(() => compareVersions("1.0", "1.0.0"));
    assert.ok(isLoopbackFeed("http://127.0.0.1:8123/"));
    assert.ok(!isLoopbackFeed("http://example.com/"));
    assert.ok(!isLoopbackFeed("https://127.0.0.1/"));
  });
});

describe("project registry", () => {
  test("links, recent list and recovery snapshots", async () => {
    const dir = await temp();
    const reg = new ProjectRegistry(join(dir, "meta"), join(dir, "recovery"));
    await reg.setLink({ projectId: "p1", path: "C:/a/one.inkstrip", fingerprint: "f".repeat(64), sha256: "a", savedAt: 1, mtime: 1 });
    await reg.setLink({ projectId: "p2", path: "C:/a/ONE.inkstrip", fingerprint: "f".repeat(64), sha256: "b", savedAt: 2, mtime: 2 });
    // A file belongs to one project: re-linking the same path moves it.
    assert.equal(await reg.link("p1"), null);
    assert.equal((await reg.link("p2"))?.sha256, "b");
    for (let i = 0; i < 20; i++) await reg.touchRecent({ path: `C:/p/${i}.inkstrip`, title: `P${i}`, projectId: null });
    const recent = await reg.recent.get();
    assert.equal(recent.length, 15);
    assert.equal(recent[0]!.title, "P19");
    assert.throws(() => reg.recoveryFile("../escape"));
    const file = reg.recoveryFile("p2");
    await writeAllAndCommit(file);
    await reg.writeRecoveryMeta({ id: "p2", projectId: "p2", title: "Two", fingerprint: "x", createdAt: 5, size: (await stat(file)).size, linkedPath: null });
    assert.equal((await reg.listRecovery()).length, 1);
    await reg.discardRecovery("p2");
    assert.equal((await reg.listRecovery()).length, 0);
  });
});

async function writeAllAndCommit(target: string) {
  const session = await writeAll(target, container("p2"), 100);
  await session.commit();
}
