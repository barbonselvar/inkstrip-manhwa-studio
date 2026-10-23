/** F1 failure/security/mobile checks. Discovery is mocked; this script claims no neural inference. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { SWIN } from "../src/lib/studio/ai/registry.ts";
import { proBrowserFixtures } from "./pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  reports = [];
try {
  for (const width of [320, 360, 390, 768, 1440]) {
    const c = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
        reducedMotion: "reduce",
      }),
      p = await c.newPage(),
      errors = [];
    const f = proBrowserFixtures(base, errors);
    await f.start(p);
    // Seed a real pre-F1 database before Pro opens. Upgrade must preserve its records.
    await p.evaluate(async () => {
      const db = await new Promise((ok, no) => {
        const r = indexedDB.open("inkstrip-pro", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("sessions", { keyPath: "id" });
        r.onsuccess = () => ok(r.result);
        r.onerror = () => no(r.error);
      });
      await new Promise((ok, no) => {
        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put({ id: "legacy-sentinel", unchanged: "original-v1-record" });
        tx.oncomplete = ok;
        tx.onerror = no;
      });
      db.close();
    });
    await f.open(p);
    const before = await f.native(p);
    const storage = await p.evaluate(async () => {
      let oldError = "";
      try {
        await new Promise((ok, no) => {
          const r = indexedDB.open("inkstrip-pro", 1);
          r.onerror = () => no(r.error);
          r.onsuccess = () => {
            r.result.close();
            ok();
          };
        });
      } catch (e) {
        oldError = e.name;
      }
      const db = await new Promise((ok) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onsuccess = () => ok(r.result);
      });
      const record = await new Promise((ok) => {
        const r = db.transaction("sessions").objectStore("sessions").get("legacy-sentinel");
        r.onsuccess = () => ok(r.result);
      });
      const version = db.version;
      db.close();
      return { oldError, record, version };
    });
    assert.equal(storage.version, 2);
    assert.equal(storage.oldError, "VersionError");
    assert.equal(storage.record.unchanged, "original-v1-record");
    // Corrupt image bytes with valid document metadata must not replace or autosave the current doc.
    for (const corruption of ["header", "decode", "missing", "metadata", "future"]) {
      const bad = structuredClone(before.value);
      bad.document.layers[0].name = "MUST NOT COMMIT";
      if (corruption === "header") for (const a of Object.values(bad.assets)) a.data = "AQID";
      if (corruption === "decode")
        for (const a of Object.values(bad.assets))
          a.data = Buffer.from(a.data, "base64").subarray(0, 24).toString("base64");
      if (corruption === "missing") bad.assets = {};
      if (corruption === "metadata") bad.document.layers[0].opacity = 3;
      if (corruption === "future") bad.version = 7;
      await f.tab(p, "Assets");
      await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
        name: "corrupt.inkstrip",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(bad)),
      });
      await p.locator(".pro-alert").waitFor();
      assert.deepEqual((await f.native(p)).value.document, before.value.document);
    }
    // Legacy native files may embed JPEG or WebP, not only PNG. Decode actual codec output.
    const formats = await p.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgba(120,80,180,0.5)";
      ctx.fillRect(0, 0, 128, 96);
      const formats = ["image/jpeg", "image/webp"].map((mime) => ({
        mime,
        data: canvas.toDataURL(mime).split(",")[1],
      }));
      // A real EXIF orientation6 segment exercises Chromium's oriented decoding.
      const jpeg = Uint8Array.from(atob(formats[0].data), (c) => c.charCodeAt(0)),
        exif = Uint8Array.from([
          255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1,
          0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        ]),
        bytes = new Uint8Array(jpeg.length + exif.length);
      bytes.set(jpeg.subarray(0, 2));
      bytes.set(exif, 2);
      bytes.set(jpeg.subarray(2), 2 + exif.length);
      formats.push({ mime: "image/jpeg", data: btoa(String.fromCharCode(...bytes)) });
      return formats;
    });
    for (const image of formats) {
      const file = structuredClone(before.value);
      for (const id of Object.keys(file.assets)) file.assets[id] = image;
      await f.tab(p, "Assets");
      await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
        name: "legacy-codec.inkstrip",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(file)),
      });
      await p
        .getByText("Native document imported into this Pro draft. Chapter unchanged.", {
          exact: true,
        })
        .waitFor();
      assert.equal((await f.raster(p)).width, 128);
    }
    // The exported file really imports after the previous failures; byte and geometry fidelity hold.
    await f.tab(p, "Assets");
    await p.getByLabel("Import Pro asset", { exact: true }).setInputFiles({
      name: "valid.inkstrip",
      mimeType: "application/json",
      buffer: before.bytes,
    });
    await p
      .getByText("Native document imported into this Pro draft. Chapter unchanged.", {
        exact: true,
      })
      .waitFor();
    await p
      .getByRole("group", { name: "Switch editing mode", exact: true })
      .getByRole("button", { name: "AI Studio", exact: true })
      .click();
    await p
      .locator("summary")
      .filter({ hasText: /^Optional self-hosted GPU discovery$/ })
      .click();
    let release;
    const gate = new Promise((ok) => (release = ok));
    let received = false;
    await c.route("https://gpu.example.org/v1/capabilities", async (route) => {
      const headers = {
        "Access-Control-Allow-Origin": new URL(base).origin,
        "Access-Control-Allow-Headers": "authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      received = true;
      assert.equal(route.request().postData(), null);
      await gate;
      await route
        .fulfill({
          headers,
          contentType: "application/json",
          body: JSON.stringify({
            protocol: "inkstrip-gpu/1",
            retention: "OLD RESPONSE MUST NOT APPEAR",
            models: [],
          }),
        })
        .catch(() => {});
    });
    await p.getByLabel("GPU HTTPS origin", { exact: true }).fill("https://gpu.example.org");
    await p.getByLabel("GPU session token", { exact: true }).fill("volatile-audit-credential");
    await p.getByRole("checkbox", { name: /Allow this capability request/ }).check();
    await p.getByRole("button", { name: "Check GPU capabilities", exact: true }).click();
    while (!received) await p.waitForTimeout(10);
    await p.getByLabel("GPU HTTPS origin", { exact: true }).fill("https://other.example.org");
    release();
    await p.waitForTimeout(150);
    assert.equal(await p.getByText(/OLD RESPONSE MUST NOT APPEAR/).count(), 0);
    assert.ok(
      await p.getByRole("button", { name: "Check GPU capabilities", exact: true }).isDisabled(),
    );
    await p.getByRole("button", { name: "Disconnect and clear credential", exact: true }).click();
    assert.equal(await p.getByLabel("GPU session token", { exact: true }).inputValue(), "");
    await p.getByRole("button", { name: "Advanced", exact: true }).click();
    assert.ok(await p.getByLabel("Denoise prefilter", { exact: true }).isVisible());
    await p.screenshot({ path: `/workspace/screenshots/f1-audit-${width}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // Orientation/layout changes keep mode/settings and remain cancellable without a result.
    await p.setViewportSize({ width: Math.max(width, 768), height: 700 });
    await p.setViewportSize({ width, height: 1000 });
    await p.getByRole("button", { name: "Generate restoration preview", exact: true }).click();
    await p.getByRole("button", { name: "Cancel AI processing", exact: true }).click();
    await p.getByText("Cancelled. Document and Chapter unchanged.", { exact: true }).waitFor();
    assert.equal(
      await p.getByRole("button", { name: "Accept AI result layer", exact: true }).count(),
      0,
    );
    if (width === 1440) {
      await p.waitForTimeout(100);
      const workers = p
        .workers()
        .map((w) => w.url())
        .sort();
      // Deliberately corrupt cached bytes: negative integrity check, not inference.
      await p.evaluate(
        async ({ artifact, bytes }) => {
          const cache = await caches.open("inkstrip-ai-swin2sr-v1");
          await cache.put(artifact, new Response(new Uint8Array(bytes)));
        },
        { artifact: SWIN.artifact, bytes: SWIN.bytes },
      );
      await p.getByRole("button", { name: "Generate restoration preview", exact: true }).click();
      await p.getByText(/checkpoint failed integrity verification/).waitFor();
      await p.waitForFunction((n) => document.querySelectorAll(".pro-ai-preview").length === n, 0);
      assert.equal(
        await p.evaluate(
          async ({ artifact }) => {
            const cache = await caches.open("inkstrip-ai-swin2sr-v1");
            return !!(await cache.match(artifact));
          },
          { artifact: SWIN.artifact },
        ),
        false,
      );
      await p.waitForTimeout(50);
      assert.deepEqual(
        p
          .workers()
          .map((w) => w.url())
          .sort(),
        workers,
        "Failed model jobs release their worker immediately",
      );
    }

    assert.deepEqual(errors, []);
    reports.push({
      width,
      storageUpgrade: "v1 to v2 retained records; old client refused",
      failedImports: 5,
      lateDiscovery: "discarded",
      orientation: "passed",
      cancellation: "passed",
      errors,
    });
    await c.close();
    console.log(JSON.stringify(reports.at(-1)));
  }
  console.log("F1 audit corruption, storage downgrade, discovery race and responsive checks: PASS");
} finally {
  await browser.close();
}
