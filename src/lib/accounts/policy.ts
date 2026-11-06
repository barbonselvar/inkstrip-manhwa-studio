export const CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 2_000_000_000;
export const MAX_PARTS = 1000;
export const CONSENT_VERSION = "2026-11-06";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DIGEST = /^[a-f0-9]{64}$/;
export type Part = { digest: string; bytes: number };
export type Manifest = { version: 1; bytes: number; parts: Part[] };
export type CloudProject = {
  id: string;
  local_id: string;
  title: string;
  head_revision: number;
  bytes?: number;
  updated_at: string;
};
export type AccountUser = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  verified: boolean;
  providers: string[];
  createdAt: string;
  preferences: Record<string, unknown>;
  deleting: boolean;
};
export type AccountStatus = {
  emailMode?: "otp" | "link";
  recovery?: boolean;
  configured: boolean;
  reason: string | null;
  google: boolean;
  facebook: boolean;
  user: AccountUser | null;
  csrf: string;
  fresh: boolean;
};
export function emailAddress(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
    throw Error("Enter a valid email address.");
  return value.trim().toLowerCase();
}
export function passwordScore(value: string) {
  return Math.min(
    4,
    Number(value.length >= 12) +
      Number(/[a-z]/.test(value) && /[A-Z]/.test(value)) +
      Number(/\d/.test(value)) +
      Number(/[^\p{L}\p{N}]/u.test(value)),
  );
}
export function strongPassword(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    value.length > 128 ||
    passwordScore(value) < 4
  )
    throw Error("Use 12–128 characters with upper and lowercase letters, a number and a symbol.");
  return value;
}
export function displayName(value: unknown) {
  if (
    typeof value !== "string" ||
    value.trim().length < 2 ||
    value.trim().length > 80 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw Error("Use a display name of 2–80 characters.");
  return value.trim();
}
export function avatarUrl(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1024) throw Error("Invalid avatar URL.");
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw Error("Invalid avatar URL.");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    throw Error("Avatar URLs must use HTTPS.");
  return u.href;
}
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (
    !m ||
    m.version !== 1 ||
    !Array.isArray(m.parts) ||
    m.parts.length < 1 ||
    m.parts.length > MAX_PARTS ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes < 1 ||
    m.bytes > MAX_PACKAGE_BYTES
  )
    throw Error("Invalid project package manifest.");
  let bytes = 0;
  for (const p of m.parts) {
    if (
      !p ||
      !DIGEST.test(p.digest) ||
      !Number.isInteger(p.bytes) ||
      p.bytes < 1 ||
      p.bytes > CHUNK_BYTES
    )
      throw Error("Invalid project chunk.");
    bytes += p.bytes;
  }
  if (bytes !== m.bytes) throw Error("Project package byte count does not match.");
  return {
    version: 1,
    bytes: m.bytes,
    parts: m.parts.map((p) => ({ digest: p.digest, bytes: p.bytes })),
  };
}
export function canonicalManifest(m: Manifest) {
  return JSON.stringify(validateManifest(m));
}
export function storagePath(owner: string, project: string, digest: string) {
  if (!UUID.test(owner) || !UUID.test(project) || !DIGEST.test(digest))
    throw Error("Invalid private asset path.");
  return `${owner}/${project}/${digest}.part`;
}
export function safeOrigin(value: string, production: boolean) {
  const u = new URL(value);
  const host = u.hostname.replace(/\.$/, "").toLowerCase();
  if (
    (production &&
      (host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "0.0.0.0" ||
        /^127\./.test(host) ||
        host === "[::1]" ||
        host === "[::]")) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    (u.protocol !== "https:" &&
      (production || u.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(u.hostname)))
  )
    throw Error("Configure a canonical HTTPS account origin.");
  return u.origin;
}
