/** Existing immutable reference records: rename view/expression labels without
 * replacing identities, reference blobs, source panels or storage versions. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { proBrowserFixtures } from "../pro-browser-fixtures.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] }),
  base = process.argv[2] ?? "http://127.0.0.1:8080",
  errors = [],
  results = [];
async function stored(p) {
  return p.evaluate(async () => {
    const db = await new Promise((resolve) => {
        const r = indexedDB.open("inkstrip");
        r.onsuccess = () => resolve(r.result);
      }),
      profiles = await new Promise((resolve) => {
        const r = db.transaction("projects").objectStore("projects").getAll();
        r.onsuccess = () => resolve(r.result.flatMap((p) => p.characters ?? []));
      });
    db.close();
    const rows = [];
    for (const c of profiles) {
      const refs = [];
      for (const r of c.references)
        refs.push({
          id: r.id,
          angle: r.angle,
          hash: Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", await r.blob.arrayBuffer())),
            (v) => v.toString(16).padStart(2, "0"),
          ).join(""),
        });
      rows.push({ id: c.id, name: c.name, primaryId: c.primaryId, refs });
    }
    return rows;
  });
}
try {
  for (const width of [1440, 768, 390, 360, 320]) {
    const c = await browser.newContext({
        viewport: { width, height: 1000 },
        hasTouch: width < 800,
        isMobile: width < 500,
      }),
      p = await c.newPage(),
      fx = proBrowserFixtures(base, errors),
      source = await fx.start(p),
      before = (await fx.records(p))[0];
    await p.route("**/api/studio/ai-edit", () => {
      throw Error("No paid provider calls permitted");
    });
    const open = async () => {
      await p.getByRole("button", { name: "Edit Image geometry.png", exact: true }).click();
      await p.getByRole("button", { name: "Object Eraser & Retouch", exact: true }).click();
      await p.getByText("Character library", { exact: true }).click();
    };
    await open();
    await p.getByLabel("Character name", { exact: true }).fill("R14 subject");
    const upload = async (angle) => {
      await p.getByLabel("Reference angle", { exact: true }).fill(angle);
      await p.getByLabel("Upload character reference", { exact: true }).setInputFiles({
        name: "reference.png",
        mimeType: "image/png",
        buffer: Buffer.from(source, "base64"),
      });
    };
    await upload("Front neutral");
    await p.getByAltText("Character reference face", { exact: true }).waitFor();
    await p.waitForFunction(() => !document.querySelector(".character-library-fields")?.disabled);
    await upload("Left profile");
    await p.waitForFunction(
      () =>
        document.querySelector('[aria-label="Character reference angle"]')?.options.length === 2,
    );
    const previous = (await stored(p))[0];
    await p.getByLabel("Saved reference label", { exact: true }).fill("Left profile · smiling");
    await p.getByRole("button", { name: "Rename reference", exact: true }).click();
    await p
      .getByRole("option", { name: "Left profile · smiling", exact: true })
      .waitFor({ state: "attached" });
    await p.getByRole("button", { name: "Use as primary reference", exact: true }).click();
    await p.waitForFunction(() =>
      document
        .querySelector('[aria-label="Character reference angle"]')
        ?.selectedOptions[0]?.textContent.includes("smiling · primary"),
    );
    const renamed = (await stored(p))[0];
    assert.equal(renamed.id, previous.id);
    assert.deepEqual(
      renamed.refs.map((r) => [r.id, r.hash]),
      previous.refs.map((r) => [r.id, r.hash]),
    );
    assert.equal(renamed.refs[1].angle, "Left profile · smiling");
    assert.equal(renamed.primaryId, renamed.refs[1].id);
    assert.equal(
      (await fx.records(p))[0].blobId,
      before.blobId,
      "reference changes do not edit artwork",
    );
    await p.reload();
    assert.deepEqual((await stored(p))[0], renamed);
    await open();
    assert.equal(
      await p
        .getByRole("option", { name: "Left profile · smiling · primary", exact: true })
        .count(),
      1,
    );
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({
      path: `/workspace/screenshots/r14-character-${width}.png`,
      fullPage: true,
    });
    results.push({
      width,
      twoReferences: true,
      renamed: true,
      idsAndBlobBytesExact: true,
      primaryAndReload: true,
      sourceUnchanged: true,
    });
    await c.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await writeFile(
    "/workspace/r14-evidence/characters-browser.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
