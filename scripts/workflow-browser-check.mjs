import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
// Installed Chromium automation returns async waitForFunction promises before truthiness.
// Poll explicitly so persistence/recovery assertions cannot pass on an unresolved promise.
async function waitForAsync(page, check) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await page.evaluate(check)) return;
    await page.waitForTimeout(60);
  }
  throw new Error("Timed out waiting for persisted state");
}
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
    await page.getByText("Chapter workspace", { exact: true }).waitFor();
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
    await waitForAsync(page, async () => {
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
    await waitForAsync(page, async () => {
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
    // Recovery is metadata-only until the user saves. Reusable presets survive reload.
    if (mobile) await page.getByRole("button", { name: "Panels", exact: true }).click();
    await page.getByRole("button", { name: "Edit Image one.png", exact: true }).click();
    await page.getByRole("button", { name: "Adjust", exact: true }).click();
    await page.getByLabel("Brightness", { exact: true }).fill("20");
    await page.getByLabel("Brightness", { exact: true }).press("Tab");
    await page.getByLabel("Preset name", { exact: true }).fill("My finish");
    await page.getByRole("button", { name: "Save current tone preset", exact: true }).click();
    await page.getByRole("button", { name: "My finish", exact: true }).waitFor();
    await waitForAsync(page, async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("inkstrip");
        q.onsuccess = () => r(q.result);
      });
      const p = await new Promise((r) => {
        const q = db.transaction("panels").objectStore("panels").getAll();
        q.onsuccess = () => r(q.result);
      });
      db.close();
      const v = p.find((x) => x.name === "one.png");
      return v?.draft?.recipe?.adjustments?.brightness === 20 && !v.original;
    });
    await page.reload();
    await page.getByRole("button", { name: "Edit Image one.png", exact: true }).click();
    await page.getByRole("button", { name: "Adjust", exact: true }).click();
    assert.equal(await page.getByLabel("Brightness", { exact: true }).inputValue(), "20");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit Image", exact: true })
      .waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Batch edit selected", exact: true }).click();
    await page
      .getByLabel("Batch saved preset", { exact: true })
      .selectOption({ label: "My finish" });
    await page.getByLabel("Batch scale percent", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Apply to 3 selected images", exact: true }).click();
    await page
      .getByText("Queue finished. Inspect results; failed images remain unchanged.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await page.getByText(/done · Saved PNG; original retained/).count(), 3);
    await page.getByRole("button", { name: "Close batch", exact: true }).click();
    const batch = await page.evaluate(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("inkstrip");
        q.onsuccess = () => r(q.result);
      });
      const p = await new Promise((r) => {
        const q = db.transaction("panels").objectStore("panels").getAll();
        q.onsuccess = () => r(q.result);
      });
      db.close();
      return p.map((x) => ({
        name: x.name,
        mime: x.mime,
        width: x.width,
        height: x.height,
        original: !!x.original,
        draft: !!x.draft,
      }));
    });
    assert.ok(
      batch.every(
        (p) =>
          p.mime === "image/png" && p.width === 64 && p.height === 64 && p.original && !p.draft,
      ),
    );
    // A shared accepted blob must survive another panel replacing the same media.
    const shared = await page.evaluate(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("inkstrip");
        q.onsuccess = () => r(q.result);
      });
      const p = await new Promise((r) => {
        const q = db.transaction("panels").objectStore("panels").getAll();
        q.onsuccess = () => r(q.result);
      });
      const original = p.find((x) => x.name === "one.png"),
        copy = { ...original, id: crypto.randomUUID(), name: "shared-copy.png", order: 3 };
      await new Promise((r, j) => {
        const t = db.transaction("panels", "readwrite");
        t.objectStore("panels").put(copy);
        t.oncomplete = r;
        t.onerror = j;
      });
      db.close();
      return { blobId: copy.blobId, thumbId: copy.thumbId };
    });
    await page.reload();
    await page.getByRole("button", { name: "Edit Image one.png", exact: true }).click();
    await page.getByRole("button", { name: "Adjust", exact: true }).click();
    await page.getByLabel("Brightness", { exact: true }).fill("5");
    await page.getByLabel("Brightness", { exact: true }).press("Tab");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit Image", exact: true })
      .waitFor({ state: "hidden" });
    const retained = await page.evaluate(async ({ blobId, thumbId }) => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("inkstrip");
        q.onsuccess = () => r(q.result);
      });
      const read = (id) =>
        new Promise((r) => {
          const q = db.transaction("blobs").objectStore("blobs").get(id);
          q.onsuccess = () => r(!!q.result);
        });
      const ok = (await read(blobId)) && (await read(thumbId));
      db.close();
      return ok;
    }, shared);
    assert.ok(retained, "cross-panel shared blobs retained after replacement");
    if (mobile) {
      await page.getByRole("button", { name: "Edit Image one.png", exact: true }).click();
      await page.getByRole("button", { name: "Object Eraser & Retouch", exact: true }).click();
      await page.getByLabel("Selection shape", { exact: true }).selectOption("lasso");
      const mask = page.getByLabel("Retouch selection", { exact: true }),
        rect = await mask.boundingBox(),
        cdp = await context.newCDPSession(page);
      const points = [
        [0.2, 0.1],
        [0.45, 0.1],
        [0.45, 0.3],
        [0.2, 0.3],
        [0.2, 0.1],
      ];
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: rect.x + rect.width * points[0][0], y: rect.y + rect.height * points[0][1] },
        ],
      });
      for (const [x, y] of points.slice(1))
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: rect.x + rect.width * x, y: rect.y + rect.height * y }],
        });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert.equal(
        await mask.evaluate((c) =>
          c
            .getContext("2d")
            .getImageData(0, 0, c.width, c.height)
            .data.some((v, i) => i % 4 === 3 && v > 0),
        ),
        true,
      );
      await page.screenshot({ path: "/workspace/screenshots/inkstrip-4-8-retouch-mobile.png" });
      await page.getByRole("button", { name: "Preview removal", exact: true }).click();
      const cancel = page.getByRole("button", { name: "Cancel processing", exact: true });
      if (await cancel.isVisible()) await cancel.evaluate((button) => button.click());
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      console.log("Native touch lasso and retouch close/cancellation: PASS");
    }
    await page.getByText("Export images", { exact: true }).click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export accepted images · native", exact: true })
      .click();
    assert.match((await download).suggestedFilename(), /-accepted\.png$/);
    console.log(
      mobile
        ? "Mobile preset, draft recovery, batch native PNG, shared-blob protection and export: PASS"
        : "Desktop preset, draft recovery, batch native PNG, shared-blob protection and export: PASS",
    );
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
