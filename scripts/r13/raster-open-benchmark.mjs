/** R13: click "Open in Raster Studio" -> first composite rendered (aria-busy=false),
 * measured in-page after the Chapter has been idle for 2 s (a user looking at it).
 * Usage: node scripts/r13/raster-open-benchmark.mjs [base] [runs] [width] */
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
const runs = Number(process.argv[3] ?? 5);
const width = Number(process.argv[4] ?? 1440);
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y),
    i = (s.length - 1) * p,
    lo = Math.floor(i);
  return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(1);
};
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const rows = [];
for (let i = 0; i < runs; i++) {
  const p = await browser.newPage({
    viewport: { width, height: width > 800 ? 1000 : 844 },
    isMobile: width < 800,
    hasTouch: width < 800,
  });
  p.setDefaultTimeout(60000);
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByPlaceholder("Night Market").fill("Raster open");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByText("Chapter workspace", { exact: true }).waitFor();
  const png = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1080;
    c.height = 1920;
    const x = c.getContext("2d");
    x.fillStyle = "#f3efe6";
    x.fillRect(0, 0, 1080, 1920);
    return c.toDataURL().split(",")[1];
  });
  await p
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      { name: "page.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
    ]);
  await p.getByRole("button", { name: "Edit Image page.png", exact: true }).waitFor();
  await p.reload();
  await p.getByRole("button", { name: "Edit Image page.png", exact: true }).waitFor();
  await p.waitForTimeout(2000);
  rows.push(
    await p.evaluate(async () => {
      const until = (f) =>
        new Promise((res) => {
          const tick = () => (f() ? res() : requestAnimationFrame(tick));
          tick();
        });
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Open in Raster Studio",
      );
      const t0 = performance.now();
      button.click();
      await until(
        () =>
          document
            .querySelector('canvas[aria-label="Pro composite preview"]')
            ?.getAttribute("aria-busy") === "false",
      );
      return performance.now() - t0;
    }),
  );
  await p.close();
}
await browser.close();
console.log(
  JSON.stringify({
    base,
    width,
    rasterOpenMs: { p50: pct(rows, 0.5), p95: pct(rows, 0.95), n: rows.length },
  }),
);
