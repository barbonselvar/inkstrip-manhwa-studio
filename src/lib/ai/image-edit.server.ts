import { timingSafeEqual } from "node:crypto";
import { PngError, validatePng, type PngInfo } from "./png-guard.server.ts";
const MAX_BODY = 4_000_000;
const INPUT = { maxSide: 1024, maxBytes: 2_000_000 };
/** The provider is asked for one 1024 × 1024 PNG; anything else is not a usable result. */
const OUTPUT = { side: 1024, maxBytes: 16_000_000 };
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const fail = (error: string, status: number) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
export async function imageEdit(
  request: Request,
  config: { key?: string; access?: string },
  transport: typeof fetch = fetch,
) {
  if (!config.key || !config.access)
    return fail("Cloud editing is not configured. Local texture repair remains available.", 503);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return fail("Same-origin requests only.", 403);
  const supplied = Buffer.from(request.headers.get("x-inkstrip-access") ?? ""),
    expected = Buffer.from(config.access);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return fail("Owner access code required.", 403);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    return fail("PNG multipart upload required.", 415);
  try {
    // Bound actual streamed bytes, not just the untrusted Content-Length header.
    const reader = request.body?.getReader();
    if (!reader) return fail("Missing upload.", 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BODY) {
        await reader.cancel();
        return fail("Upload exceeds 4 MB.", 413);
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks);
    const parsed = await new Response(raw, {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
    const image = parsed.get("image"),
      mask = parsed.get("mask"),
      reference = parsed.get("reference"),
      op = parsed.get("operation");
    if (op !== "erase" && op !== "face") return fail("Unsupported operation.", 400);
    // Complete bounded validation before any provider call (INK-AUD-002): the PNG must
    // decode, and the mask must cover exactly the image it edits.
    const inspect = async (value: FormDataEntryValue | null): Promise<PngInfo | undefined> => {
      if (!(value instanceof Blob) || value.type !== "image/png" || value.size > INPUT.maxBytes)
        return undefined;
      try {
        return validatePng(new Uint8Array(await value.arrayBuffer()), INPUT);
      } catch (error) {
        if (error instanceof PngError) return undefined;
        throw error;
      }
    };
    const imageInfo = await inspect(image),
      maskInfo = await inspect(mask),
      referenceInfo = op === "face" ? await inspect(reference) : undefined;
    if (!imageInfo || !maskInfo || (op === "face" && !referenceInfo))
      return fail(
        "Valid PNG context, mask, and face reference (when needed), up to 1024px, required.",
        400,
      );
    if (imageInfo.width !== maskInfo.width || imageInfo.height !== maskInfo.height)
      return fail("The mask must have the same dimensions as the image.", 400);
    const body = new FormData();
    body.set("model", "gpt-image-1");
    body.append("image[]", image as Blob, "context.png");
    if (op === "face") body.append("image[]", reference as Blob, "identity-reference.png");
    body.set("mask", mask as Blob, "mask.png");
    body.set("size", "1024x1024");
    body.set("quality", "medium");
    body.set("output_format", "png");
    body.set("n", "1");
    const instruction =
      op === "erase"
        ? "Remove the selected unwanted object. Reconstruct the missing background naturally using surrounding manhwa line art, texture, geometry, lighting and palette. Keep everything outside the mask unchanged."
        : "The second image is a character identity reference, not a face to paste. Correct only the selected face in the first image to resemble that character. Preserve target pose, head angle, expression, lighting, hairstyle, clothing and illustration style. Do not change other characters. Perfect identity matching is not guaranteed.";
    const notes = String(parsed.get("notes") ?? "").slice(0, 1000);
    body.set("prompt", instruction + " User appearance notes: " + notes);
    const response = await transport("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}` },
      body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]),
    });
    if (!response.ok)
      return fail(
        response.status === 429
          ? "Provider quota or rate limit reached. Retry later."
          : "Provider rejected or failed the edit. Check server configuration and model access.",
        502,
      );
    const payload = await response.json();
    const encoded = payload?.data?.[0]?.b64_json;
    // Complete output validation (INK-AUD-003): strict base64, bounded size, a fully
    // decodable PNG of the requested dimensions. Anything else never reaches the editor.
    if (
      typeof encoded !== "string" ||
      encoded.length > Math.ceil(OUTPUT.maxBytes / 3) * 4 ||
      !BASE64.test(encoded)
    )
      return fail("Provider returned no usable image. Your artwork is unchanged.", 502);
    const output = Buffer.from(encoded, "base64");
    try {
      const info = validatePng(output, { maxSide: OUTPUT.side, maxBytes: OUTPUT.maxBytes });
      if (info.width !== OUTPUT.side || info.height !== OUTPUT.side) throw new PngError("size");
    } catch (error) {
      if (!(error instanceof PngError)) throw error;
      return fail("Provider returned an invalid PNG. Your artwork is unchanged.", 502);
    }
    return new Response(output, {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (error) {
    return fail(
      (error as Error).name === "TimeoutError"
        ? "AI request timed out. No image was saved."
        : "AI request failed or was cancelled. No image was saved.",
      502,
    );
  }
}
