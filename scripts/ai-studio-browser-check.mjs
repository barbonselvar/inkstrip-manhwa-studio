/** Real Swin2SR inference. GPU discovery responses alone are mocked and are labelled as such. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
import { fromPanel } from "../src/lib/studio/pro/model.ts";
import { SWIN } from "../src/lib/studio/ai/registry.ts";
import { integrityMetrics } from "../src/lib/studio/ai/benchmark.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
// An optional exact, verified download cache speeds QA. It never substitutes model outputs.
const cached = process.env.INKSTRIP_QA_MODEL_CACHE
  ? await readFile(process.env.INKSTRIP_QA_MODEL_CACHE)
  : null;
if (cached) assert.equal(createHash("sha256").update(cached).digest("hex"), SWIN.sha256);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  reports = [];
try {
  for (const width of [1440, 320, 390]) {
    const mobile = width < 500,
      c = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: mobile,
        isMobile: mobile,
        reducedMotion: "reduce",
      }),
      p = await c.newPage(),
      errors = [],
      uploads = [];
    if (cached)
      await c.route(SWIN.artifact, (r) =>
        r.fulfill({ status: 200, contentType: "application/octet-stream", body: cached }),
      );
    p.on("request", (r) => {
      if (
        ["POST", "PUT", "PATCH"].includes(r.method()) &&
        new URL(r.url()).origin !== new URL(base).origin
      )
        uploads.push(r.url());
    });
    const { start, open, load, native, raster, records, same } = proBrowserFixtures(base, errors);
    const source = await start(p),
      chapter = await records(p);
    await open(p, "Raster");
    const d = fromPanel({
      id: "ai-fixture",
      name: "AI line/color/alpha integrity",
      width: 128,
      height: 96,
    });
    d.layers[0].mask = {
      enabled: true,
      selection: { regions: [], inverted: true, feather: 0 },
      strokes: [],
      density: 1,
    };
    d.selection = {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 4, y: 4 },
            { x: 20, y: 20 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    };
    await load(p, d, source);
    const beforeDoc = (await native(p)).value.document,
      beforePixels = await raster(p);
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p.getByRole("button", { name: "Open in AI Studio", exact: true }).click();
    await p.getByRole("dialog", { name: "Inkstrip AI Studio", exact: true }).waitFor();
    const ai = () =>
      p
        .getByRole("group", { name: "Switch editing mode", exact: true })
        .getByRole("button", { name: "AI Studio", exact: true })
        .click();
    const panels = async () => {
      const b = p.getByRole("button", { name: "Toggle Pro panels", exact: true });
      if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
    };
    await panels();
    await p.getByRole("button", { name: "Advanced", exact: true }).click();
    assert.ok(await p.getByLabel("AI denoise", { exact: true }).isVisible());
    assert.equal(
      await p.getByLabel("AI prompt", { exact: true }).count(),
      0,
      "Swin2SR exposes no unsupported prompt",
    );
    await p.getByRole("button", { name: "Simple", exact: true }).click();
    // Cancellation before/during input preparation must never insert a result.
    await p.getByRole("button", { name: "Generate restoration preview", exact: true }).click();
    await p.getByRole("button", { name: "Cancel AI processing", exact: true }).click();
    await p.getByText("Cancelled. Document and Chapter unchanged.", { exact: true }).waitFor();
    assert.deepEqual((await native(p)).value.document, beforeDoc);
    await ai();
    const started = performance.now();
    await p.getByRole("button", { name: "Generate restoration preview", exact: true }).click();
    await p
      .getByRole("button", { name: "Accept AI result layer", exact: true })
      .waitFor({ timeout: 180000 });
    const elapsed = performance.now() - started;
    assert.deepEqual((await native(p)).value.document, beforeDoc, "Preview is not committed");
    await ai();
    await p.screenshot({ path: `/workspace/screenshots/f1-ai-preview-${width}.png` });
    // A real document edit makes the pending preview stale; Undo restores the exact snapshot.
    await p
      .getByRole("navigation", { name: "Pro panels", exact: true })
      .getByRole("button", { name: "Properties", exact: true })
      .click();
    await p.getByLabel("Layer opacity", { exact: true }).fill("75");
    await ai();
    assert.ok(
      await p.getByRole("button", { name: "Accept AI result layer", exact: true }).isDisabled(),
    );
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    assert.ok(
      await p.getByRole("button", { name: "Accept AI result layer", exact: true }).isEnabled(),
    );
    await p.getByRole("button", { name: "Accept AI result layer", exact: true }).click();
    await p.getByText("Accepted as an editable AI result layer.", { exact: true }).waitFor();
    const accepted = (await native(p)).value;
    assert.equal(accepted.version, 6);
    assert.equal(accepted.document.layers.length, beforeDoc.layers.length + 1);
    assert.deepEqual(accepted.document.layers.slice(0, -1), beforeDoc.layers);
    assert.deepEqual(accepted.document.selection, beforeDoc.selection);
    const result = accepted.document.layers.at(-1);
    assert.equal(result.ai.modelRevision, SWIN.revision);
    assert.equal(result.ai.weightsSha256, SWIN.sha256);
    assert.ok(accepted.assets[result.ai.sourceAssetId]);
    const afterPixels = await raster(p),
      coverage = new Uint8Array(128 * 96);
    for (let y = 4; y < 20; y++) for (let x = 4; x < 20; x++) coverage[y * 128 + x] = 255;
    const metrics = integrityMetrics(
      Uint8ClampedArray.from(beforePixels.pixels),
      Uint8ClampedArray.from(afterPixels.pixels),
      coverage,
    );
    if (width === 1440) {
      for (const [name, image] of [
        ["before", beforePixels],
        ["after", afterPixels],
      ]) {
        const data = await p.evaluate((image) => {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          canvas
            .getContext("2d")
            .putImageData(
              new ImageData(Uint8ClampedArray.from(image.pixels), image.width, image.height),
              0,
              0,
            );
          return canvas.toDataURL().split(",")[1];
        }, image);
        await writeFile(`/workspace/f1-${name}.png`, Buffer.from(data, "base64"));
      }
    }
    assert.equal(metrics.protectedMaxError, 0);
    assert.equal(metrics.alphaChanges, 0);
    assert.ok(metrics.changedPixels > 0, "Real neural inference changes selected visible pixels");
    await p.getByRole("button", { name: "Pro undo", exact: true }).click();
    same(await raster(p), beforePixels);
    await p.getByRole("button", { name: "Pro redo", exact: true }).click();
    same(await raster(p), afterPixels);
    for (const mime of ["image/jpeg", "image/webp"]) {
      const image = await raster(p, mime);
      assert.equal(image.width, 128);
      assert.equal(image.height, 96);
    }
    assert.deepEqual(await records(p), chapter, "AI output never overwrites Chapter");
    await p.getByRole("button", { name: "Back to chapter from Pro Studio", exact: true }).click();
    await p.reload();
    await p.getByRole("button", { name: "Open in AI Studio", exact: true }).click();
    await panels();
    assert.deepEqual(
      (await native(p)).value.document,
      accepted.document,
      "AI layers/masks/provenance survive saved draft reopening",
    );
    await ai();
    // GPU FOUNDATION test double: validates protocol/auth/consent, not GPU inference.
    await p
      .locator("summary")
      .filter({ hasText: /^Optional self-hosted GPU discovery$/ })
      .click();
    const check = p.getByRole("button", { name: "Check GPU capabilities", exact: true });
    assert.ok(await check.isDisabled());
    await p.getByLabel("GPU HTTPS origin", { exact: true }).fill("https://127.0.0.1");
    await p.getByRole("checkbox", { name: /Allow this capability request/ }).check();
    await check.click();
    await p.getByText(/Use a public HTTPS origin/).waitFor();
    await p.route("https://gpu.example.org/v1/capabilities", (route) => {
      const cors = {
        "Access-Control-Allow-Origin": new URL(base).origin,
        "Access-Control-Allow-Headers": "authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: cors });
      assert.equal(route.request().method(), "GET");
      assert.equal(route.request().postData(), null);
      assert.equal(route.request().headers().authorization, "Bearer qa-session-only");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify({
          protocol: "inkstrip-gpu/1",
          retention: "QA metadata only",
          models: [],
        }),
      });
    });
    await p.getByLabel("GPU HTTPS origin", { exact: true }).fill("https://gpu.example.org");
    await p.getByLabel("GPU session token", { exact: true }).fill("qa-session-only");
    await p.getByRole("checkbox", { name: /Allow this capability request/ }).check();
    await check.click();
    await p.getByText(/Connected protocol inkstrip-gpu\/1/).waitFor();
    assert.ok(!(await (await native(p)).bytes.toString()).includes("qa-session-only"));
    await ai();
    await p.getByRole("button", { name: "Disconnect and clear credential", exact: true }).click();
    assert.equal(await p.getByLabel("GPU session token", { exact: true }).inputValue(), "");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(uploads, []);
    reports.push({
      width,
      touchEmulation: mobile,
      model: SWIN.id,
      revision: SWIN.revision,
      artifactSha256: SWIN.sha256,
      realInference: true,
      processingRegion: result.ai.region,
      measuredWallMs: elapsed,
      receiptElapsedMs: result.ai.elapsedMs,
      metrics,
      jsHeap: await p.evaluate(() => performance.memory?.usedJSHeapSize ?? null),
      gpuDiscovery: "mock transport only; no GPU execution",
      errors,
      externalArtworkUploads: uploads.length,
    });
    console.log(JSON.stringify(reports.at(-1)));
    await c.close();
  }
  await writeFile(
    "/workspace/f1-ai-browser-report.json",
    JSON.stringify(
      {
        browser: browser.version(),
        fixture:
          "internally generated RGBA geometry/color/alpha fixture; not a manhwa quality qualification",
        modelTransport: cached ? "exact hash-verified cache" : "official pinned checkpoint",
        reports,
      },
      null,
      2,
    ),
  );
  console.log(
    "AI Studio F1 real-inference, approval, persistence, export and touch integrity: PASS",
  );
} finally {
  await browser.close();
}
