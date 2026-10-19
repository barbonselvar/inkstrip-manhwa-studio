import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
async function order(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return panels.sort((a, b) => a.order - b.order).map((p) => p.name);
  });
}
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
        isMobile: mobile,
        hasTouch: mobile,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(25000);
    await page.goto(base);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByPlaceholder("Night Market").fill("Workflow QA");
    await page.getByRole("button", { name: "Create chapter 1" }).click();
    const files = await page.evaluate(() =>
      ["one.png", "two.png", "three.png"].map((name, i) => {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const x = c.getContext("2d");
        x.fillStyle = ["#990000", "#009900", "#000099"][i];
        x.fillRect(0, 0, 64, 64);
        return { name, data: c.toDataURL().split(",")[1] };
      }),
    );
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles(
        files.map((f) => ({
          name: f.name,
          mimeType: "image/png",
          buffer: Buffer.from(f.data, "base64"),
        })),
      );
    const first = page.getByRole("button", { name: "Drag to reorder one.png", exact: true }),
      last = page.getByRole("button", { name: "Drag to reorder three.png", exact: true });
    await last.scrollIntoViewIfNeeded();
    await first.scrollIntoViewIfNeeded();
    const a = await first.boundingBox(),
      b = await last.boundingBox();
    const x = a.x + a.width / 2,
      sy = a.y + a.height / 2,
      ty = b.y + b.height + 20;
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: sy }],
      });
      for (let i = 1; i <= 8; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: sy + ((ty - sy) * i) / 8 }],
        });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, sy);
      await page.mouse.down();
      await page.mouse.move(x, ty, { steps: 12 });
      await page.mouse.up();
    }
    await page.waitForFunction(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("inkstrip");
        q.onsuccess = () => r(q.result);
      });
      const p = await new Promise((r) => {
        const q = db.transaction("panels").objectStore("panels").getAll();
        q.onsuccess = () => r(q.result);
      });
      db.close();
      return p.find((x) => x.name === "one.png")?.order === 2;
    });
    assert.deepEqual(await order(page), ["two.png", "three.png", "one.png"]);
    await page.reload();
    await page.getByRole("button", { name: "Undo reorder", exact: true }).click();
    await page.waitForFunction(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("inkstrip");
        q.onsuccess = () => r(q.result);
      });
      const p = await new Promise((r) => {
        const q = db.transaction("panels").objectStore("panels").getAll();
        q.onsuccess = () => r(q.result);
      });
      db.close();
      return p.find((x) => x.name === "one.png")?.order === 0;
    });
    assert.deepEqual(await order(page), ["one.png", "two.png", "three.png"]);
    const move = page.getByRole("button", { name: "Move down", exact: true }).first();
    await move.click();
    await page.getByRole("button", { name: "Display 3", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).waitFor();
    const strip = await page.evaluate(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("inkstrip");
        q.onsuccess = () => r(q.result);
      });
      const c = await new Promise((r) => {
        const q = db.transaction("chapters").objectStore("chapters").getAll();
        q.onsuccess = () => r(q.result);
      });
      const p = await new Promise((r) => {
        const q = db.transaction("panels").objectStore("panels").getAll();
        q.onsuccess = () => r(q.result);
      });
      db.close();
      return c[0].strip.panelIds.map((id) => p.find((x) => x.id === id).name);
    });
    assert.deepEqual(strip, ["two.png", "one.png", "three.png"]);
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    console.log(
      mobile
        ? "Touch grip, persistence, undo and export order: PASS"
        : "Mouse grip, persistence, undo and export order: PASS",
    );
    await context.close();
  }
} finally {
  await browser.close();
}
