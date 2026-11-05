/** Optional extension adapters stay outside normal rendering and never run on editor load. */
export type ExtensionCapabilities = {
  available: boolean;
  name: string;
  edges: ("top" | "bottom")[];
  maxPixels: number;
  reason?: string;
};
export type ExtensionRequest = {
  source: Blob;
  edge: "top" | "bottom";
  pixels: number;
  signal: AbortSignal;
};
export interface ExtensionProvider {
  capabilities(signal?: AbortSignal): Promise<ExtensionCapabilities>;
  extend(request: ExtensionRequest): Promise<Blob>;
}
export const EXTENSION_UNAVAILABLE: ExtensionCapabilities = {
  available: false,
  name: "Image extension",
  edges: [],
  maxPixels: 0,
  reason:
    "No compatible image-extension backend is configured. Traditional composition works offline.",
};
/** A future app-owned adapter may wrap a verified local/free backend. No paid provider is installed. */
export async function extensionCapabilities(
  provider?: ExtensionProvider,
  signal?: AbortSignal,
): Promise<ExtensionCapabilities> {
  signal?.throwIfAborted();
  if (!provider) return EXTENSION_UNAVAILABLE;
  try {
    const result = await provider.capabilities(signal);
    signal?.throwIfAborted();
    if (
      !result ||
      typeof result.available !== "boolean" ||
      !Number.isSafeInteger(result.maxPixels) ||
      result.maxPixels < 0 ||
      !Array.isArray(result.edges) ||
      result.edges.some((edge) => !["top", "bottom"].includes(edge))
    )
      throw Error("Invalid extension capabilities");
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    return {
      ...EXTENSION_UNAVAILABLE,
      reason: error instanceof Error ? error.message : "The extension backend is unavailable.",
    };
  }
}
export async function requestExtension(
  provider: ExtensionProvider | undefined,
  input: ExtensionRequest,
): Promise<Blob> {
  const caps = await extensionCapabilities(provider, input.signal);
  if (!provider || !caps.available || !caps.edges.includes(input.edge))
    throw Error(caps.reason ?? "This backend does not support the requested extension.");
  if (
    !Number.isInteger(input.pixels) ||
    input.pixels < 1 ||
    input.pixels > 100000 ||
    !input.source.size
  )
    throw Error("Invalid image-extension request.");
  input.signal.throwIfAborted();
  const result = await provider.extend(input);
  input.signal.throwIfAborted();
  if (!(result instanceof Blob) || !result.size || !result.type.startsWith("image/"))
    throw Error("The extension backend returned no usable image. Original artwork is unchanged.");
  // An integrating adapter must run the shared image preflight and native-size validation
  // before committing its result as a new composition asset; this API never stores artwork.
  return result;
}
