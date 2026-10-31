/** Isolated real LaMa feasibility experiment, never a shipping feature claim. */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } }
      : {}),
  });
try {
  const p = await browser.newPage();
  p.setDefaultTimeout(240000);
  p.on("console", (m) => console.log(m.text().slice(0, 500)));
  await p.goto(new URL("/gallery/provenance.json", base).href);
  const result = await p.evaluate(async () => {
    const bitmap = await createImageBitmap(
        await (await fetch("/gallery/adventure-720.webp")).blob(),
      ),
      c = new OffscreenCanvas(512, 512),
      ctx = c.getContext("2d");
    ctx.drawImage(
      bitmap,
      (bitmap.width - 512) / 2,
      (bitmap.height - 512) / 2,
      512,
      512,
      0,
      0,
      512,
      512,
    );
    bitmap.close();
    const blob = await c.convertToBlob(),
      worker = new Worker("/scripts/r14/lama-evaluation-worker.ts", { type: "module" }),
      stages = [];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(Error("LaMa exceeded the 180-second research budget."));
      }, 180000);
      worker.onmessage = async ({ data }) => {
        const { blob, ...info } = data;
        stages.push(info);
        console.log("LAMA " + JSON.stringify(info));
        if (data.stage === "result" || data.stage === "error") {
          clearTimeout(timer);
          worker.terminate();
          resolve({
            stages,
            realInference: data.stage === "result",
            error: data.error,
            output: blob
              ? await new Promise((r) => {
                  const f = new FileReader();
                  f.onload = () => r(f.result);
                  f.readAsDataURL(blob);
                })
              : undefined,
          });
        }
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        reject(Error(e.message));
      };
      worker.postMessage({ blob });
    });
  });
  if (result.output) {
    await p.setContent(`<img src="${result.output}" width="512" height="512">`);
    await p.screenshot({ path: "/workspace/screenshots/r14-lama-prototype.png" });
    delete result.output;
  }
  await writeFile("/workspace/r14-evidence/lama-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.realInference) process.exitCode = 1;
} finally {
  await browser.close();
}
