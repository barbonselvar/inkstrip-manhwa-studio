import { previewPathPrefix } from "../preview-path-prefix";
import type { AccountStatus } from "./policy";
let csrf = "";
export class AccountError extends Error {
  code: string;
  status: number;
  retry: number;
  constructor(message: string, code: string, status: number, retry = 0) {
    super(message);
    this.code = code;
    this.status = status;
    this.retry = retry;
  }
}
const endpoint = (path: string) =>
  `${typeof window === "undefined" ? "" : (previewPathPrefix(window.location.hostname, window.location.pathname) ?? "")}/api/account/${path}`;
async function response(path: string, options: RequestInit = {}) {
  const r = await fetch(endpoint(path), {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...options.headers,
      ...(options.method === "POST" ? { "X-Inkstrip-CSRF": csrf } : {}),
    },
  });
  if (!r.ok) {
    let data: { error?: string; code?: string } = {};
    try {
      data = await r.json();
    } catch {
      /* Do not expose raw provider/proxy responses. */
    }
    throw new AccountError(
      data.error ?? "The account service is unavailable.",
      data.code ?? "service_unavailable",
      r.status,
      Number(r.headers.get("retry-after")) || 0,
    );
  }
  return r;
}
export async function accountSession(signal?: AbortSignal): Promise<AccountStatus> {
  const r = await response("session", { signal });
  const status = (await r.json()) as AccountStatus;
  csrf = status.csrf;
  return status;
}
export async function accountPost<T = Record<string, unknown>>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return (
    await response(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  ).json();
}
export async function accountGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await response(path, { signal })).json();
}
export async function uploadPart(
  project: string,
  digest: string,
  part: Blob,
  signal?: AbortSignal,
) {
  return (
    await response(`chunk?project=${encodeURIComponent(project)}&digest=${digest}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: part,
      signal,
    })
  ).json();
}
export async function downloadPart(project: string, digest: string, signal?: AbortSignal) {
  return (
    await response(`chunk?project=${encodeURIComponent(project)}&digest=${digest}`, { signal })
  ).blob();
}
