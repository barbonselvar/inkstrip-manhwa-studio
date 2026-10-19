/** Isolated visual/interaction QA. Generated poster fixtures are test artwork, never seeded into the product. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const measurements = [];
async function capture(page, path, fullPage = false) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.locator(".image-stage-rendering").waitFor({ state: "hidden" });
  await page.screenshot({ path, fullPage });
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("inkstrip");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const read = (name) =>
      new Promise((resolve) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const projects = await read("projects"),
      chapters = await read("chapters"),
      panels = await read("panels");
    db.close();
    return JSON.stringify({ projects, chapters, panels });
  });
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "No document overflow",
  );
}
async function sampleFrames(page) {
  return page.evaluate(async () => {
    const values = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const next = (time) => {
        values.push(time - previous);
        previous = time;
        if (values.length < 60) requestAnimationFrame(next);
        else resolve();
      };
      requestAnimationFrame(next);
    });
    values.shift();
    values.sort((a, b) => a - b);
    return {
      median: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      max: values.at(-1),
    };
  });
}
async function createStory(page, title) {
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill(title);
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByText("Chapter workspace", { exact: true }).waitFor();
  return page.url();
}
async function posters(page, title, count = 3) {
  const data = await page.evaluate(
    ({ title, count }) =>
      Array.from({ length: count }, (_, i) => {
        const c = document.createElement("canvas");
        c.width = 480;
        c.height = 720;
        const x = c.getContext("2d");
        const g = x.createLinearGradient(0, 0, 0, 720);
        g.addColorStop(0, ["#263e3c", "#243243", "#453c39"][i % 3]);
        g.addColorStop(1, "#0b141a");
        x.fillStyle = g;
        x.fillRect(0, 0, 480, 720);
        x.fillStyle = "#d9e9d2";
        x.beginPath();
        x.arc(335, 200, 75, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = "#243a36";
        x.beginPath();
        x.arc(309, 176, 68, 0, Math.PI * 2);
        x.fill();
        for (let n = 0; n < 19; n++) {
          const bx = n * 28 - 15,
            top = 350 + ((n * 47) % 140);
          x.fillStyle = n % 2 ? "#121f25" : "#192b2d";
          x.fillRect(bx, top, 27, 720 - top);
          x.strokeStyle = "#758c7625";
          x.strokeRect(bx, top, 27, 720 - top);
          for (let y = top + 15; y < 650; y += 17) {
            x.fillStyle = "#b9d5b155";
            x.fillRect(bx + 6, y, 3, 5);
            x.fillRect(bx + 17, y, 3, 5);
          }
        }
        x.strokeStyle = "#d0e0cf33";
        x.lineWidth = 1;
        for (let n = 0; n < 40; n++) {
          const px = (n * 79) % 480,
            py = (n * 137) % 720;
          x.beginPath();
          x.moveTo(px, py);
          x.lineTo(px - 30, py + 90);
          x.stroke();
        }
        x.fillStyle = "#dae8d7";
        x.font = "11px sans-serif";
        x.fillText("INKSTRIP / VISUAL QA STUDY", 34, 42);
        x.font = "italic 48px Georgia";
        x.fillText(title.split(" ")[0], 32, 107);
        x.font = "italic 38px Georgia";
        x.fillText(title.split(" ").slice(1).join(" "), 32, 155);
        x.font = "11px sans-serif";
        x.fillText(`CHAPTER ${i + 1}   —   THE CITY REMEMBERS`, 34, 679);
        return { name: `study-${i + 1}.png`, data: c.toDataURL().split(",")[1] };
      }),
    { title, count },
  );
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      data.map((f) => ({
        name: f.name,
        mimeType: "image/png",
        buffer: Buffer.from(f.data, "base64"),
      })),
    );
  await page.getByRole("button", { name: "Display 3", exact: true }).waitFor();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New project", exact: true }).waitFor();
  await page.keyboard.press("/");
  assert.equal(
    await page
      .getByLabel("Search projects", { exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Tab");
  const first = await createStory(page, "Midnight Atlas");
  await posters(page, "Midnight Atlas");
  await page.getByRole("link", { name: "Back to Midnight Atlas", exact: true }).click();
  await page.getByRole("button", { name: "New chapter", exact: true }).click();
  await posters(page, "The Pale Hour");
  await page.getByRole("link", { name: "Back to Midnight Atlas", exact: true }).click();
  await capture(page, "/workspace/screenshots/inkstrip-ui-project.png", true);
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await createStory(page, "Paper Satellites");
  await posters(page, "Paper Satellites");
  await page.goto(base);
  await page.locator(".project-shelf").scrollIntoViewIfNeeded();
  await page.locator(".project-card img").first().waitFor();
  await page.evaluate(async () => {
    await Promise.all(
      [...document.querySelectorAll(".project-card img")].map((img) =>
        img.decode().catch(() => {}),
      ),
    );
    window.scrollTo(0, 0);
  });
  await capture(page, "/workspace/screenshots/inkstrip-ui-library.png", true);
  await noOverflow(page);
  const card = page.locator(".project-shelf .depth-surface").first();
  await card.hover();
  const r = await card.boundingBox();
  await page.mouse.move(r.x + r.width * 0.85, r.y + r.height * 0.3);
  await page.waitForTimeout(150);
  assert.notEqual(await card.locator("a").evaluate((el) => getComputedStyle(el).transform), "none");
  await page.mouse.move(0, 0);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Studio preferences", exact: true }).click();
  await page.getByLabel("Studio motion", { exact: true }).selectOption("quiet");
  await page.getByRole("checkbox", { name: "Ambient atmosphere", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Translucent surfaces", exact: true }).uncheck();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.studioMotion === "quiet");
  assert.deepEqual(await snapshot(page), before, "Appearance changes preserve artwork records");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.studioMotion), "quiet");
  assert.equal(
    await page.locator(".studio-atmosphere").evaluate((el) => getComputedStyle(el).display),
    "none",
  );
  assert.equal(
    await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    ),
    0,
  );
  await page.getByRole("button", { name: "Studio preferences", exact: true }).click();
  await capture(page, "/workspace/screenshots/inkstrip-ui-preferences.png");
  await page.getByLabel("Studio motion", { exact: true }).selectOption("system");
  await page.getByRole("checkbox", { name: "Ambient atmosphere", exact: true }).check();
  await page.getByRole("checkbox", { name: "Translucent surfaces", exact: true }).check();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  measurements.push({ viewport: "desktop", frames: await sampleFrames(page) });
  await page.goto(first);
  await page.getByRole("button", { name: "Display 3", exact: true }).click();
  await page.locator(".manhwa-image").first().waitFor();
  await capture(page, "/workspace/screenshots/inkstrip-ui-chapter.png");
  await page.getByRole("button", { name: "Edit Image study-1.png", exact: true }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await page.getByLabel("Brightness", { exact: true }).waitFor();
  await capture(page, "/workspace/screenshots/inkstrip-ui-editor.png");
  assert.equal(
    await page.locator(".image-plane").evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.getByRole("button", { name: "Object Eraser & Retouch", exact: true }).click();
  await page.getByLabel("Selection shape", { exact: true }).selectOption("ellipse");
  const plane = await page.locator(".retouch-plane").boundingBox();
  const viewport = await page.locator(".retouch-viewport").boundingBox();
  assert.ok(
    plane.height <= viewport.height && plane.width <= viewport.width,
    "Initial retouch view fits the complete artwork",
  );
  const mask = page.getByLabel("Retouch selection", { exact: true }),
    box = await mask.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await capture(page, "/workspace/screenshots/inkstrip-ui-retouch.png");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "AI Enhance study-1.png", exact: true }).click();
  await page.getByRole("dialog", { name: "AI Enhance", exact: true }).waitFor();
  await capture(page, "/workspace/screenshots/inkstrip-ui-ai.png");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Batch edit selected", exact: true }).click();
  await page.getByRole("img", { name: "Batch first-image preview", exact: true }).waitFor();
  await capture(page, "/workspace/screenshots/inkstrip-ui-batch.png");
  await page.getByRole("button", { name: "Close batch", exact: true }).click();
  assert.deepEqual(errors, []);
  await context.close();
  for (const width of [320, 360, 390]) {
    const c = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
      }),
      p = await c.newPage(),
      err = [];
    p.on("pageerror", (e) => err.push(e.message));
    p.setDefaultTimeout(30000);
    await p.goto(base);
    await p.getByRole("button", { name: "New project", exact: true }).waitFor();
    assert.equal(
      await p.evaluate(
        () => document.getAnimations().filter((a) => a.playState === "running").length,
      ),
      0,
    );
    assert.equal(
      await p.locator(".ambient-one").evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await noOverflow(p);
    if (width === 390)
      await capture(p, "/workspace/screenshots/inkstrip-ui-library-mobile.png", true);
    await createStory(p, "Small Screen Study");
    await posters(p, "Small Screen Study");
    await noOverflow(p);
    const hit = await p
      .getByRole("button", { name: "Drag to reorder study-1.png", exact: true })
      .boundingBox();
    assert.ok(hit.width >= 44 && hit.height >= 44);
    await p.getByRole("button", { name: "Edit Image study-1.png", exact: true }).click();
    await p.getByRole("button", { name: "Crop", exact: true }).click();
    await noOverflow(p);
    await p.waitForFunction(() => {
      const plane = document.querySelector(".image-plane")?.getBoundingClientRect();
      const stage = document.querySelector(".image-stage")?.getBoundingClientRect();
      return (
        plane &&
        stage &&
        plane.top >= stage.top &&
        plane.bottom <= stage.bottom &&
        plane.left >= stage.left &&
        plane.right <= stage.right
      );
    });
    if (width === 390) await capture(p, "/workspace/screenshots/inkstrip-ui-editor-mobile.png");
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await p.getByRole("button", { name: "Studio preferences", exact: true }).click();
    await p.getByRole("dialog", { name: "Studio preferences", exact: true }).waitFor();
    const dialog = await p
      .getByRole("dialog", { name: "Studio preferences", exact: true })
      .boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width);
    if (width === 390)
      await capture(p, "/workspace/screenshots/inkstrip-ui-preferences-mobile.png");
    await p.keyboard.press("Escape");
    await p
      .getByRole("dialog", { name: "Studio preferences", exact: true })
      .waitFor({ state: "hidden" });
    assert.deepEqual(err, []);
    await c.close();
  }
  await writeFile(
    "/workspace/screenshots/inkstrip-ui-performance.json",
    JSON.stringify(
      {
        measurements,
        physicalAndroid: false,
        notes: "Headless Chromium frame samples are diagnostics, not an FPS guarantee.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "real project/chapter covers",
        "mouse CSS depth",
        "search shortcut",
        "appearance persistence and unchanged IndexedDB records",
        "quiet/OS reduced motion",
        "320/360/390px overflow and 44px grip",
        "modal keyboard and mobile sheet bounds",
        "editor/AI/retouch/batch visual evidence",
        "no animated artwork plane",
      ],
      measurements,
    }),
  );
} finally {
  await browser.close();
}
