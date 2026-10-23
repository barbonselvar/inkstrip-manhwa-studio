/** Browser-direct discovery only. No backend proxy, credential persistence or automatic upload. */
export type GpuCapabilities = {
  protocol: "inkstrip-gpu/1";
  retention: string;
  models: {
    id: string;
    revision: string;
    task: string;
    codeLicense: string;
    weightsLicense: string;
  }[];
};
export function gpuEndpoint(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw Error("Enter a valid HTTPS GPU endpoint.");
  }
  // Explicitly public HTTPS only. User-owned private/LAN access needs a separately reviewed connector.
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.port && u.port !== "443") ||
    u.pathname !== "/" ||
    !h.includes(".") ||
    /^[\d.]+$/.test(h) ||
    h.includes(":") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(h) ||
    h.endsWith(".localdomain") ||
    h.endsWith(".nip.io") ||
    h.endsWith(".sslip.io") ||
    h.endsWith(".")
  )
    throw Error(
      "Use a public HTTPS origin without credentials, paths, query or private-network addresses.",
    );
  return u.origin;
}
export function validateCapabilities(value: unknown): GpuCapabilities {
  const v = value as GpuCapabilities;
  const safe = (s: unknown, max: number) =>
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= max &&
    ![...s].some((c) => c.charCodeAt(0) < 32);
  if (
    !v ||
    v.protocol !== "inkstrip-gpu/1" ||
    !safe(v.retention, 500) ||
    !Array.isArray(v.models) ||
    v.models.length > 32 ||
    !v.models.every(
      (m) =>
        m && [m.id, m.revision, m.task, m.codeLicense, m.weightsLicense].every((s) => safe(s, 120)),
    ) ||
    new Set(v.models.map((m) => m.id)).size !== v.models.length
  )
    throw Error("Unsupported GPU capability response. No images were sent.");
  // Keep only protocol fields. Never trust response URLs, HTML, model code or unknown keys.
  return {
    protocol: v.protocol,
    retention: v.retention,
    models: v.models.map(({ id, revision, task, codeLicense, weightsLicense }) => ({
      id,
      revision,
      task,
      codeLicense,
      weightsLicense,
    })),
  };
}
export async function discoverGpu(
  endpoint: string,
  token: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  signal?.throwIfAborted();
  const origin = gpuEndpoint(endpoint);
  if (token.length > 512 || [...token].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126))
    throw Error("Invalid GPU session credential.");
  const response = await fetcher(origin + "/v1/capabilities", {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 65536 ||
    !response.body ||
    !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")
  )
    throw Error(
      "GPU discovery failed. Check server health, HTTPS, authentication and CORS. No images were sent.",
    );
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      total += r.value.length;
      if (total > 65536) throw Error("GPU response exceeds 64 KiB.");
      chunks.push(r.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  signal?.throwIfAborted();
  return validateCapabilities(JSON.parse(new TextDecoder().decode(bytes)));
}
