import { timingSafeEqual } from "node:crypto";
const MAX_BODY = 4_000_000;
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
    const valid = async (value: FormDataEntryValue | null) => {
      if (
        !(value instanceof Blob) ||
        value.type !== "image/png" ||
        value.size < 24 ||
        value.size > 2_000_000
      )
        return false;
      const b = new DataView(await value.slice(0, 24).arrayBuffer());
      return (
        b.getUint32(0) === 0x89504e47 &&
        b.getUint32(4) === 0x0d0a1a0a &&
        b.getUint32(16) > 0 &&
        b.getUint32(20) > 0 &&
        b.getUint32(16) <= 1024 &&
        b.getUint32(20) <= 1024
      );
    };
    if (
      !(await valid(image)) ||
      !(await valid(mask)) ||
      (op === "face" && !(await valid(reference)))
    )
      return fail(
        "Valid PNG context, mask, and face reference (when needed), up to 1024px, required.",
        400,
      );
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
    if (typeof encoded !== "string" || encoded.length > 24_000_000)
      return fail("Provider returned no usable image.", 502);
    const output = Buffer.from(encoded, "base64");
    if (output.readUInt32BE(0) !== 0x89504e47)
      return fail("Provider returned an invalid PNG.", 502);
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
