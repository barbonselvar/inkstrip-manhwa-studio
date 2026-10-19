# Phase 4 — Object selection and optional AI inpainting

Open Edit Image → Object Eraser & Retouch. The current draft is rendered once into
this workspace. Brush, lasso, ellipse and rectangle selections support subtraction,
feathering, selection undo/redo, zoom and pan. Preview is separate from Accept;
Save persists only accepted PNG output in the existing atomic media transaction.
Original recovery remains in the main editor. Close discards this retouch session.
Up to four accepted versions remain available for result undo/redo during a session.

Local texture repair is a deterministic exemplar/SSD reconstruction algorithm in a
worker, **not generative AI**. It synthesizes selected pixels from unselected context;
it does not blur, paint solid color or delete pixels. The local context is 256 square
pixels. It suits flat/textured backgrounds, not complex faces or perspective.
Context selection is bounded to 4096 native pixels; images are bounded to 16MP /
16384px per side. Output keeps native dimensions, PNG and exact unselected RGB/alpha.
Workers are terminated on cancellation and close. Progress represents local fill;
cloud inference progress is explicitly indeterminate.

## Optional genuine AI path

Server route `/api/studio/ai-edit` calls OpenAI Images edits, model `gpt-image-1`.
No cloud service is used unless the user explicitly selects cloud mode, enters the
owner access code and checks upload consent. The selected context and mask are
sent; character reference crops are additionally sent for Face Fix. The server
creates the provider prompt and fixed endpoint, requires same origin + a separate
owner code, streams at most 4MB, validates PNG dimensions/signatures, applies a
110-second timeout, returns generic errors and no-store responses. Keys and image
contents are never logged. Requests/outputs are not cached. No user URL is fetched.
Only selected output pixels are blended back locally; outside pixels stay exact.

Configure manually on your own server (no environment values changed by this work):

- `INKSTRIP_OPENAI_API_KEY`: server-only OpenAI API key with image editing access.
- `INKSTRIP_AI_ACCESS_TOKEN`: strong random owner access code (32+ random bytes).
  Share only with trusted studio users; it is not saved in the browser. Never use
  the provider API key as this code. This is an owner gate, not multi-user auth.

Never prefix these with VITE_. Deployment is disabled by default without both.
OpenAI is a paid hosted proprietary service, not a redistributed open-weight model.
Costs depend on image input/output tokens, quality and current provider pricing:
https://openai.com/api/pricing/ . Review provider retention/data policies before use:
https://platform.openai.com/docs/guides/your-data . Cancellation cannot guarantee
provider billing stops. Configure the hosting function duration above 110 seconds
if your Vercel plan permits; a shorter platform limit fails without saving output.
No Vite/Nitro/Vercel configuration or tslib fix is changed.

Investigated browser alternatives: LaMa-style ONNX generative inpainting requires
large weights, compatible exported operators, substantial memory and a vetted model
license; this project does not silently download or pretend to run such a model.
WASM texture synthesis is the practical offline fallback. A cloud credential was
not available, so paid model quality/latency were not tested. Provider-contract,
protection and error tests use transport fixtures; they are not AI quality tests.

Manual test: draw each shape, subtract, feather, preview local repair, reject/retry,
accept, undo/redo, save, reopen, restore original. In cloud mode, verify disclosure,
missing-service/access errors and cancel; with configured resources, verify genuine
inpainting quality on a copy of artwork before accepting.
