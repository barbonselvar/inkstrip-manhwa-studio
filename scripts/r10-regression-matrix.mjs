/** Read-only local release regression orchestration. Each original suite retains
 * its assertions and timeouts. Real model/OCR failures remain nonzero results. */
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const dev = process.argv[2] ?? "http://127.0.0.1:8080",
  built = process.argv[3] ?? "http://127.0.0.1:8082",
  sha = process.argv[4] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
for (const url of [dev, built])
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
    throw Error("Regression matrix only accepts local QA servers.");
if (!/^[a-f0-9]{40}$/.test(sha)) throw Error("An exact built source SHA is required.");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")),
  suites = Object.entries(pkg.scripts).filter(
    ([k, v]) => k.includes(":browser") || v.includes("browser-check"),
  ),
  results = [];
const source = new Set([
    "test:r3:browser",
    "test:r8:processing:browser",
    "test:dialogue:ocr",
    "test:dialogue:render",
    "test:dialogue:security",
    "test:chapter-import:browser",
    "test:chapter-display:browser",
    "test:r10:recovery:browser",
  ]),
  exclusive = new Set(["test:r3:browser", "bench:raster:browser", "test:r10:long-pages:browser"]);
await mkdir("/workspace/r10-evidence/f-matrix", { recursive: true });
async function run([suite], extra = []) {
  const base = source.has(suite) ? dev : built,
    args = [
      "run",
      suite,
      "--",
      base,
      ...(suite === "test:production:browser" ? [sha] : []),
      ...extra,
    ],
    label = suite + (extra.length ? "-enhanced" : ""),
    log = `/workspace/r10-evidence/f-matrix/${label.replaceAll(":", "-")}.log`,
    output = createWriteStream(log),
    start = performance.now();
  console.log(`START ${label} ${base}`);
  const result = await new Promise((resolve) => {
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    child.on("error", (e) => resolve({ exitCode: null, error: e.message }));
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  await new Promise((resolve) => output.end(resolve));
  const row = {
    suite: label,
    base,
    args,
    sha,
    ...result,
    seconds: Math.round((performance.now() - start) / 10) / 100,
    log,
  };
  results.push(row);
  await writeFile(
    "/workspace/r10-evidence/f-browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(`${result.exitCode === 0 ? "PASS" : "FAIL"} ${label} ${row.seconds}s`);
}
// Brush stress, large native benchmarks and long-page tests run without competing
// browser jobs. Other independent fresh-context suites use two processes.
for (const suite of suites.filter(([k]) => exclusive.has(k))) await run(suite);
const queue = suites.filter(([k]) => !exclusive.has(k));
let next = 0;
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (next < queue.length) {
      const item = queue[next++];
      await run(item);
    }
  }),
);
await run(["test:production:browser"], ["--raster", "--ai"]);
console.log(
  JSON.stringify(
    {
      total: results.length,
      passed: results.filter((r) => r.exitCode === 0).length,
      failed: results.filter((r) => r.exitCode !== 0).map((r) => r.suite),
      sha,
    },
    null,
    2,
  ),
);
if (results.some((r) => r.exitCode !== 0)) process.exitCode = 1;
