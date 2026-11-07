#!/usr/bin/env node
/**
 * Loopback-only update feed for controlled update tests:
 *   node apps/desktop/test/update-feed-server.mjs <folder with latest.yml> [port]
 * Start an INSTALLED Inkstrip with INKSTRIP_UPDATE_TEST_FEED=http://127.0.0.1:<port>/ ;
 * the app accepts test feeds only from 127.0.0.1/localhost. Supports Range requests
 * (differential/blockmap downloads) and logs every request.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";

const folder = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8765);
createServer((req, res) => {
  const name = basename(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(folder, name);
  let size;
  try {
    size = statSync(file).size;
  } catch {
    console.log(`404 ${req.method} ${req.url}`);
    res.writeHead(404).end();
    return;
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = Number(range[1]),
      end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, "accept-ranges": "bytes" });
    createReadStream(file, { start, end }).pipe(res);
    console.log(`206 ${req.method} ${name} ${start}-${end}`);
    return;
  }
  res.writeHead(200, { "content-length": size, "accept-ranges": "bytes" });
  createReadStream(file).pipe(res);
  console.log(`200 ${req.method} ${name} ${size}`);
}).listen(port, "127.0.0.1", () => console.log(`Update test feed on http://127.0.0.1:${port}/ serving ${folder}`));
