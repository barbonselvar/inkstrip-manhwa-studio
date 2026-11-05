import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir("/workspace/composition-evidence", { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }),
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  page = await context.newPage();
await page.addInitScript(() => performance.setResourceTimingBufferSize(10000));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill("Composition integrity");
  await page.getByRole("button", { name: "Create chapter 1", exact: true }).click();
  await page.getByRole("button", { name: "Add images", exact: true }).waitFor();
  await page
    .locator("input[type=file][multiple]")
    .first()
    .setInputFiles([
      {
        name: "landscape.webp",
        mimeType: "image/webp",
        buffer: await readFile("public/gallery/murim-720.webp"),
      },
      {
        name: "night.webp",
        mimeType: "image/webp",
        buffer: await readFile("public/gallery/horror-720.webp"),
      },
    ]);
  await page.getByRole("button", { name: "Display 2", exact: true }).waitFor();
  await page.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await page.locator("[data-composition=studio]").waitFor();
  const result = await page.evaluate(async () => {
    const source = (path) =>
      performance
        .getEntriesByType("resource")
        .map((x) => x.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const store = (await import(source("/src/lib/studio/store.ts"))).useStudio,
      chapter = store.getState().chapters.find((c) => location.pathname.endsWith(c.id)),
      panels = store
        .getState()
        .panels.filter((p) => p.chapterId === chapter.id)
        .sort((a, b) => a.order - b.order);
    const { getController } = await import(source("/src/lib/studio/composition/controller.ts")),
      controller = getController(chapter, panels);
    window.__deep = { store, controller, chapter, panels };
    const { renderRegion, RenderResources } = await import("/src/lib/studio/composition/render.ts"),
      { FX_CATEGORIES, fx, sfx, SFX_STYLES, unavailableStyle } =
        await import("/src/lib/studio/composition/library.ts"),
      { createComposition } = await import("/src/lib/studio/composition/model.ts"),
      { exportComposition, recoveryPackage } =
        await import("/src/lib/studio/composition/export.ts"),
      { getBlob, putRecords } = await import("/src/lib/studio/db.ts"),
      { saveComposition } = await import("/src/lib/studio/composition/storage.ts"),
      { decodeBackup } = await import("/src/lib/studio/backup.ts");
    const resources = new RenderResources(),
      d = createComposition(chapter, panels),
      bytes = await Promise.all(
        panels.map(async (p) => [
          p.blobId,
          Array.from(new Uint8Array(await (await getBlob(p.blobId)).arrayBuffer())),
        ]),
      );
    const render = async (doc) => {
      const c = await renderRegion(doc, panels, { y: 0, height: 500 }, 400, resources),
        data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      c.width = c.height = 0;
      return data;
    };
    const base = await render(d),
      different = (a, b) => {
        let n = 0;
        for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) n++;
        return n;
      };
    const effects = [];
    for (const name of Object.values(FX_CATEGORIES).flat()) {
      const object = { ...fx(name, 800, 500), owner: panels[0].id };
      const data = await render({ ...d, objects: [object] });
      const changed = different(base, data);
      if (!changed) throw Error(`${name} has no visible output`);
      effects.push({ name, changed });
    }
    const lettering = [];
    for (const style of SFX_STYLES.filter((style) => !unavailableStyle(style))) {
      const object = { ...sfx("SWISH", style), owner: panels[0].id };
      const changed = different(base, await render({ ...d, objects: [object] }));
      if (!changed) throw Error(`${style} has no lettering output`);
      lettering.push({ style, changed });
    }
    for (const text of ["슉", "スッ", "حفيف", "WHOOSH 💥"]) {
      const changed = different(
        base,
        await render({ ...d, objects: [{ ...sfx(text), owner: panels[0].id }] }),
      );
      if (!changed) throw Error(`Missing Unicode output: ${text}`);
      lettering.push({ text, changed });
    }
    const extension = [];
    for (const fill of ["solid", "transparent", "gradient", "blur", "mirror"]) {
      const scene = structuredClone(d);
      scene.panels[panels[0].id].top = {
        ...scene.panels[panels[0].id].top,
        height: 150,
        fill,
        color: "#112233",
        color2: "#abcdef",
      };
      const c = await renderRegion(scene, panels, { y: 0, height: 150 }, 400, resources);
      extension.push({ fill, width: c.width, height: c.height });
      if (c.height !== 75) throw Error("Extension dimensions drifted");
      c.width = c.height = 0;
    }
    const formats = [];
    for (const format of ["image/png", "image/jpeg", "image/webp"]) {
      const entries = await exportComposition(d, panels, {
        format,
        width: 400,
        quality: 0.9,
        segmentHeight: 512,
        background: "#ffffff",
        panelIds: [panels[0].id],
      });
      const decoded = await createImageBitmap(entries[0].blob);
      if (entries[0].blob.type !== format || decoded.width !== 400)
        throw Error(`Invalid ${format}`);
      formats.push({ format, parts: entries.length, width: decoded.width });
      decoded.close();
    }
    const stale = { ...chapter };
    controller.change((doc) => ({ ...doc, opening: { ...doc.opening, height: 321 } }));
    await controller.flush();
    const saved = await putRecords({ chapters: [{ ...stale, title: "Metadata retains scene" }] });
    if (saved.chapters[0].composition.document.opening.height !== 321)
      throw Error("Metadata write lost composition");
    store.setState((s) => ({
      chapters: s.chapters.map((c) => (c.id === chapter.id ? saved.chapters[0] : c)),
    }));
    const original = IDBObjectStore.prototype.put;
    let quotaError = false,
      recoveryHeight;
    try {
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (value?.composition?.document?.opening?.height === 999)
          throw new DOMException("Test storage quota", "QuotaExceededError");
        return original.call(this, value, ...args);
      };
      controller.change((doc) => ({ ...doc, opening: { ...doc.opening, height: 999 } }));
      try {
        await controller.flush();
      } catch {
        quotaError = true;
      }
      const pendingOrder = [...controller.getState().history.present.order].reverse();
      controller.reorder(pendingOrder);
      const recovered = await decodeBackup(
        await recoveryPackage(
          chapter.projectId,
          chapter.id,
          controller.getState().history.present.document,
          pendingOrder,
        ),
      );
      if (
        JSON.stringify([...recovered.panels].sort((a, b) => a.order - b.order).map((p) => p.id)) !==
        JSON.stringify(pendingOrder)
      )
        throw Error("Recovery lost pending panel order");
      controller.reorder(panels.map((p) => p.id));
      recoveryHeight = recovered.chapters.find((c) => c.id === chapter.id).composition.document
        .opening.height;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    if (!quotaError || recoveryHeight !== 999) throw Error("Quota recovery lost pending edits");
    await controller.flush();
    const s = controller.getState(),
      fresh = await saveComposition(
        chapter.id,
        s.history.present.document,
        s.revision,
        s.expectedOrder,
        s.history.present.order,
      );
    let conflict = false;
    try {
      await saveComposition(
        chapter.id,
        s.history.present.document,
        s.revision,
        s.expectedOrder,
        s.history.present.order,
      );
    } catch {
      conflict = true;
    }
    if (!conflict) throw Error("Revision conflict overwrote another save");
    controller.setState({ revision: fresh.record.revision });
    store.setState((state) => ({
      chapters: state.chapters.map((c) => (c.id === chapter.id ? fresh.chapter : c)),
    }));
    for (const [id, before] of bytes) {
      const after = Array.from(new Uint8Array(await (await getBlob(id)).arrayBuffer()));
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw Error("Accepted source bytes changed");
    }
    // Prepare a real saved native draft; the UI will explicitly snapshot it below.
    const { fromPanel } = await import("/src/lib/studio/pro/model.ts"),
      { saveSession } = await import("/src/lib/studio/pro/storage.ts");
    const native = fromPanel(panels[0]);
    await saveSession(
      {
        document: native,
        assets: { source: await getBlob(panels[0].blobId) },
        revision: 0,
        acceptedBlobId: panels[0].blobId,
        updatedAt: Date.now(),
      },
      0,
    );
    resources.clear();
    return {
      effects,
      lettering,
      extension,
      formats,
      metadataPreserved: true,
      quotaError,
      recoveryHeight,
      conflict,
      sourcesByteExact: true,
    };
  });
  await page.getByRole("button", { name: "Focus panel 1", exact: true }).click();
  await page
    .getByRole("button", { name: "Use saved Raster / dialogue draft", exact: true })
    .click();
  await page.getByText("Using native revision 1.", { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector("[data-composition=studio]").dataset.saveStatus === "saved",
  );
  const snapshot = await page.evaluate(() => {
    const s = window.__deep;
    const d = s.controller.getState().history.present.document;
    return {
      panelId: s.panels[0].id,
      snapshot: d.panels[s.panels[0].id].snapshot,
      accepted: s.store.getState().panels.find((p) => p.id === s.panels[0].id).blobId,
      original: s.panels[0].blobId,
    };
  });
  assert.ok(snapshot.snapshot);
  assert.equal(snapshot.accepted, snapshot.original);
  result.nativeSnapshot = snapshot;
  const packageData = await page.evaluate(async () => {
    const { recoveryPackage } = await import("/src/lib/studio/composition/export.ts");
    const s = window.__deep,
      blob = await recoveryPackage(
        s.chapter.projectId,
        s.chapter.id,
        s.controller.getState().history.present.document,
      );
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  });
  const restore = await browser.newContext(),
    p = await restore.newPage();
  await p.goto(base);
  const restored = await p.evaluate(
    async ({ data, panelId }) => {
      const { decodeBackup } = await import("/src/lib/studio/backup.ts"),
        { writeProjectData } = await import("/src/lib/studio/backup-store.ts");
      const decoded = await decodeBackup(await (await fetch(data)).blob());
      await writeProjectData(decoded);
      const panel = decoded.panels.find((p) => p.id === panelId),
        chapter = decoded.chapters.find((c) => c.id === panel.chapterId);
      let duplicateRejected = false;
      try {
        await writeProjectData(decoded);
      } catch {
        duplicateRejected = true;
      }
      if (!duplicateRejected) throw Error("Existing project was overwritten");
      return {
        projectId: decoded.project.id,
        chapterId: chapter.id,
        snapshot: chapter.composition.document.panels[panelId].snapshot,
      };
    },
    { data: packageData, panelId: snapshot.panelId },
  );
  assert.equal(restored.snapshot.blobId, snapshot.snapshot.blobId);
  await p.goto(`${base}/p/${restored.projectId}/c/${restored.chapterId}`);
  await p.getByRole("button", { name: "Composition & FX", exact: true }).click();
  await p.locator("[data-composition=studio]").waitFor();
  await p.waitForFunction(
    () => document.querySelector(".composition-tile")?.dataset.renderStatus === "ready",
    null,
    { timeout: 60000 },
  );
  result.editableRestore = true;
  await restore.close();
  assert.deepEqual(errors, []);
  await writeFile(
    "/workspace/composition-evidence/deep-results.json",
    JSON.stringify({ result, errors }, null, 2),
  );
  console.log(JSON.stringify({ result, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "/workspace/screenshots/composition-deep-failure.png" });
  await writeFile(
    "/workspace/composition-evidence/deep-failure.json",
    JSON.stringify({ error: String(error), stack: error.stack, errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
