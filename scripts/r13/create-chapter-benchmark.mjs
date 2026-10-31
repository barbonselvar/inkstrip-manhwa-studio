/** R13: in-page timing of New project → Create → Chapter workspace rendered (DOM clicks
 * and rAF polling, so Playwright actionability waits are excluded). A realistic pause
 * while the user types the title is included before Create. Usage:
 * node scripts/r13/create-chapter-benchmark.mjs [base] [runs] */
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8081";
const runs = Number(process.argv[3] ?? 7);
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y),
    i = (s.length - 1) * p,
    lo = Math.floor(i);
  return +(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)).toFixed(1);
};
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const rows = [];
for (let i = 0; i < runs; i++) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).waitFor();
  await p.waitForTimeout(800);
  rows.push(
    await p.evaluate(async () => {
      const until = (f) =>
        new Promise((res) => {
          const tick = () => (f() ? res() : requestAnimationFrame(tick));
          tick();
        });
      const btn = (name) =>
        [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
      btn("New project").click();
      await until(() => document.querySelector('input[placeholder="Night Market"]'));
      const input = document.querySelector('input[placeholder="Night Market"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Bench");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600)); // the user typing a title
      const t0 = performance.now();
      btn("Create chapter 1").click();
      await until(() =>
        [...document.querySelectorAll("p")].some((e) => e.textContent === "Chapter workspace"),
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
    createToWorkspaceMs: { p50: pct(rows, 0.5), p95: pct(rows, 0.95), n: rows.length },
  }),
);
