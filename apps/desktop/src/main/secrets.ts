/** The user's own cloud AI key, encrypted with Windows DPAPI through Electron safeStorage. */
import { safeStorage } from "electron";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeJson } from "./json-store.ts";

export class Secrets {
  private readonly file: string;
  constructor(folder: string) {
    this.file = join(folder, "credentials.json");
  }

  available() {
    return safeStorage.isEncryptionAvailable();
  }

  async get(): Promise<string | null> {
    if (!this.available()) return null;
    try {
      const stored = JSON.parse(await readFile(this.file, "utf8"));
      if (typeof stored?.openai !== "string") return null;
      return safeStorage.decryptString(Buffer.from(stored.openai, "base64"));
    } catch {
      return null;
    }
  }

  async set(key: string | null) {
    if (key === null || key === "") {
      await unlink(this.file).catch(() => {});
      return false;
    }
    if (!this.available()) throw new Error("Windows credential encryption is unavailable.");
    if (!/^[\x21-\x7e]{20,300}$/.test(key)) throw new Error("That does not look like an API key.");
    await writeJson(this.file, { openai: safeStorage.encryptString(key).toString("base64") });
    return true;
  }
}
