# User-controlled GPU connector protocol

F1 implements **discovery only**. It does not submit inference jobs, upload artwork,
run model code from a server, or treat a server claim as qualified inference.

## Implemented discovery

User enters a public HTTPS origin and an optional bearer credential into volatile
workspace memory, then explicitly allows the request. Only then the browser sends:

```
GET https://<user-origin>/v1/capabilities
Authorization: Bearer <user-session-credential>  # only if supplied
```

No cookies, redirects, referrer, image, mask, prompt or request body. Timeout 10s,
response ≤64 KiB, up to 32 unique advertised models. Authentication/CORS/network,
abort, malformed/oversized payloads and HTTP failures leave editing data unchanged.
The server must return `Content-Type: application/json` and configure CORS for the
actual Inkstrip origin, including authorization preflight; do not allow arbitrary
origins to use privileged credentials. Use short-lived scoped tokens. Never embed
shared secrets in frontend source or VITE environment variables.

```json
{
  "protocol": "inkstrip-gpu/1",
  "retention": "Describe the actual user-controlled policy; no deletion guarantee",
  "models": [{
    "id": "a-server-model",
    "revision": "immutable-checkpoint-revision",
    "task": "inpainting",
    "codeLicense": "SPDX identifier or documented restriction",
    "weightsLicense": "Exact checkpoint license"
  }]
}
```

All strings are bounded; fields are displayed as React text, never HTML. Unknown
fields (including remote artifact/result URLs or model code) are discarded.
Discovering a model does not enable it. Registry/license/runtime/quality qualification
is still required locally. The UI labels server models as unqualified.

Only public HTTPS origins on port443 without credentials/path/query/fragment are
accepted. IP literals, common local suffixes and IP-alias services are rejected.
Browser DNS cannot be pinned here; CORS/PNA and user ownership/trust remain relevant.
There is no privileged backend fetch, service credential or SSRF proxy. Do not
connect to an endpoint you do not control/trust: it receives your IP and, if supplied,
your session credential. F1 does not promise server-side retention/deletion.

## Reserved F2+ job design — not implemented in F1

A future version must use explicit artwork-transfer consent independently of metadata
health checks. Negotiate qualified model/task/revision, input shape/color/alpha,
limits, settings and retention. Jobs need strict request/response schemas,
idempotency keys bound to an immutable source/mask digest and user, time/byte/queue
limits, authenticated ownership checks, bounded status polling, monotonic progress,
explicit cancellation and TTL expiration. Do not automatically retry image uploads.

Candidate endpoints are `POST /v1/jobs`, `GET /v1/jobs/:id`,
`DELETE /v1/jobs/:id`, and authenticated same-origin result retrieval. No arbitrary
result redirect/URL. Verify PNG signatures/dimensions/bytes before decoding, compare
source/document revisions again before acceptance, and insert only an explicitly
approved new layer. Do not run long GPU jobs inside Vercel request functions.
A reference inference service belongs with a selected, licensed, actually tested
model in F2; a fake inference server is deliberately not provided in F1.
