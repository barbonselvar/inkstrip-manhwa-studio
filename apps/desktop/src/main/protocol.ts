/**
 * `app://inkstrip/…` — serves the bundled studio from the installation (inside app.asar),
 * so the desktop app never loads the website or a development server.
 *
 * - Static files from build/renderer with strict MIME types and a Content Security Policy.
 * - Unknown extension-less paths fall back to index.html (client-side routes).
 * - `/__desktop/file/<token>` streams a file the user chose (opaque token, read-only).
 * - `POST /api/studio/ai-edit` runs the optional cloud AI edit with the user's own key.
 */
import { net, protocol } from "electron";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { FILE_ROUTE } from "../../../../src/lib/desktop/contract.ts";
import { imageEdit } from "../../../../src/lib/ai/image-edit.server.ts";
import type { FileTokens } from "./file-tokens.ts";
import { log } from "./logger.ts";

export const SCHEME = "app";
export const HOST = "inkstrip";

export function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".gz": "application/gzip",
};

export type CloudAiConfig = () => Promise<{ enabled: boolean; key: string | null }>;

export function contentSecurityPolicy(scriptHashes: string[]) {
  return [
    "default-src 'self'",
    // Inline bootstrap scripts are pinned by hash at build time; WebAssembly (AI, OCR,
    // image codecs) needs wasm-unsafe-eval, never unsafe-eval.
    `script-src 'self' 'wasm-unsafe-eval' ${scriptHashes.map((h) => `'${h}'`).join(" ")}`.trim(),
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    // Optional downloads only: AI models (Hugging Face) and OCR language data (GitHub).
    "connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ");
}

export async function installProtocol(options: {
  rendererRoot: string;
  tokens: FileTokens;
  cloudAi: CloudAiConfig;
}) {
  const root = normalize(options.rendererRoot);
  let hashes: string[] = [];
  try {
    hashes = JSON.parse(await readFile(join(root, ".inkstrip-csp.json"), "utf8")).scriptHashes ?? [];
  } catch {
    log.warn("No CSP manifest in renderer bundle; inline scripts will be blocked.");
  }
  const csp = contentSecurityPolicy(hashes);
  const aiAccess = randomBytes(24).toString("hex");

  const securityHeaders = (type: string): Record<string, string> => ({
    "content-type": type,
    "x-content-type-options": "nosniff",
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "no-referrer",
    ...(type.startsWith("text/html") ? { "content-security-policy": csp } : {}),
  });

  const serveFile = async (file: string, cache: string) => {
    const info = await stat(file);
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      status: 200,
      headers: { ...securityHeaders(type), "content-length": String(info.size), "cache-control": cache },
    });
  };

  protocol.handle(SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (url.host !== HOST) return new Response("Not found", { status: 404 });
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/api/studio/ai-edit") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const config = await options.cloudAi();
      if (!config.enabled || !config.key)
        return Response.json(
          {
            error:
              "Cloud AI is off. Turn it on and add your own OpenAI API key in Settings → AI. Local texture repair works offline.",
          },
          { status: 503 },
        );
      // The request can only come from this app's own page; the user's key replaces the
      // website's owner access code.
      const headers = new Headers(request.headers);
      headers.set("origin", new URL(request.url).origin);
      headers.set("x-inkstrip-access", aiAccess);
      const forwarded = new Request(request.url, {
        method: "POST",
        headers,
        body: request.body,
        signal: request.signal,
        duplex: "half",
      } as RequestInit);
      return imageEdit(forwarded, { key: config.key, access: aiAccess }, (input, init) =>
        net.fetch(input as string, init as RequestInit),
      );
    }

    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });

    if (pathname.startsWith(FILE_ROUTE)) {
      const entry = options.tokens.resolve(pathname.slice(FILE_ROUTE.length), [
        "project",
        "web-backup",
        "recovery",
        "backup",
      ]);
      if (!entry) return new Response("Not found", { status: 404 });
      try {
        const info = await stat(entry.path);
        return new Response(Readable.toWeb(createReadStream(entry.path)) as ReadableStream, {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(info.size),
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    // Static bundle. Resolve, then require the result to stay inside the bundle root.
    const relative = normalize(pathname).replace(/^[\\/]+/, "");
    const candidate = normalize(join(root, relative));
    if (candidate !== root && !candidate.startsWith(root + sep))
      return new Response("Not found", { status: 404 });
    if (relative && extname(relative)) {
      try {
        const immutable = relative.startsWith(`assets${sep}`) || relative.startsWith("assets/");
        return await serveFile(candidate, immutable ? "public, max-age=31536000, immutable" : "no-cache");
      } catch {
        return new Response("Not found", { status: 404, headers: { "x-content-type-options": "nosniff" } });
      }
    }
    // Client-side route (/, /p/<id>, /p/<id>/c/<id>): the SPA shell.
    return serveFile(join(root, "index.html"), "no-cache");
  });
}
