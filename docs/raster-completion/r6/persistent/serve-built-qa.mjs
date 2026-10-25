import http from "node:http";
http
  .createServer((req, res) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: 8081,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1:8081", "accept-encoding": "identity" },
      },
      (upstream) => {
        const headers = { ...upstream.headers };
        if (new URL(req.url, "http://127.0.0.1").pathname.endsWith(".wasm"))
          headers["content-type"] = "application/wasm";
        res.writeHead(upstream.statusCode, headers);
        upstream.pipe(res);
      },
    );
    request.on("error", () => {
      res.writeHead(502);
      res.end("Local validation upstream unavailable");
    });
    req.pipe(request);
  })
  .listen(8082, "127.0.0.1", () => console.log("Local uncompressed validation transport ready"));
