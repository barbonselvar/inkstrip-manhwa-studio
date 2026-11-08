/** Small crash-safe JSON documents (settings, links, recent list). Pure Node. */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { renameWithRetry } from "./project-files.ts";

export async function readJson<T>(path: string, fallback: T, sanitize: (value: unknown) => T): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return fallback;
  }
  try {
    return sanitize(JSON.parse(text));
  } catch {
    // Keep the damaged document for inspection instead of silently overwriting it.
    await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => {});
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString("hex")}.tmp`);
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await renameWithRetry(temp, path);
}

/** Serialize writes to one document so concurrent updates never interleave. */
export class JsonDocument<T> {
  private value: T | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  readonly path: string;
  private readonly fallback: () => T;
  private readonly sanitize: (value: unknown) => T;
  constructor(path: string, fallback: () => T, sanitize: (value: unknown) => T) {
    this.path = path;
    this.fallback = fallback;
    this.sanitize = sanitize;
  }

  async get(): Promise<T> {
    if (this.value === null) this.value = await readJson(this.path, this.fallback(), this.sanitize);
    return this.value;
  }

  update(change: (current: T) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next = this.sanitize(change(await this.get()));
      await writeJson(this.path, next);
      this.value = next;
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
