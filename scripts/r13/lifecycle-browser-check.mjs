/** R13 mobile lifecycle check: a Raster edit made right before the page is hidden must
 * be durable even if the page is then frozen and discarded before the 500 ms autosave
 * debounce runs (Android/iOS background tab discard). Real UI, real IndexedDB; the
 * discard is an abrupt page close 60 ms after the page was hidden. Usage:
 * node --experimental-strip-types scripts/r13/lifecycle-browser-check.mjs [base] */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { proBrowserFixtures } from "../pro-browser-fixtures.mjs";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [];
const fx = proBrowserFixtures(base, errors);
const saved = (p) =>
  p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("sessions").objectStore("sessions").getAll();
          q.onsuccess = () => {
            db.close();
            resolve(
              q.result.map((row) =>
                row.session.document.layers.reduce((n, l) => n + (l.strokes?.length ?? 0), 0),
              ),
            );
          };
        };
      }),
  );
let failures = 0;
for (const [label, hide] of [
  ["visibilitychange: hidden", "visibility"],
  ["pagehide", "pagehide"],
]) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p = await context.newPage();
  await fx.start(p);
  await fx.open(p);
  await p.waitForFunction(
    () =>
      document
        .querySelector('canvas[aria-label="Pro composite preview"]')
        ?.getAttribute("aria-busy") === "false",
  );
  await p.getByRole("button", { name: "Brush tool", exact: true }).click();
  const box = await fx.artboardBounds(p);
  // A first stroke, allowed to autosave normally.
  const drag = async (y) => {
    const cdp = await context.newCDPSession(p);
    const a = { x: box.x + box.width * 0.2, y: box.y + box.height * y },
      b = { x: box.x + box.width * 0.8, y: box.y + box.height * y };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
    for (let i = 1; i <= 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
  await drag(0.3);
  await p.waitForFunction(async () => true);
  await p.waitForTimeout(1500);
  const before = await saved(p);
  // Second stroke, then the user leaves the app immediately.
  await drag(0.6);
  await p.waitForTimeout(20);
  await p.evaluate((hide) => {
    if (hide === "visibility") {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    } else window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  }, hide);
  // The OS discards the background tab shortly after it was hidden: closing the page
  // kills its timers (headless Page.setWebLifecycleState "frozen" does not stop them).
  await p.waitForTimeout(60);
  await p.close({ runBeforeUnload: false });
  const q = await context.newPage();
  await q.goto(base);
  const after = await saved(q);
  const ok = after[0] === before[0] + 1;
  console.log(
    `${ok ? "ok" : "FAIL"} - ${label}: strokes saved before ${before[0]}, after discard ${after[0]} (expected ${before[0] + 1})`,
  );
  if (!ok) failures++;
  await context.close();
}
await browser.close();
assert.equal(failures, 0, "an edit made right before the page was hidden was lost");
console.log("lifecycle checks passed");
