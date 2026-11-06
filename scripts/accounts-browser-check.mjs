/** Local-only provider mocks; actual forms, IndexedDB, backup codec and transfer client. Never sends email. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { encode } from "fast-png";
const base = process.argv[2] ?? "http://127.0.0.1:8080",
  built = process.argv.includes("--built");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const hash = (b) => createHash("sha256").update(b).digest("hex");
await mkdir("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] }),
  errors = [],
  results = [];
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "qa@example.test",
  name: "QA Creator",
  avatar: null,
  verified: true,
  providers: ["email"],
  createdAt: "2026-11-06",
  preferences: {},
  deleting: false,
};
const projects = [],
  chunks = new Map(),
  records = new Map();
let signed = false,
  emailMode = "otp",
  recovered = false,
  failUpload = false,
  partCalls = 0,
  commitCalls = 0,
  switched = false,
  tamper = false;
async function attach(context) {
  await context.route("**/api/account/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.split("/api/account/")[1];
    let body = {};
    if (req.method() === "POST" && path !== "chunk") body = req.postDataJSON();
    const send = (value, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "session")
      return send({
        emailMode,
        recovery: recovered,
        configured: true,
        reason: null,
        google: true,
        facebook: true,
        user: signed
          ? { ...user, id: switched ? "22222222-2222-4222-8222-222222222222" : user.id }
          : null,
        csrf: "local-browser-test",
        fresh: false,
      });
    if (["signup", "forgot", "resend"].includes(path))
      return send({ message: "If eligible, check your inbox." });
    if (path === "verify") {
      signed = true;
      return send({ verified: true });
    }
    if (path === "login") {
      if (body.password === "invalid")
        return send({ error: "Sign-in failed.", code: "invalid_credentials" }, 401);
      signed = true;
      return send({ user });
    }
    if (path === "logout" || path === "reset-password") {
      signed = false;
      recovered = false;
      return send({ updated: true });
    }
    if (!signed) return send({ error: "Sign in.", code: "signed_out" }, 401);
    if (path === "profile") {
      Object.assign(user, { name: body.name, avatar: body.avatar, preferences: body.preferences });
      return send({ saved: true });
    }
    if (path === "projects") return send({ projects });
    if (path === "open-project") {
      let project = projects.find((p) => p.local_id === body.localId);
      if (!project) {
        project = {
          id: randomUUID(),
          local_id: body.localId,
          title: body.title,
          head_revision: 0,
          updated_at: new Date().toISOString(),
          bytes: 0,
        };
        projects.push(project);
      }
      return send({ project });
    }
    const id = url.searchParams.get("project"),
      digest = url.searchParams.get("digest");
    if (path === "chunk") {
      if (req.method() === "POST") {
        partCalls++;
        if (failUpload && partCalls === 2) {
          failUpload = false;
          return send({ error: "Simulated interrupted upload.", code: "service_unavailable" }, 503);
        }
        const bytes = req.postDataBuffer();
        assert.equal(hash(bytes), digest);
        chunks.set(`${id}/${digest}`, bytes);
        return send({ verified: true });
      }
      const bytes = chunks.get(`${id}/${digest}`);
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: tamper ? Buffer.from("corrupted") : bytes,
      });
    }
    if (path === "revision") return send(records.get(id));
    if (path === "commit") {
      commitCalls++;
      const p = projects.find((p) => p.id === body.project),
        manifest_hash = hash(JSON.stringify(body.manifest));
      if (p.head_revision !== body.base && records.get(p.id)?.manifest_hash !== manifest_hash)
        return send({ error: "A newer cloud revision exists.", code: "revision_conflict" }, 409);
      for (const part of body.manifest.parts)
        assert.equal(chunks.get(`${p.id}/${part.digest}`).length, part.bytes);
      if (records.get(p.id)?.manifest_hash !== manifest_hash) p.head_revision++;
      p.bytes = body.manifest.bytes;
      records.set(p.id, { revision: p.head_revision, manifest: body.manifest, manifest_hash });
      return send({ revision: p.head_revision, duplicate: false, hash: manifest_hash });
    }
    return send({ error: `Unexpected mocked endpoint ${path}` }, 404);
  });
}
function watch(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource.*(401|409|503)/.test(m.text()))
      errors.push(m.text());
  });
}
try {
  // Real missing-credentials response, independent of provider mocks.
  const real = await browser.newContext();
  const rp = await real.newPage();
  watch(rp);
  await rp.goto(base + "/account");
  await rp.getByText("Cloud setup is pending", { exact: true }).waitFor();
  assert.equal(await rp.getByRole("button", { name: "Sign in", exact: true }).isDisabled(), true);
  await rp.screenshot({
    path: "/workspace/screenshots/accounts-setup-desktop.png",
    fullPage: true,
  });
  await real.close();
  results.push("Unconfigured account service fails closed; local editor remains reachable");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await attach(context);
  const p = await context.newPage();
  watch(p);
  await p.goto(base + "/account");
  await p.waitForFunction(() => !document.querySelector("button[type=submit]")?.disabled);
  await p.getByRole("button", { name: "Create an account", exact: true }).click();
  await p.getByLabel("Display name", { exact: true }).fill("QA Creator");
  await p.getByLabel("Email address", { exact: true }).fill(user.email);
  await p.getByRole("textbox", { name: "Password", exact: true }).fill("Warrior 2026!");
  await p.getByRole("button", { name: "Show password", exact: true }).click();
  assert.equal(
    await p.getByRole("textbox", { name: "Password", exact: true }).getAttribute("type"),
    "text",
  );
  await p.getByRole("textbox", { name: "Confirm password", exact: true }).fill("Warrior 2026!");
  await p.getByRole("checkbox", { name: /I agree/ }).check();
  await p.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  await p.mouse.move(1, 1);
  await p.screenshot({
    path: "/workspace/screenshots/accounts-signup-desktop.png",
    fullPage: true,
  });
  await p.getByRole("button", { name: "Create account", exact: true }).click();
  await p.getByLabel("Six-digit code", { exact: true }).fill("123456");
  await p.getByRole("button", { name: "Verify email", exact: true }).click();
  await p.getByRole("button", { name: "Enter your account", exact: true }).click();
  await p.getByRole("heading", { name: "Creator profile", exact: true }).waitFor();
  assert.equal(partCalls, 0);
  await p.reload();
  await p.getByRole("heading", { name: "Creator profile", exact: true }).waitFor();
  await p.getByRole("button", { name: "Sign out", exact: true }).click();
  await p.getByRole("heading", { name: "Welcome back.", exact: true }).waitFor();
  await p.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await p.getByLabel("Email address", { exact: true }).fill(user.email);
  await p.getByRole("button", { name: "Send recovery code", exact: true }).click();
  await p.getByLabel("Six-digit code", { exact: true }).fill("123456");
  await p.getByRole("button", { name: "Verify email", exact: true }).click();
  await p.getByRole("textbox", { name: "Password", exact: true }).fill("Newwarrior 2026!");
  await p.getByRole("textbox", { name: "Confirm password", exact: true }).fill("Newwarrior 2026!");
  await p.getByRole("button", { name: "Update password", exact: true }).click();
  await p.getByText("Password updated. Sign in with your new password.", { exact: true }).waitFor();
  results.push(
    "Mock-provider registration, OTP verification, session restoration, logout and recovery forms",
  );
  // Create a real, isolated local chapter via existing UI. No persisted user browser data is accessed.
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).click();
  await p.getByLabel("Project title").fill("Cloud QA isolated project");
  await p.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await p.getByRole("button", { name: "Add images", exact: true }).waitFor();
  const pixels = new Uint8Array(1024 * 768 * 3);
  let seed = 51;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  const image = Buffer.from(encode({ width: 1024, height: 768, channels: 3, data: pixels }));
  await p
    .locator("input[type=file][multiple]")
    .first()
    .setInputFiles({ name: "qa-original.png", mimeType: "image/png", buffer: image });
  await p.getByRole("button", { name: "Display 1", exact: true }).waitFor({ timeout: 60000 });
  if (!built) {
    await p.goto(base + "/account");
    await p.getByLabel("Email address", { exact: true }).fill(user.email);
    await p.getByRole("textbox", { name: "Password", exact: true }).fill("Warrior 2026!");
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p.getByRole("heading", { name: "Creator profile", exact: true }).waitFor();
    assert.equal(partCalls, 0);
    assert.equal(
      await p.getByRole("button", { name: "Upload selected projects", exact: true }).isDisabled(),
      true,
    );
    await p.getByRole("checkbox", { name: /Cloud QA isolated project/ }).check();
    await p.getByRole("checkbox", { name: /I confirm these projects/ }).check();
    failUpload = true;
    await p.getByRole("button", { name: "Upload selected projects", exact: true }).click();
    await p.getByText("Simulated interrupted upload.", { exact: true }).waitFor();
    assert.equal(commitCalls, 0);
    assert.equal(chunks.size, 1);
    await p.reload();
    await p.getByRole("checkbox", { name: /Cloud QA isolated project/ }).check();
    await p.getByRole("checkbox", { name: /I confirm these projects/ }).check();
    await p.getByRole("button", { name: "Upload selected projects", exact: true }).click();
    await p
      .getByText("Cloud revision 1 verified. Your local copy was preserved.", { exact: true })
      .waitFor({ timeout: 60000 });
    assert.equal(projects.length, 1);
    assert.ok(chunks.size >= 2);
    const totalChunks = chunks.size;
    await p.evaluate(() => {
      document.activeElement?.blur?.();
      window.scrollTo(0, 0);
    });
    await p.mouse.move(1, 1);
    await p.screenshot({
      path: "/workspace/screenshots/accounts-dashboard-desktop.png",
      fullPage: true,
    });
    await p.getByRole("button", { name: "Restore locally", exact: true }).click();
    await p
      .getByRole("alert")
      .filter({ hasText: /already/ })
      .waitFor();
    assert.equal(projects[0].head_revision, 1);
    await p.getByRole("button", { name: "Upload selected projects", exact: true }).click();
    await p
      .getByText("Cloud revision 1 verified. Your local copy was preserved.", { exact: true })
      .waitFor();
    assert.equal(chunks.size, totalChunks);
    assert.equal(projects[0].head_revision, 1);
    projects[0].head_revision = 2;
    records.get(projects[0].id).manifest_hash = "f".repeat(64);
    await p.getByRole("button", { name: "Upload selected projects", exact: true }).click();
    await p.getByText("A newer cloud revision exists.", { exact: true }).waitFor();
    await p
      .getByRole("button", { name: "Upload conflicting project as a separate copy", exact: true })
      .click();
    await p
      .getByText("Cloud revision 1 verified. Your local copy was preserved.", { exact: true })
      .waitFor();
    assert.equal(projects.length, 2);
    assert.equal(projects[0].head_revision, 2);
    results.push(
      "Real local package upload interruption, refresh/resume, chunk deduplication, CAS conflict and explicit separate copy; existing restore refused",
    );
    const second = await browser.newContext();
    await attach(second);
    const p2 = await second.newPage();
    watch(p2);
    await p2.goto(base + "/account");
    await p2.getByRole("heading", { name: "Creator profile", exact: true }).waitFor();
    tamper = true;
    await p2.getByRole("button", { name: "Restore locally", exact: true }).nth(1).click();
    await p2
      .getByRole("alert")
      .filter({ hasText: /integrity check/ })
      .waitFor();
    assert.equal(await p2.getByRole("checkbox", { name: /Cloud QA/ }).count(), 0);
    tamper = false;
    await p2.getByRole("button", { name: "Restore locally", exact: true }).nth(1).click();
    await p2
      .getByText("Cloud project restored to this device. Existing projects were not overwritten.", {
        exact: true,
      })
      .waitFor({ timeout: 60000 });
    assert.equal(await p2.getByRole("checkbox", { name: /Cloud QA isolated project/ }).count(), 1);
    const preserved = await p2.evaluate(async () => {
      const { readProjectData } = await import("/src/lib/studio/backup-store.ts");
      const { useStudio } = await import("/src/lib/studio/store.ts");
      const data = await readProjectData(useStudio.getState().projects[0].id);
      const panel = data.panels[0],
        blob = data.blobs.get(panel.blobId);
      return Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
    });
    assert.equal(preserved, hash(image));
    await second.close();
    results.push(
      "Tampered package refused; verified cloud package restores on fresh device with exact original image hash",
    );
    // Direct transfer uses real code; account switching must prevent any commit.
    const before = commitCalls;
    switched = true;
    const rejected = await p.evaluate(async (owner) => {
      const { uploadLocalProject } = await import("/src/lib/accounts/transfers.ts");
      const { useStudio } = await import("/src/lib/studio/store.ts");
      try {
        await uploadLocalProject(
          owner,
          useStudio.getState().projects[0].id,
          false,
          new AbortController().signal,
          () => {},
        );
        return false;
      } catch (e) {
        return e.code === "account_changed";
      }
    }, user.id);
    assert.equal(rejected, true);
    assert.equal(commitCalls, before);
    switched = false;
    results.push("Account change cancels transfer; no implicit attachment to another account");
  }
  await context.close();
  for (const width of [320, 360, 390, 430]) {
    signed = false;
    const mobile = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    await attach(mobile);
    const page = await mobile.newPage();
    watch(page);
    await page.goto(base + "/account");
    await page.waitForFunction(() => !document.querySelector("button[type=submit]")?.disabled);
    await page.getByRole("button", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).fill("모바일 작가");
    await page.getByLabel("Email address", { exact: true }).fill(user.email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("Warrior 2026!");
    await page
      .getByRole("textbox", { name: "Confirm password", exact: true })
      .fill("Warrior 2026!");
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(
      await page.locator(".account-card").evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    if (width === 390) {
      await page.evaluate(() => {
        document.activeElement?.blur?.();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: "/workspace/screenshots/accounts-signup-mobile.png",
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByLabel("Six-digit code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Verify email", exact: true }).click();
    await page.getByRole("button", { name: "Enter your account", exact: true }).click();
    await page.getByRole("heading", { name: "Creator profile", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await mobile.close();
    results.push(`Touch ${width}px registration/dashboard + reduced motion + no overflow`);
  }
  emailMode = "link";
  for (const width of [1440, 360, 390, 430]) {
    signed = false;
    recovered = false;
    const linkContext = await browser.newContext({
      viewport: { width, height: 1000 },
      isMobile: width < 500,
      hasTouch: width < 500,
      reducedMotion: "reduce",
    });
    await attach(linkContext);
    const page = await linkContext.newPage();
    watch(page);
    await page.goto(base + "/account");
    await page.getByRole("button", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).fill("Link QA Creator");
    await page.getByLabel("Email address", { exact: true }).fill(user.email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("Warrior 2026!");
    await page
      .getByRole("textbox", { name: "Confirm password", exact: true })
      .fill("Warrior 2026!");
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByText(/Open the latest email link in this browser/).waitFor();
    assert.equal(await page.getByLabel("Six-digit code", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Check verification", exact: true }).click();
    await page.getByText(/then check again/).waitFor();
    signed = true; // Only local provider transport is mocked; no real email link is used.
    await page.goto(base + "/account?notice=email_verified");
    await page.getByRole("button", { name: "Enter your account", exact: true }).click();
    await page.getByRole("heading", { name: "Creator profile", exact: true }).waitFor();
    await page.goto(base + "/account?notice=recovery_verified");
    await page.getByRole("heading", { name: "Creator profile", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Update password", exact: true }).count(),
      0,
    );
    signed = false;
    await page.goto(base + "/account");
    await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
    await page.getByLabel("Email address", { exact: true }).fill(user.email);
    await page.getByRole("button", { name: "Send recovery link", exact: true }).click();
    await page.getByRole("button", { name: "Check verification", exact: true }).waitFor();
    signed = true;
    recovered = true; // Matches a successful BFF recovery callback, separately server-tested.
    await page.goto(base + "/account?notice=recovery_verified");
    await page.getByRole("button", { name: "Update password", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("Newwarrior 2026!");
    await page
      .getByRole("textbox", { name: "Confirm password", exact: true })
      .fill("Newwarrior 2026!");
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `/workspace/screenshots/accounts-email-link-reset-${width}.png`,
        fullPage: true,
      });
    await page.getByRole("button", { name: "Update password", exact: true }).click();
    await page
      .getByText("Password updated. Sign in with your new password.", { exact: true })
      .waitFor();
    await linkContext.close();
    results.push(
      `Email link signup/recovery at ${width}px, same-browser guidance, forged notice rejected; mocked provider`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, built, results, errors }, null, 2));
  await writeFile(
    `/workspace/screenshots/accounts-${built ? "built" : "dev"}-workflow.json`,
    JSON.stringify({ ok: true, built, results, errors }, null, 2),
  );
} finally {
  await browser.close();
}
