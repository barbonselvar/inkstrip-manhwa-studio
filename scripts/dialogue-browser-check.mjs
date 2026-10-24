import { execFileSync } from "node:child_process";
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
  for (const width of process.env.DIALOGUE_TEST_WIDTH
    ? [Number(process.env.DIALOGUE_TEST_WIDTH)]
    : [1440, 768, 320, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 1440 ? 1000 : 900 },
        hasTouch: width < 500,
      }),
      page = await context.newPage(),
      errors = [];
    const sourceName =
      width === 320 ? `dialogue-${"long-name-".repeat(8)}.png` : "dialogue-source.png";
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
        name: sourceName,
        mimeType: "image/png",
        buffer: Buffer.from(bytes, "base64"),
      });
    await page.getByRole("button", { name: `Edit Image ${sourceName}`, exact: true }).waitFor();
    await page.getByRole("button", { name: "Text & Bubbles", exact: true }).click();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Page names do not overflow the Text & Bubbles entry",
    );
    await page.getByRole("button", { name: `Edit dialogue · ${sourceName}`, exact: true }).click();
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
    for (const name of [
      "Full editor",
      "Save draft",
      "Save dialogue to chapter",
      "Toggle Pro panels",
      "Back to chapter from Pro Studio",
    ]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      assert.ok(
        box && box.x >= -1 && box.x + box.width <= width + 1,
        `Essential header control is within viewport at ${width}px: ${name} ${JSON.stringify(box)}`,
      );
    }
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
    await page.getByRole("button", { name: `Edit dialogue · ${sourceName}`, exact: true }).click();
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
    if (width === 1440) {
      await page.getByLabel("Font family", { exact: true }).selectOption("Georgia");
      await page.getByRole("button", { name: "Vector", exact: true }).click();
      await page
        .getByRole("navigation", { name: "Pro panels", exact: true })
        .getByRole("button", { name: "Properties", exact: true })
        .click();
      assert.equal(await page.getByLabel("Text font", { exact: true }).inputValue(), "Georgia");
      await page.getByLabel("Text font", { exact: true }).selectOption("monospace");
      await page
        .locator(".pro-header")
        .getByRole("button", { name: "Dialogue", exact: true })
        .click();
      assert.equal(await page.getByLabel("Font family", { exact: true }).inputValue(), "monospace");
    }
    if (width === 1440) {
      await page
        .getByRole("navigation", { name: "Pro panels", exact: true })
        .getByRole("button", { name: "Export", exact: true })
        .click();
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export layered assets ZIP", exact: true }).click();
      const file = await pending,
        path = "/workspace/screenshots/dialogue-bubble-layers.zip";
      await file.saveAs(path);
      const proof = JSON.parse(
        execFileSync(
          "python3",
          [
            "-c",
            'import zipfile,json,sys,base64;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;n=next(n for n in z.namelist() if n.startswith("layers/") and "bubble" in n);d=json.loads(z.read("project.inkstrip"));b=next(l for l in d["document"]["layers"] if "bubble" in l);assert any(l["id"]==b["bubble"]["textId"] for l in d["document"]["layers"]);print(json.dumps({"png":base64.b64encode(z.read(n)).decode(),"layers":sum(n.startswith("layers/") for n in z.namelist())}))',
            path,
          ],
          { encoding: "utf8" },
        ),
      );
      assert.equal(proof.layers, 3);
      const coverage = await page.evaluate(async (data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
          b = await createImageBitmap(new Blob([bytes])),
          c = new OffscreenCanvas(b.width, b.height),
          x = c.getContext("2d");
        x.drawImage(b, 0, 0);
        b.close();
        const p = x.getImageData(0, 0, c.width, c.height).data;
        let ink = 0;
        for (let i = 3; i < p.length; i += 4) if (p[i]) ink++;
        return { ink, corner: p[(5 * c.width + 5) * 4 + 3] };
      }, proof.png);
      assert.ok(coverage.ink > 1000);
      assert.equal(coverage.corner, 0);
      await page
        .getByRole("navigation", { name: "Pro panels", exact: true })
        .getByRole("button", { name: "Dialogue", exact: true })
        .click();
    }
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
