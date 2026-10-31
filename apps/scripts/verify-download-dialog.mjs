#!/usr/bin/env node
/**
 * Post-release verification (run by the `release` job of native-apps.yml):
 *   1. opens the LIVE production site in Chromium, clicks "Download App", and checks
 *      that the Android and Windows buttons link to exactly this release's assets;
 *   2. downloads both installers from those public links and compares their SHA-256
 *      with the release's SHA256SUMS.txt.
 *
 * Usage: node verify-download-dialog.mjs <tag> <release-dir-with-SHA256SUMS.txt> <out-dir>
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [tag, releaseDir, outDir] = process.argv.slice(2);
if (!tag || !releaseDir || !outDir) throw new Error("usage: <tag> <release-dir> <out-dir>");
mkdirSync(outDir, { recursive: true });
const SITE = "https://inkstrip-manhwa-studio.vercel.app/";
const REPO = process.env.GITHUB_REPOSITORY ?? "barbonselvar/inkstrip-manhwa-studio";
const sums = Object.fromEntries(
  readFileSync(join(releaseDir, "SHA256SUMS.txt"), "utf8")
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .map(([hash, name]) => [name.replace(/^\*/, ""), hash]),
);
const expectedBase = `https://github.com/${REPO}/releases/download/${tag}/`;
const report = [];
let failed = false;
const check = (name, ok, detail) => {
  report.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch();
try {
  for (const device of [
    {
      id: "desktop-windows",
      viewport: { width: 1366, height: 860 },
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      first: "Windows",
    },
    {
      id: "phone-android",
      viewport: { width: 412, height: 915 },
      ua: "Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      first: "Android",
    },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport, userAgent: device.ua });
    const page = await context.newPage();
    // GitHub's release API can lag a few seconds behind release creation.
    let links = null;
    for (let attempt = 1; attempt <= 6 && !links; attempt++) {
      await page.goto(SITE, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Download App" }).first().click({ timeout: 60000 });
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ timeout: 30000 });
      try {
        await dialog.getByRole("link", { name: "Download APK" }).waitFor({ timeout: 20000 });
        await dialog
          .getByRole("link", { name: "Download EXE installer" })
          .waitFor({ timeout: 5000 });
        links = {
          apk: await dialog.getByRole("link", { name: "Download APK" }).getAttribute("href"),
          exe: await dialog
            .getByRole("link", { name: "Download EXE installer" })
            .getAttribute("href"),
          text: await dialog.innerText(),
        };
      } catch {
        console.log(
          `(${device.id}: release not visible yet, attempt ${attempt}; retrying in 20 s)`,
        );
        await page.waitForTimeout(20000);
      }
    }
    await page.screenshot({ path: join(outDir, `download-dialog-${device.id}.png`) });
    check(
      `${device.id}: Download App dialog shows Android and Windows downloads`,
      !!links,
      links?.text?.slice(0, 300),
    );
    if (links) {
      check(
        `${device.id}: APK link points at ${tag}`,
        links.apk?.startsWith(expectedBase) && links.apk.endsWith(".apk"),
        links.apk,
      );
      check(
        `${device.id}: EXE link points at ${tag}`,
        links.exe?.startsWith(expectedBase) && links.exe.endsWith(".exe"),
        links.exe,
      );
      check(
        `${device.id}: dialog shows version ${tag.replace(/^app-v/, "")}`,
        links.text.includes(`Version ${tag.replace(/^app-v/, "")}`),
      );
      const firstCard =
        links.text.indexOf("Android") < links.text.indexOf("Windows") ? "Android" : "Windows";
      check(
        `${device.id}: ${device.first} offered first for this device`,
        firstCard === device.first,
        firstCard,
      );
    }
    if (device.id === "desktop-windows" && links) {
      for (const url of [links.apk, links.exe]) {
        const name = decodeURIComponent(url.split("/").pop());
        const response = await fetch(url, { redirect: "follow" });
        const bytes = Buffer.from(await response.arrayBuffer());
        const hash = createHash("sha256").update(bytes).digest("hex");
        check(
          `public download of ${name} matches SHA256SUMS.txt`,
          response.ok && hash === sums[name],
          {
            status: response.status,
            bytes: bytes.length,
            sha256: hash,
            expected: sums[name],
          },
        );
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(outDir, "download-dialog-results.json"), JSON.stringify(report, null, 2));
}
process.exit(failed ? 1 : 0);
