/** Bounded, content-verified weights. Model provenance is independent of cache
 * trust: interrupted/corrupted storage must not become an inference session. */
export async function verifiedModelBytes(
  bytes: ArrayBuffer,
  expected: { bytes: number; sha256: string },
) {
  if (bytes.byteLength !== expected.bytes)
    throw Error("AI model download is incomplete or oversized. Retry the download.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== expected.sha256)
    throw Error("AI model integrity check failed. Original artwork is unchanged.");
  return bytes;
}
export async function downloadModelBytes(
  response: Response,
  expected: { bytes: number; sha256: string },
  progress: (received: number, total: number) => void,
) {
  if (!response.ok || !response.body)
    throw Error("Could not download the AI model. Check your connection and try again.");
  const reader = response.body.getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > expected.bytes) throw Error("AI model download exceeds its verified size.");
      chunks.push(new Uint8Array(value));
      progress(received, expected.bytes);
    }
    return await verifiedModelBytes(await new Blob(chunks).arrayBuffer(), expected);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
