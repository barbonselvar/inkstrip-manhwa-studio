#!/usr/bin/env node
/**
 * End-to-end smoke test for the installed Inkstrip apps, run by
 * .github/workflows/native-apps.yml against:
 *   - the APK installed on an Android emulator (WebView debugging via adb forward), and
 *   - the NSIS-installed Windows app (WebView2 started with --remote-debugging-port).
 *
 * It talks raw Chrome DevTools Protocol to the app's real WebView, so it exercises the
 * shipped binary (not a desktop browser): production page load, the native bridge,
 * project creation, image import into the Chapter workspace, Raster editor entry,
 * downloads landing on disk, storage persistence across an app restart and (Android)
 * the hardware back button.
 *
 * Usage:
 *   node native-smoke.mjs --platform android|windows --phase main|verify-restart --out <dir>
 *
 * Needs Node 22+ (global WebSocket). No npm dependencies.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

// INKSTRIP_SMOKE_ORIGIN lets the script be dry-run against a local dev server.
const APP_ORIGIN = process.env.INKSTRIP_SMOKE_ORIGIN ?? "https://inkstrip-manhwa-studio.vercel.app";
const { values: args } = parseArgs({
  options: {
    platform: { type: "string" },
    phase: { type: "string", default: "main" },
    out: { type: "string", default: "native-smoke" },
    port: { type: "string", default: "9222" },
    timeout: { type: "string", default: "180" },
  },
});
const platform = args.platform;
if (platform !== "android" && platform !== "windows")
  throw new Error("--platform android|windows required");
const outDir = args.out;
mkdirSync(outDir, { recursive: true });
const endpoint = `http://127.0.0.1:${args.port}`;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(name, ok, detail, { required = true } = {}) {
  results.push({ name, ok, required, detail });
  console.log(
    `${ok ? "PASS" : required ? "FAIL" : "WARN"}  ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`,
  );
}

function adb(...a) {
  return execFileSync("adb", a, { encoding: "utf8" }).trim();
}

// ---------------------------------------------------------------- CDP plumbing
async function findAppTarget(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`${endpoint}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith(APP_ORIGIN));
      if (page?.webSocketDebuggerUrl) return page;
      last = list.map((t) => `${t.type}:${t.url}`).join(", ");
    } catch (e) {
      last = String(e.message ?? e);
    }
    await sleep(1000);
  }
  throw new Error(`App page never appeared on ${endpoint} (last: ${last || "none"})`);
}

class Cdp {
  static async connect(wsUrl) {
    const cdp = new Cdp();
    cdp.ws = new WebSocket(wsUrl);
    cdp.pending = new Map();
    cdp.nextId = 1;
    cdp.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const waiter = msg.id && cdp.pending.get(msg.id);
      if (!waiter) return;
      cdp.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
      else waiter.resolve(msg.result);
    };
    await new Promise((resolve, reject) => {
      cdp.ws.onopen = resolve;
      cdp.ws.onerror = () => reject(new Error(`WebSocket to ${wsUrl} failed`));
    });
    return cdp;
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  async eval(expression, timeoutMs = 60000) {
    const run = this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    const res = await Promise.race([
      run,
      sleep(timeoutMs).then(() => {
        throw new Error(`evaluate timed out after ${timeoutMs} ms`);
      }),
    ]);
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    }
    return res.result.value;
  }
  async screenshot(name) {
    try {
      const { data } = await this.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(outDir, `${platform}-${name}.png`), Buffer.from(data, "base64"));
    } catch (e) {
      console.log(`(screenshot ${name} failed: ${e.message})`);
    }
  }
  close() {
    this.ws.close();
  }
}

/** Helpers injected into the page for each evaluate call. */
const PAGE_HELPERS = String.raw`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 30000, what = "condition") => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(250); }
    throw new Error("Timed out waiting for " + what);
  };
  const byText = (selector, text) => [...document.querySelectorAll(selector)].find((el) => el.textContent.trim().includes(text));
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const makePng = async (w, h, seed) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#f3efe6"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) { g.fillStyle = "hsl(" + ((seed * 37 + i * 29) % 360) + " 60% 45%)"; g.fillRect(20 + i * 30, 20 + i * 50, w / 2, h / 6); }
    g.fillStyle = "#161513"; g.font = "bold 48px sans-serif"; g.fillText("INKSTRIP " + seed, 30, h - 60);
    return await new Promise((r) => c.toBlob(r, "image/png"));
  };
  const sha256 = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
`;
const page = (body) => `${PAGE_HELPERS}\n${body}`;

// ---------------------------------------------------------------- platform hooks
function downloadsDir() {
  return platform === "windows" ? join(homedir(), "Downloads") : "/sdcard/Download/Inkstrip";
}

function findDownloaded(fileName) {
  if (platform === "android") {
    const listing = adb("shell", "ls", "-l", downloadsDir()).split("\n");
    const line = listing.find((l) => l.trim().endsWith(fileName));
    if (!line) return null;
    const local = join(outDir, fileName);
    adb("pull", `${downloadsDir()}/${fileName}`, local);
    return local;
  }
  const dir = downloadsDir();
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f === fileName);
  return hit ? join(dir, hit) : null;
}

function pressBack() {
  adb("shell", "input", "keyevent", "4");
}

// ---------------------------------------------------------------- checks
async function main() {
  const target = await findAppTarget(Number(args.timeout) * 1000);
  console.log(`Attached to ${target.url}`);
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable").catch(() => {});

  // 1. The production app actually rendered inside the native shell.
  // The target can be attached while the page is still navigating; retry until it settles.
  const settle = async (fn) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (
          attempt >= 30 ||
          !/context was destroyed|Cannot find context|Inspected target navigated/i.test(
            error.message,
          )
        )
          throw error;
        await sleep(2000);
      }
    }
  };
  const loaded = await settle(() =>
    cdp.eval(
      page(`
      await waitFor(() => document.readyState === "complete", 60000, "document load");
      await waitFor(() => document.querySelector(".hero-title, main#workspace, .studio-layout"), 60000, "Inkstrip UI");
      return { href: location.href, title: document.title, text: document.body.innerText.slice(0, 200), ua: navigator.userAgent };
    `),
      90000,
    ),
  );
  record(
    "Production web app loads inside the app window",
    loaded.href.startsWith(APP_ORIGIN),
    loaded,
  );
  await cdp.screenshot(`${args.phase}-01-home`);

  // 2. Native shell markers.
  const marker = await cdp.eval(`return {
    desktop: window.__INKSTRIP_DESKTOP__ ?? null,
    capacitor: !!window.Capacitor?.isNativePlatform?.(),
    plugin: !!window.Capacitor?.Plugins?.InkstripNative,
    shim: !!window.__inkstripNativeShim,
    ua: navigator.userAgent,
  };`);
  if (platform === "windows") {
    record(
      "Windows shell marker (__INKSTRIP_DESKTOP__) present",
      marker.desktop?.platform === "windows",
      marker,
    );
  } else {
    record(
      "Android Capacitor bridge, InkstripNative plugin and download shim injected",
      marker.capacitor && marker.plugin && marker.shim && /InkstripApp\//.test(marker.ua),
      marker,
    );
  }

  if (args.phase === "verify-restart") {
    const persisted = await cdp.eval(`
      const ls = localStorage.getItem("inkstrip-native-smoke");
      const idb = await new Promise((resolve) => {
        const req = indexedDB.open("inkstrip-native-smoke", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => {
          const tx = req.result.transaction("kv", "readonly").objectStore("kv").get("marker");
          tx.onsuccess = () => resolve(tx.result ?? null);
          tx.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      });
      return { ls, idb };
    `);
    const expected = readFileSync(join(outDir, `${platform}-storage-marker.txt`), "utf8").trim();
    record(
      "localStorage and IndexedDB survive an app restart",
      persisted.ls === expected && persisted.idb === expected,
      { expected, ...persisted },
    );
    const projects = await cdp
      .eval(
        page(
          `await waitFor(() => document.body.innerText.includes("Native smoke"), 20000, "project card"); return true;`,
        ),
      )
      .catch((e) => e.message);
    record("Project created before the restart is still listed", projects === true, projects);
    await cdp.screenshot(`${args.phase}-02-after-restart`);
    cdp.close();
    return;
  }

  // 3. Browser capabilities the editor and AI tools depend on.
  const caps = await cdp.eval(`
    const gl = document.createElement("canvas").getContext("webgl2");
    return {
      webassembly: typeof WebAssembly === "object",
      wasmSimd: WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])),
      webgl2: !!gl,
      worker: typeof Worker === "function",
      offscreenCanvas: typeof OffscreenCanvas === "function",
      createImageBitmap: typeof createImageBitmap === "function",
      indexedDB: typeof indexedDB === "object",
      webgpu: !!navigator.gpu,
      persistentStorage: await navigator.storage?.persisted?.().catch(() => null),
      quotaMB: Math.round(((await navigator.storage?.estimate?.())?.quota ?? 0) / 1048576),
    };
  `);
  record(
    "Editor/AI runtime capabilities (WebAssembly+SIMD, WebGL2, Workers, OffscreenCanvas, IndexedDB)",
    caps.webassembly &&
      caps.wasmSimd &&
      caps.webgl2 &&
      caps.worker &&
      caps.offscreenCanvas &&
      caps.indexedDB,
    caps,
  );
  record(
    "WebGPU available (optional accelerator for on-device AI)",
    caps.webgpu,
    caps.webgpu ? "yes" : "falls back to WebAssembly",
    { required: false },
  );

  // 4. Storage marker for the restart phase.
  const markerValue = `${platform}-${Date.now()}`;
  writeFileSync(join(outDir, `${platform}-storage-marker.txt`), markerValue);
  const stored = await cdp.eval(`
    localStorage.setItem("inkstrip-native-smoke", ${JSON.stringify(markerValue)});
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("inkstrip-native-smoke", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => {
        const tx = req.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(${JSON.stringify(markerValue)}, "marker");
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    return localStorage.getItem("inkstrip-native-smoke");
  `);
  record("localStorage and IndexedDB writable", stored === markerValue, stored);

  // 5. Android back button closes an open dialog instead of leaving the app.
  if (platform === "android") {
    await cdp.eval(
      page(
        `byText("button", "New project").click(); await waitFor(() => document.querySelector("[role=dialog]"), 10000, "dialog"); return true;`,
      ),
    );
    pressBack();
    await sleep(1500);
    const afterBack = await cdp.eval(
      `return { dialog: !!document.querySelector("[role=dialog]"), href: location.href };`,
    );
    record(
      "Android back closes an open dialog first",
      !afterBack.dialog && afterBack.href.startsWith(APP_ORIGIN),
      afterBack,
    );
  }

  // 6. Create a project through the real UI → Chapter workspace.
  const created = await cdp
    .eval(
      page(`
      byText("button", "New project").click();
      const input = await waitFor(() => document.querySelector("[role=dialog] input"), 10000, "title field");
      setValue(input, "Native smoke ${platform}");
      byText("[role=dialog] button[type=submit]", "Create").click();
      await waitFor(() => /\\/p\\/[^/]+\\/c\\/[^/]+/.test(location.pathname), 30000, "chapter route");
      await waitFor(() => document.querySelector("input[type=file][multiple]"), 30000, "chapter import input");
      return location.pathname;
    `),
      60000,
    )
    .catch((e) => ({ error: e.message }));
  record("Create project and open Chapter workspace", typeof created === "string", created);
  await cdp.screenshot(`${args.phase}-02-chapter`);

  // 7. Import images into the chapter (same pipeline as the file picker / gallery).
  if (typeof created === "string") {
    const imported = await cdp
      .eval(
        page(`
        const input = document.querySelector("input[type=file][multiple]");
        const dt = new DataTransfer();
        for (let i = 1; i <= 2; i++) dt.items.add(new File([await makePng(720, 1100, i)], "smoke-panel-" + i + ".png", { type: "image/png" }));
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await waitFor(() => [...document.querySelectorAll("img")].filter((img) => img.complete && img.naturalWidth >= 100 && (img.src.startsWith("blob:") || img.src.startsWith("data:"))).length >= 2, 60000, "imported panels");
        return [...document.querySelectorAll("img")].filter((img) => img.src.startsWith("blob:")).length;
      `),
        90000,
      )
      .catch((e) => ({ error: e.message }));
    record(
      "Image import renders panels in the Chapter workspace",
      typeof imported === "number" && imported >= 2,
      imported,
    );
    await cdp.screenshot(`${args.phase}-03-imported`);

    // 8. Raster Studio opens on the imported panel.
    const editor = await cdp
      .eval(
        page(`
        const open = document.querySelector('[aria-label="Open selected image in an editor"]');
        if (!open) return "no editor button";
        open.click();
        await sleep(1500);
        const choice = [...document.querySelectorAll("[role=dialog] button, [role=menu] [role=menuitem], button")].find((b) => /raster/i.test(b.textContent));
        if (choice) choice.click();
        await waitFor(() => document.querySelector("canvas") && /Raster Studio/.test(document.body.innerText) && /Document layers|Layers/.test(document.body.innerText), 45000, "Raster Studio");
        await sleep(4000); // let the preview render for the screenshot
        return location.pathname;
      `),
        60000,
      )
      .catch((e) => e.message);
    record(
      "Raster Studio opens on an imported panel",
      typeof editor === "string" && editor.startsWith("/"),
      editor,
    );
    await cdp.screenshot(`${args.phase}-04-editor`);
    if (platform === "android") {
      const before = await cdp.eval(`return location.pathname;`);
      pressBack();
      await sleep(2000);
      const after = await cdp.eval(`return location.pathname;`).catch(() => "(page reloaded)");
      record(
        "Android back navigates back inside the app",
        after !== before || after === "(page reloaded)",
        { before, after },
        { required: false },
      );
    }
  }

  // 9. Export/download: the exact `<a download>` + blob pattern every Inkstrip export uses.
  const fileName = `inkstrip-smoke-${platform}-${Date.now()}.png`;
  const expectedHash = await cdp.eval(
    page(`
      const blob = await makePng(640, 960, 99);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = ${JSON.stringify(fileName)};
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return await sha256(blob);
    `),
  );
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) {
    await sleep(1000);
    saved = findDownloaded(fileName);
  }
  const savedHash = saved ? createHash("sha256").update(readFileSync(saved)).digest("hex") : null;
  record(`Download saved to ${downloadsDir()} with identical bytes`, savedHash === expectedHash, {
    fileName,
    expectedHash,
    savedHash,
    bytes: saved ? statSync(saved).size : 0,
  });
  await cdp.screenshot(`${args.phase}-05-final`);
  cdp.close();
}

try {
  await main();
} catch (error) {
  record("Smoke run completed", false, error.stack ?? String(error));
}
const summaryPath = join(outDir, `${platform}-${args.phase}-results.json`);
writeFileSync(summaryPath, JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.required && !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed (${failed.length} required failures). Results: ${summaryPath}`,
);
process.exit(failed.length ? 1 : 0);
