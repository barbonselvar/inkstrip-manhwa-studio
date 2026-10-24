import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
const production = new URL(base).hostname === "inkstrip-manhwa-studio.vercel.app",
  expected = process.argv[3];
assert.ok(production || ["127.0.0.1", "localhost"].includes(new URL(base).hostname));
if (production)
  assert.match(expected ?? "", /^[a-f0-9]{40}$/i, "Supply the intended production SHA");
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  ...(production && process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {}),
});
await mkdir("/workspace/screenshots", { recursive: true });
const results = [];
try {
  for (const width of [1440, 320, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 1440 ? 1000 : 900 },
        hasTouch: width < 500,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(30000);
    await page.goto(base);
    if (production)
      assert.equal(
        await page.locator('meta[name="inkstrip-release"]').getAttribute("content"),
        expected,
      );
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByPlaceholder("Night Market").fill("Dialogue QA");
    await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
    await page.getByText("Chapter workspace", { exact: true }).waitFor();
    const bytes = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const x = c.getContext("2d");
      x.fillStyle = "#fff";
      x.fillRect(0, 0, 640, 480);
      x.fillStyle = "#111";
      x.font = "30px Arial";
      x.fillText("EVERY FRAME", 170, 250);
      return c.toDataURL().split(",")[1];
    });
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "dialogue-source.png",
        mimeType: "image/png",
        buffer: Buffer.from(bytes, "base64"),
      });
    await page
      .getByRole("button", { name: "Edit Image dialogue-source.png", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit dialogue · dialogue-source.png", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Inkstrip Dialogue Studio", exact: true }).waitFor();
    await page.getByRole("button", { name: "Speech", exact: true }).click();
    await page.getByLabel("Dialogue text", { exact: true }).fill("Every frame.\nA world.");
    const tip = page.getByRole("slider", { name: "Tail 1 tip handle", exact: true });
    await tip.focus();
    const old = await tip.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    assert.equal(
      Number(await tip.getAttribute("aria-valuenow")),
      Number(old) + 1,
      "tail keyboard editing changes actual geometry",
    );
    if (width < 500) {
      const bounds = await tip.boundingBox(),
        session = await context.newCDPSession(page),
        x = bounds.x + bounds.width / 2,
        y = bounds.y + bounds.height / 2;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 1 }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + 12, y: y + 8, id: 1 }],
      });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert.notEqual(
        Number(await tip.getAttribute("aria-valuenow")),
        Number(old) + 1,
        "touch tail drag edits geometry",
      );
      await session.detach();
    }

    await page.getByText("Reusable presets", { exact: true }).click();
    await page.getByLabel("Dialogue preset name", { exact: true }).fill("Inkstrip speech");
    await page.getByRole("button", { name: "Save selected bubble preset", exact: true }).click();
    await page.getByRole("button", { name: "Full editor", exact: true }).click();
    assert.equal(await page.locator(".pro-dialogue-quick").count(), 0);
    await page.getByRole("button", { name: "Quick edit", exact: true }).click();
    assert.equal(await page.locator(".pro-dialogue-quick").count(), 1);
    await page.getByRole("button", { name: "Pro undo", exact: true }).click();
    await page.getByRole("button", { name: "Pro redo", exact: true }).click();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page
      .getByRole("button", { name: "Back to chapter from Pro Studio", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Inkstrip Dialogue Studio", exact: true })
      .waitFor({ state: "detached" });
    await page
      .getByRole("button", { name: "Edit dialogue · dialogue-source.png", exact: true })
      .click();
    await page.getByLabel("Dialogue text", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("Dialogue text", { exact: true }).inputValue(),
      "Every frame.\nA world.",
    );
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[aria-label="Pro composite preview"]');
      return (
        c?.width === 640 &&
        c.height === 480 &&
        c.getAttribute("aria-busy") === "false" &&
        c.getContext("2d").getImageData(5, 5, 1, 1).data[3] === 255
      );
    });
    await page.screenshot({ path: `/workspace/screenshots/dialogue-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "no horizontal page overflow",
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      sharedQuickFull: true,
      history: true,
      reopen: true,
      overflow: false,
      errors,
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
  await writeFile(
    "/workspace/screenshots/dialogue-ui-results.json",
    JSON.stringify(results, null, 2),
  );
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages())
      await p
        .screenshot({ path: "/workspace/screenshots/dialogue-ui-failure.png", fullPage: true })
        .catch(() => {});
  throw e;
} finally {
  await browser.close();
}
