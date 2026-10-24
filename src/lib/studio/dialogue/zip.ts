/** Deterministic, uncompressed ZIP: bounded Blob chunks, UTF-8 names, no giant joined buffer. */
const table = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export type ZipEntry = { name: string; blob: Blob };
export function safeAssetName(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, "-")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80) || "asset"
  );
}
export function zipPath(value: string) {
  if (
    !value ||
    value.length > 240 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\p{Cc}]/u.test(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw Error("Unsafe archive filename.");
  return new TextEncoder().encode(value);
}
export async function crc32(blob: Blob, signal?: AbortSignal) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      for (const n of value) crc = table[(crc ^ n) & 255]! ^ (crc >>> 8);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function zipStore(
  entries: ZipEntry[],
  signal?: AbortSignal,
  onProgress: (n: number, total: number) => void = () => {},
) {
  if (!entries.length || entries.length > 1000)
    throw Error("Export between1 and1000 archive entries.");
  const names = new Set<string>(),
    parts: BlobPart[] = [],
    directory: BlobPart[] = [];
  let offset = 0,
    centralSize = 0;
  for (let i = 0; i < entries.length; i++) {
    signal?.throwIfAborted();
    const { name, blob } = entries[i]!,
      encoded = zipPath(name);
    if (names.has(name)) throw Error("Duplicate archive filename.");
    names.add(name);
    if (offset + blob.size + encoded.length + 30 > 2_000_000_000)
      throw Error("Archive exceeds the2GB safety budget. Export smaller page ranges.");
    const crc = await crc32(blob, signal),
      local = new Uint8Array(30),
      v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 33, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, blob.size, true);
    v.setUint32(22, blob.size, true);
    v.setUint16(26, encoded.length, true);
    const central = new Uint8Array(46),
      c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, blob.size, true);
    c.setUint32(24, blob.size, true);
    c.setUint16(28, encoded.length, true);
    c.setUint32(42, offset, true);
    parts.push(local, encoded, blob);
    directory.push(central, encoded);
    offset += 30 + encoded.length + blob.size;
    centralSize += 46 + encoded.length;
    onProgress(i + 1, entries.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
  const end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, centralSize, true);
  v.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
