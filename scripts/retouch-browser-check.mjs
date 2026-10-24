/** Local deterministic fixtures only; optional upstream anime image supplied explicitly for detector QA. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(30000);
try {
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("Retouch QA");
  await page.getByRole("button", { name: "Create chapter 1" }).click();
  await page.getByText("Chapter workspace", { exact: true }).waitFor();
  const fixture = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const x = c.getContext("2d");
    x.fillStyle = "rgb(80,100,120)";
    x.fillRect(0, 0, 128, 96);
    x.fillStyle = "rgb(240,20,20)";
    x.fillRect(55, 40, 15, 15);
    return c.toDataURL().split(",")[1];
  });
  const files = [
    { name: "repair.png", mimeType: "image/png", buffer: Buffer.from(fixture, "base64") },
  ];
  if (process.argv[3])
    files.push({
      name: "anime-detector-qa.png",
      mimeType: "image/png",
      buffer: await readFile(process.argv[3]),
    });
  await page.locator("input[type=file]").first().setInputFiles(files);
  const open = async (name) => {
    await page.getByRole("button", { name: `Edit Image ${name}`, exact: true }).click();
    await page.getByRole("button", { name: "Object Eraser & Retouch", exact: true }).click();
    await page.getByRole("dialog", { name: "Object Eraser & Retouch", exact: true }).waitFor();
  };
  await open("repair.png");
  await page.getByLabel("Selection shape", { exact: true }).selectOption("rectangle");
  const selection = page.getByLabel("Retouch selection", { exact: true });
  const r = await selection.boundingBox();
  await page.mouse.move(r.x + r.width * 0.39, r.y + r.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.62, r.y + r.height * 0.64, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Preview removal", exact: true }).click();
  await page.getByRole("button", { name: "Accept preview", exact: true }).waitFor();
  const decoded = await page
    .getByAltText("Retouch image preview", { exact: true })
    .evaluate(async (img) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      return {
        width: c.width,
        height: c.height,
        center: [...x.getImageData(60, 46, 1, 1).data],
        outside: [...x.getImageData(8, 8, 1, 1).data],
      };
    });
  assert.deepEqual([decoded.width, decoded.height], [128, 96]);
  assert.deepEqual(decoded.outside, [80, 100, 120, 255]);
  assert.ok(decoded.center[0] < 160, "unwanted red object replaced by background texture");
  await page.getByRole("button", { name: "Accept preview", exact: true }).click();
  await page.getByRole("button", { name: "Undo result", exact: true }).click();
  await page.getByRole("button", { name: "Redo result", exact: true }).click();
  await page.getByRole("button", { name: "Save accepted image", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Object Eraser & Retouch", exact: true })
    .waitFor({ state: "hidden" });
  await page.getByRole("dialog", { name: "Edit Image", exact: true }).waitFor({ state: "hidden" });
  const state = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
    });
    const panels = await new Promise((resolve) => {
      const r = db.transaction("panels").objectStore("panels").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    const panel = panels.find((p) => p.name === "repair.png");
    const blob = await new Promise((resolve) => {
      const r = db.transaction("blobs").objectStore("blobs").get(panel.original.blobId);
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return {
      original: btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))),
      panel,
    };
  });
  assert.equal(state.original, fixture);
  assert.ok(state.panel.original);
  await page.reload();
  await page.getByRole("button", { name: "Edit Image repair.png", exact: true }).waitFor();
  if (process.argv[3]) {
    await open("anime-detector-qa.png");
    await page.getByText("Face selection", { exact: true }).click();
    await page.getByRole("button", { name: "Detect possible anime faces", exact: true }).click();
    await page
      .getByRole("button", { name: "Select face 1", exact: true })
      .waitFor({ timeout: 120000 });
    const n = await page.getByRole("button", { name: /^Select face \d+$/ }).count();
    assert.ok(n > 0);
    console.log("Real trained anime cascade detected", n, "candidate faces in upstream example");
    await page.getByRole("button", { name: "Select face 1", exact: true }).click();
    await page.getByLabel("Face width percent", { exact: true }).fill("15");
    await page.getByLabel("Face width percent", { exact: true }).press("Tab");
  }
  if (process.argv[3]) {
    await page.getByText("Character library", { exact: true }).click();
    await page.getByLabel("Character name", { exact: true }).fill("William");
    await page
      .getByLabel("Character appearance notes", { exact: true })
      .fill("Dark eyes; keep target expression");
    await page.getByRole("button", { name: "Save selected face reference", exact: true }).click();
    await page.getByAltText("Character reference face", { exact: true }).waitFor();
    await page.getByLabel("Retouch operation", { exact: true }).selectOption("face");
    assert.equal(
      await page.getByRole("button", { name: "Preview AI Face Fix", exact: true }).isEnabled(),
      false,
    );
    await page.getByLabel("Owner access code", { exact: true }).fill("test-owner-code");
    await page.getByRole("checkbox", { name: /I confirm this selected target is William/ }).check();
    await page.getByRole("button", { name: "Preview AI Face Fix", exact: true }).click();
    await page
      .getByText("Cloud editing is not configured. Local texture repair remains available.", {
        exact: true,
      })
      .waitFor();
    // Fixture transport cancellation: no paid inference is used or claimed.
    await page.route("**/api/studio/ai-edit", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route
        .fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Delayed test response" }),
        })
        .catch(() => {});
    });
    const started = page.waitForRequest("**/api/studio/ai-edit");
    await page.getByRole("button", { name: "Preview AI Face Fix", exact: true }).click();
    await started;
    await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
    await page.getByRole("button", { name: "Preview AI Face Fix", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Accept preview", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "Save accepted image", exact: true }).isEnabled(),
      false,
    );
    await page.unrouteAll({ behavior: "wait" });
    console.log("Cloud upload request cancellation fixture leaves accepted image unchanged: PASS");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    const profiles = await page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip");
        r.onsuccess = () => resolve(r.result);
      });
      const projects = await new Promise((resolve) => {
        const r = db.transaction("projects").objectStore("projects").getAll();
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return projects.flatMap((p) =>
        (p.characters ?? []).map((c) => ({
          name: c.name,
          notes: c.notes,
          references: c.references.map((r) => ({ type: r.blob.type, bytes: r.blob.size })),
        })),
      );
    });
    assert.equal(profiles[0].name, "William");
    assert.ok(profiles[0].references[0].bytes > 0);
    assert.equal(profiles[0].references[0].type, "image/png");
    console.log(
      "Character reference persistence, explicit identity/upload consent, disabled-provider failure: PASS",
    );
    await page
      .getByRole("button", { name: "AI Face Fix · review selected targets", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Object Eraser & Retouch", exact: true }).waitFor();
    await page.getByText("1/2 · 0 saved", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Skip target", exact: true }).click();
    await page.getByText("2/2 · 0 saved", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Object Eraser & Retouch", exact: true })
      .waitFor({ state: "hidden" });
    console.log("Face Fix target queue skip/stop with saved project character: PASS");
  }
  assert.deepEqual(errors, []);
  console.log(
    "Retouch worker, mask, output pixels, accepted save, original bytes, reload, face selection: PASS",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
