/** INK-AUD-005 continuation: device refusal must precede ready/history/autosave. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { encode } from "fast-png";
import { mkdir, writeFile } from "node:fs/promises";
import { fromPanel } from "../src/lib/studio/pro/model.ts";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
await mkdir("/workspace/r10-evidence", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] }),
  results = [],
  errors = [];
try {
  for (const width of [1440, 768, 390, 360, 320]) {
    const touch = width < 1000;
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch: touch,
      isMobile: touch,
    });
    const p = await context.newPage();
    p.setDefaultTimeout(30000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await p.goto(base);
    await p.getByRole("button", { name: "New project", exact: true }).click();
    await p.getByPlaceholder("Night Market").fill("Device preflight QA");
    await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
    await p.getByText("Chapter workspace", { exact: true }).waitFor();
    const file = (name, w, h) => ({
      name,
      mimeType: "image/png",
      buffer: Buffer.from(
        encode({ width: w, height: h, data: new Uint8Array(w * h * 4).fill(255) }),
      ),
    });
    const large = touch
      ? file("device-limit.png", 1080, 5000)
      : file("device-limit.png", 4096, 4097);
    await p
      .locator("input[type=file]")
      .first()
      .setInputFiles([large, file("valid.png", 64, 64)]);
    await p.getByRole("button", { name: "Edit Image valid.png", exact: true }).waitFor();
    await p
      .getByRole("button", { name: "Image options for device-limit.png", exact: true })
      .click();
    await p
      .getByRole("dialog", { name: "Image tools", exact: true })
      .getByRole("button", { name: "Open in Raster Studio", exact: true })
      .click();
    const studio = p.getByRole("dialog", { name: "Inkstrip Raster Studio", exact: true });
    const failure = studio.locator(".pro-load-failed");
    await failure.waitFor();
    assert.equal(await studio.locator(".pro-save-state").innerText(), "Not opened");
    assert.equal(await studio.locator(".pro-artboard").count(), 0, "no invalid ready state");
    assert.match(
      await failure.innerText(),
      new RegExp(touch ? "4.0 megapixels" : "16.8 megapixels"),
    );
    await failure.getByRole("button", { name: "Try again", exact: true }).click();
    await failure.waitFor();
    assert.equal(await studio.locator(".pro-save-state").innerText(), "Not opened");
    const persisted = await p.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("inkstrip-pro");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction("sessions");
          const r = tx.objectStore("sessions").getAll();
          tx.oncomplete = () => resolve(r.result);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    assert.deepEqual(persisted, [], "refused artwork creates no saved or half-ready document");
    await p.screenshot({ path: `/workspace/screenshots/r10-open-limits-${width}.png` });
    await failure.getByRole("button", { name: "Return to chapter", exact: true }).click();
    await studio.waitFor({ state: "detached" });
    if (touch) {
      // A valid native draft saved on a more capable device must be retained,
      // while its opening here still ends in the terminal failure state.
      const legacy = fromPanel({
        id: "placeholder",
        name: "Retained draft",
        width: 1080,
        height: 5000,
      });
      const before = await p.evaluate(
        async ({ document: doc, png }) => {
          const open = (name) =>
            new Promise((resolve, reject) => {
              const r = indexedDB.open(name);
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
          const main = await open("inkstrip");
          const panel = await new Promise((resolve, reject) => {
            const tx = main.transaction("panels"),
              r = tx.objectStore("panels").getAll();
            tx.oncomplete = () => resolve(r.result.find((x) => x.name === "device-limit.png"));
            tx.onerror = () => reject(tx.error);
          });
          main.close();
          doc.panelId = panel.id;
          const blob = new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], {
            type: "image/png",
          });
          const session = {
            document: doc,
            assets: { source: blob },
            revision: 7,
            acceptedBlobId: panel.blobId,
            updatedAt: 123,
          };
          const db = await open("inkstrip-pro");
          await new Promise((resolve, reject) => {
            const tx = db.transaction("sessions", "readwrite");
            tx.objectStore("sessions").put({ id: panel.id, session });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          return {
            document: doc,
            revision: 7,
            assetSize: blob.size,
            assetHash: [
              ...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
            ],
          };
        },
        { document: legacy, png: large.buffer.toString("base64") },
      );
      await p
        .getByRole("button", { name: "Image options for device-limit.png", exact: true })
        .click();
      await p
        .getByRole("dialog", { name: "Image tools", exact: true })
        .getByRole("button", { name: "Open in Raster Studio", exact: true })
        .click();
      await failure.waitFor();
      assert.equal(await studio.locator(".pro-save-state").innerText(), "Not opened");
      assert.equal(await studio.locator(".pro-artboard").count(), 0);
      const after = await p.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open("inkstrip-pro");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const session = await new Promise((resolve, reject) => {
          const tx = db.transaction("sessions"),
            r = tx.objectStore("sessions").getAll();
          tx.oncomplete = () => resolve(r.result[0].session);
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        return {
          document: session.document,
          revision: session.revision,
          assetSize: session.assets.source.size,
          assetHash: [
            ...new Uint8Array(
              await crypto.subtle.digest("SHA-256", await session.assets.source.arrayBuffer()),
            ),
          ],
        };
      });
      assert.deepEqual(
        after,
        before,
        "refused legacy draft, revision and original bytes remain exact",
      );
      await failure.getByRole("button", { name: "Return to chapter", exact: true }).click();
      await studio.waitFor({ state: "detached" });
    }
    await p.getByRole("button", { name: "Image options for valid.png", exact: true }).click();
    await p
      .getByRole("dialog", { name: "Image tools", exact: true })
      .getByRole("button", { name: "Open in Raster Studio", exact: true })
      .click();
    await studio.locator(".pro-artboard").waitFor();
    assert.notEqual(await studio.locator(".pro-save-state").innerText(), "Not opened");
    results.push({
      width,
      touchEmulation: touch,
      terminalFailure: true,
      retry: true,
      noDraftWritten: true,
      ...(touch ? { existingDraftPreserved: true } : {}),
      subsequentValidImage: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { results, errors };
  await writeFile(
    "/workspace/r10-evidence/open-limits-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
