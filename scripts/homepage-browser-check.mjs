/** Real browser coverage for the isolated homepage; no artwork/project fixtures are seeded. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8080";
const target = new URL(base);
assert.ok(
  ["127.0.0.1", "localhost", "inkstrip-manhwa-studio.vercel.app"].includes(target.hostname),
);
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const errors = [],
  failedAssets = [],
  results = [];
const gallery = (page) => page.getByRole("region", { name: "Original Inkstrip artwork gallery" });
const active = (page) => gallery(page).getAttribute("data-active");
async function loaded(page) {
  await page.getByRole("heading", { name: "Every frame. A world." }).waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".gallery-card img")].length === 9 &&
      [...document.querySelectorAll(".gallery-card img")].every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
  );
  await page.evaluate(() => document.fonts.ready);
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}
function watch(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === target.origin)
      failedAssets.push({ url: response.url(), status: response.status() });
  });
}
async function swipe(context, page, dx, dy = 0) {
  const stage = page.locator(".gallery-stage");
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox(),
    x = box.x + box.width / 2,
    y = Math.max(80, box.y + box.height / 2);
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
    });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watch(page);
  // Track only the gallery cadence to verify cleanup after route unmount.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, get: () => 8 });
    window.__galleryTimers = new Set();
    const originalSet = window.setInterval.bind(window),
      originalClear = window.clearInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      const id = originalSet(callback, delay, ...args);
      if (delay === 3000) window.__galleryTimers.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      window.__galleryTimers.delete(id);
      originalClear(id);
    };
  });
  await page.goto(base);
  await loaded(page);
  await page.mouse.move(0, 0);
  assert.equal(await page.locator(".robot-companion, .chapter-sculpture, canvas").count(), 0);
  assert.equal(
    await page
      .locator(
        '.gallery-card[data-position="front"], .gallery-card[data-position="left"], .gallery-card[data-position="right"]',
      )
      .count(),
    3,
  );
  assert.equal(await page.locator(".gallery-dialogue").count(), 4);
  assert.equal(await page.locator(".gallery-sfx").count(), 2);
  const provenance = await (await page.request.get(`${base}/gallery/provenance.json`)).json();
  assert.equal(provenance.artworks.length, 9);
  for (const artwork of provenance.artworks)
    for (const variant of artwork.variants) {
      const response = await page.request.get(`${base}/gallery/${variant.file}`);
      assert.equal(response.status(), 200);
      assert.equal(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
        variant.sha256,
      );
    }
  await page.evaluate(() => {
    window.__galleryChanges = [
      {
        index: Number(document.querySelector(".cinematic-gallery").dataset.active),
        at: performance.now(),
      },
    ];
    new MutationObserver(() => {
      const index = Number(document.querySelector(".cinematic-gallery")?.dataset.active);
      if (Number.isFinite(index) && index !== window.__galleryChanges.at(-1).index)
        window.__galleryChanges.push({ index, at: performance.now() });
    }).observe(document.querySelector(".cinematic-gallery"), {
      attributes: true,
      attributeFilter: ["data-active"],
    });
  });
  await page.waitForFunction(() => window.__galleryChanges.length >= 10, null, { timeout: 34000 });
  const changes = await page.evaluate(() => window.__galleryChanges);
  for (let i = 1; i < changes.length; i++) {
    assert.equal(changes[i].index, (changes[i - 1].index + 1) % 9);
    if (i > 1)
      assert.ok(
        changes[i].at - changes[i - 1].at >= 2700 && changes[i].at - changes[i - 1].at < 4300,
      );
  }
  results.push({ test: "real three-second full nine-artwork rotation", changes });
  await gallery(page).hover();
  const hovered = await active(page);
  await page.waitForTimeout(3200);
  assert.equal(await active(page), hovered);
  await page.getByRole("button", { name: "Next artwork", exact: true }).click();
  assert.equal(Number(await active(page)), (Number(hovered) + 1) % 9);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await active(page), hovered);
  await page.waitForTimeout(3100);
  assert.equal(await active(page), hovered, "keyboard focus pauses rotation");
  await page.getByRole("button", { name: "Pause automatic gallery rotation", exact: true }).click();
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(0, 0);
  await page.waitForTimeout(3200);
  assert.equal(await active(page), hovered);
  await page
    .getByRole("button", { name: "Resume automatic gallery rotation", exact: true })
    .click();
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(0, 0);
  await page.waitForFunction(
    () => document.querySelector(".cinematic-gallery").dataset.rotating === "true",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(
    () => document.querySelector(".cinematic-gallery").dataset.rotating === "false",
  );
  assert.equal(await page.evaluate(() => window.__galleryTimers.size), 0);
  assert.equal(
    await page
      .locator(".aurora-ribbon")
      .first()
      .evaluate((el) => getComputedStyle(el).animationPlayState),
    "paused",
  );
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () => document.querySelector(".cinematic-gallery").dataset.rotating === "false",
  );
  assert.equal(
    await page
      .locator(".gallery-card")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  assert.equal(
    await page
      .locator(".aurora-ribbon")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Studio preferences", exact: true }).click();
  await page.getByLabel("Studio motion", { exact: true }).selectOption("quiet");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await gallery(page).getAttribute("data-rotating"), "false");
  await page.getByRole("button", { name: "Studio preferences", exact: true }).click();
  await page.getByLabel("Studio motion", { exact: true }).selectOption("system");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('a.hero-secondary[href="#workflow"]').click();
  await page.locator("#workflow").waitFor();
  await page.waitForFunction(
    () => document.querySelector(".cinematic-gallery").dataset.rotating === "false",
  );
  assert.equal(await page.evaluate(() => window.__galleryTimers.size), 0);
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByPlaceholder("Night Market").fill("Cinematic Homepage Regression");
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByText("Chapter workspace", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__galleryTimers.size),
    0,
    "route unmount clears gallery timer",
  );
  results.push({
    test: "hover, focus, buttons, keyboard, explicit pause, hidden tab, reduced/quiet motion, links, project creation, unmount cleanup",
    passed: true,
  });
  await context.close();
  for (const width of [320, 360, 390, 768, 1440]) {
    const mobile = width < 768;
    const c = await browser.newContext({
      viewport: { width, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
    });
    const p = await c.newPage();
    watch(p);
    await p.goto(base);
    await loaded(p);
    await noOverflow(p);
    const stage = p.locator(".gallery-stage");
    await stage.scrollIntoViewIfNeeded();
    for (const card of await p.locator('.gallery-card:not([data-position="hidden"])').all()) {
      const box = await card.boundingBox();
      assert.ok(
        box.x >= -1 && box.x + box.width <= width + 1,
        "three cards remain inside viewport",
      );
    }
    for (const button of await p.locator(".gallery-controls button").all()) {
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    if (mobile) {
      const before = Number(await active(p));
      await swipe(c, p, -90);
      assert.equal(Number(await active(p)), (before + 1) % 9);
      await swipe(c, p, 90);
      assert.equal(Number(await active(p)), before);
      const initial = await p.evaluate(() => scrollY);
      await swipe(c, p, 0, -100);
      await p.waitForTimeout(100);
      assert.ok((await p.evaluate(() => scrollY)) > initial, "vertical swipes scroll the page");
      assert.equal(Number(await active(p)), before);
      await stage.scrollIntoViewIfNeeded();
      await stage.dispatchEvent("pointerdown", {
        pointerType: "touch",
        pointerId: 99,
        isPrimary: true,
        clientX: 120,
        clientY: 250,
      });
      await stage.dispatchEvent("pointercancel", {
        pointerType: "touch",
        pointerId: 99,
        isPrimary: true,
      });
      assert.equal(await gallery(p).getAttribute("data-rotating"), "false");
    }
    await p.screenshot({ path: `/workspace/screenshots/homepage-${width}.png`, fullPage: true });
    await p.setViewportSize({ width: 900, height: width });
    await noOverflow(p);
    results.push({ width, portraitAndLandscape: true, touchEmulation: mobile });
    await c.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failedAssets, []);
  const report = { ok: true, base, results, errors, failedAssets, physicalAndroid: false };
  await writeFile(
    "/workspace/screenshots/homepage-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
