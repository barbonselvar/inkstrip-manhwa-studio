/** Plain-text rotating log in %LOCALAPPDATA%\Inkstrip Manhwa Studio\logs. Never logs artwork or secrets. */
import { appendFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

let file: string | null = null;
const MAX = 5 * 1024 * 1024;

export function initLog(folder: string) {
  file = join(folder, "inkstrip.log");
  try {
    if (statSync(file).size > MAX) renameSync(file, join(folder, "inkstrip.previous.log"));
  } catch {
    /* new log */
  }
}

function write(level: string, message: string, detail?: unknown) {
  const line = `${new Date().toISOString()} ${level} ${message}${
    detail === undefined ? "" : ` ${detail instanceof Error ? `${detail.name}: ${detail.message}` : safe(detail)}`
  }\n`;
  if (level !== "DEBUG") process.stdout.write?.(line);
  if (!file) return;
  try {
    appendFileSync(file, line);
  } catch {
    /* disk full: never crash because of logging */
  }
}

function safe(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return String(value);
  }
}

export const log = {
  info: (m: string, d?: unknown) => write("INFO", m, d),
  warn: (m: string, d?: unknown) => write("WARN", m, d),
  error: (m: string, d?: unknown) => write("ERROR", m, d),
};
