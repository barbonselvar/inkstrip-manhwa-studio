/**
 * Opaque handles for files the user chose. The renderer only ever holds tokens; the
 * main process resolves them. A token exists only for a path that came from a native
 * dialog, the command line, the recent list, a linked project, recovery or backups.
 */
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { FileRef } from "../../../../src/lib/desktop/contract.ts";

type Entry = { path: string; kind: FileRef["kind"] };

export class FileTokens {
  private byToken = new Map<string, Entry>();
  private byPath = new Map<string, string>();

  issueSync(path: string, kind: FileRef["kind"]): string {
    const full = resolve(path);
    const key = `${kind}\0${full.toLowerCase()}`;
    let token = this.byPath.get(key);
    if (!token) {
      token = randomBytes(18).toString("base64url");
      this.byToken.set(token, { path: full, kind });
      this.byPath.set(key, token);
    }
    return token;
  }

  async ref(path: string, kind: FileRef["kind"]): Promise<FileRef> {
    const token = this.issueSync(path, kind);
    const full = this.byToken.get(token)!.path;
    const info = await stat(full).catch(() => null);
    return {
      token,
      path: full,
      name: basename(full),
      size: info?.size ?? 0,
      modifiedAt: info?.mtimeMs ?? 0,
      kind,
    };
  }

  resolve(token: unknown, kinds?: FileRef["kind"][]): Entry | null {
    if (typeof token !== "string" || token.length > 64) return null;
    const entry = this.byToken.get(token);
    if (!entry || (kinds && !kinds.includes(entry.kind))) return null;
    return entry;
  }
}
