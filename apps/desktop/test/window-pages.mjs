/**
 * The desktop window has two pages: the title bar (app://inkstrip/__shell/…) and the
 * studio view (app://inkstrip/…). Tests drive the studio and read save status from the
 * title bar, exactly as a user sees it.
 */
export async function windowPages(app, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const pages = app.windows();
    const studio = pages.find((p) => p.url().startsWith("app://inkstrip/") && !p.url().includes("/__shell/"));
    const shell = pages.find((p) => p.url().includes("/__shell/"));
    if (studio && shell) return { studio, shell };
    if (Date.now() > deadline) throw new Error(`window pages not found: ${pages.map((p) => p.url()).join(", ")}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Wait until the title bar's save status text matches `re`. */
export const waitShellStatus = (shell, re, timeout = 20_000) =>
  shell.waitForFunction(
    (src) => new RegExp(src).test(document.querySelector(".save")?.textContent ?? ""),
    re.source,
    { timeout },
  );
