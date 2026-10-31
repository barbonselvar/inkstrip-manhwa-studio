/** R13 long-session leak benchmark (real UI). Repeats open/close and import/delete
 * cycles and records, after a forced GC: JS heap, live object URLs (created minus
 * revoked) and live Web Workers (constructed minus terminated). A leak shows as
 * monotonic growth across cycles. Usage: node scripts/r13/memory-benchmark.mjs [base] [cycles] [out] */
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
const cycles = Number(process.argv[3] ?? 6);
const out = process.argv[4];
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  const live = new Set(),
    make = URL.createObjectURL.bind(URL),
    free = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    const u = make(b);
    live.add(u);
    return u;
  };
  URL.revokeObjectURL = (u) => {
    live.delete(u);
    free(u);
  };
  let workers = 0;
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      workers++;
      this.__alive = true;
    }
    terminate() {
      if (this.__alive) {
        this.__alive = false;
        workers--;
      }
      super.terminate();
    }
  };
  window.__probe = () => ({ urls: live.size, workers });
});
const p = await context.newPage();
p.setDefaultTimeout(60000);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const cdp = await context.newCDPSession(p);
await cdp.send("HeapProfiler.enable");
async function sample(label) {
  await p.waitForTimeout(600);
  for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
  const heap = (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;
  const probe = await p.evaluate(() => window.__probe());
  return { label, heapMB: +heap.toFixed(1), ...probe };
}
await p.goto(base);
await p.getByRole("button", { name: "New project", exact: true }).click();
await p.getByPlaceholder("Night Market").fill("Memory");
await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
await p.getByText("Chapter workspace", { exact: true }).waitFor();
const page = await p.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 1080, 1920);
  g.addColorStop(0, "#246");
  g.addColorStop(1, "#fc8");
  x.fillStyle = g;
  x.fillRect(0, 0, 1080, 1920);
  for (let i = 0; i < 400; i++) {
    x.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`;
    x.fillRect((i * 97) % 1000, (i * 53) % 1880, 40, 30);
  }
  return c.toDataURL().split(",")[1];
});
const file = (name) => ({ name, mimeType: "image/png", buffer: Buffer.from(page, "base64") });
await p
  .locator("input[type=file]")
  .first()
  .setInputFiles([file("base.png")]);
await p.getByRole("button", { name: "Edit Image base.png", exact: true }).waitFor();
const rows = [await sample("start")];
for (let c = 1; c <= cycles; c++) {
  // Raster Studio open/close.
  await p.getByRole("button", { name: "Open in Raster Studio", exact: true }).click();
  await p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true }).waitFor();
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        ?.getAttribute("aria-busy") === "false",
  );
  await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
  await p
    .getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true })
    .waitFor({ state: "detached" });
  // Image editor open/close.
  await p.getByRole("button", { name: "Edit Image base.png", exact: true }).click();
  await p.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor();
  await p.keyboard.press("Escape");
  await p.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "detached" });
  // Import three pages, then delete them.
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([file(`a${c}.png`), file(`b${c}.png`), file(`c${c}.png`)]);
  await p.getByRole("button", { name: `Edit Image c${c}.png`, exact: true }).waitFor();
  for (const n of ["a", "b", "c"]) {
    await p.getByRole("button", { name: `Remove ${n}${c}.png`, exact: true }).click();
    await p
      .getByRole("button", { name: `Edit Image ${n}${c}.png`, exact: true })
      .waitFor({ state: "detached" });
  }
  rows.push(await sample(`cycle ${c}`));
  console.log(JSON.stringify(rows.at(-1)));
}
await browser.close();
if (errors.length) console.log("page errors:", errors);
if (out) await writeFile(out, JSON.stringify({ base, cycles, rows, errors }, null, 2));
