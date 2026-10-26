/** Actual worker integration for Smart Filter masks, R6 pixel processing and R5 safety boundaries. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:8080";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const errors = [],
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const p = await browser.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(base);
  await p.getByRole("button", { name: "New project", exact: true }).waitFor();
  const result = await p.evaluate(async () => {
    const [{ ProRenderer }, { fromPanel, layer }, { colorDocument }, { nativeFile, readNative }] =
      await Promise.all([
        import("/src/lib/studio/pro/client.ts"),
        import("/src/lib/studio/pro/model.ts"),
        import("/src/lib/studio/pro/color-transaction.ts"),
        import("/src/lib/studio/pro/files.ts"),
      ]);
    const d = fromPanel({ id: "worker", name: "R8 integration", width: 128, height: 96 });
    d.version = 3;
    d.layers[0].visible = false;
    const paint = layer("paint", 128, 96, "paint");
    paint.strokes = [
      {
        points: [
          { x: 24, y: 48 },
          { x: 104, y: 48 },
        ],
        size: 20,
        opacity: 1,
        flow: 1,
        hardness: 1,
        color: "#ff0000",
        erase: false,
      },
    ];
    paint.mask = {
      enabled: true,
      strokes: [],
      selection: {
        regions: [
          {
            kind: "rectangle",
            operation: "add",
            points: [
              { x: 0, y: 0 },
              { x: 96, y: 96 },
            ],
          },
        ],
        inverted: false,
        feather: 0,
      },
    };
    paint.smartFilters = [
      {
        id: "blur",
        enabled: true,
        operation: { kind: "gaussian", radius: 2 },
        mask: {
          enabled: true,
          density: 1,
          inverted: false,
          selection: {
            regions: [
              {
                kind: "rectangle",
                operation: "add",
                points: [
                  { x: 0, y: 0 },
                  { x: 64, y: 96 },
                ],
              },
            ],
            inverted: false,
            feather: 0,
          },
        },
      },
    ];
    d.layers.push(paint);
    d.selection = {
      regions: [
        {
          kind: "rectangle",
          operation: "add",
          points: [
            { x: 0, y: 0 },
            { x: 64, y: 96 },
          ],
        },
      ],
      inverted: false,
      feather: 0,
    };
    const sourceCanvas = new OffscreenCanvas(128, 96);
    sourceCanvas.getContext("2d").clearRect(0, 0, 128, 96);
    const source = await sourceCanvas.convertToBlob({ type: "image/png" }),
      session = {
        document: d,
        assets: { source },
        revision: 0,
        acceptedBlobId: "accepted",
        updatedAt: 1,
      },
      worker = new ProRenderer(),
      maxArea = 16_777_216;
    const decode = async (blob) => {
      const bitmap = await createImageBitmap(blob),
        c = new OffscreenCanvas(bitmap.width, bitmap.height);
      c.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const image = c.getContext("2d").getImageData(0, 0, c.width, c.height);
      c.width = c.height = 1;
      return image;
    };
    const exported = async (doc) =>
      decode((await worker.export(doc, maxArea, "image/png", 1, () => {})).blob);
    const same = (a, b, label) => {
      if (a.width !== b.width || a.height !== b.height) throw Error(label + " dimensions");
      for (let i = 0; i < a.data.length; i++)
        if (a.data[i] !== b.data[i])
          throw Error(label + " channel " + i + ": " + a.data[i] + " != " + b.data[i]);
    };
    try {
      await worker.init(session, maxArea);
      const masked = await exported(d),
        maskPixel = (x, y) => masked.data[(y * 128 + x) * 4 + 3];
      if (!maskPixel(32, 34) || maskPixel(80, 34) !== 0 || maskPixel(110, 48) !== 0)
        throw Error("Filter mask and layer mask must affect distinct stages");
      const raw = await worker.colorSource(d, maxArea, "paint"),
        rawPixels = await decode(raw.blob),
        rawReference = { ...d, layers: [{ ...paint, mask: undefined, smartFilters: undefined }] };
      same(rawPixels, await exported(rawReference), "R6 source excludes R8 filters");
      // A neutral destructive color replacement must retain the stack and never blur it twice.
      const colored = colorDocument(d, "paint", "processed", "original", maxArea),
        coloredSession = { ...session, document: colored, assets: { source, processed: raw.blob } };
      await worker.init(coloredSession, maxArea);
      same(masked, await exported(colored), "Color replacement applies filters once");
      if (colored.layers.find((l) => l.id === "paint").smartFilters[0].id !== "blur")
        throw Error("Filter settings lost");
      const file = await nativeFile(coloredSession),
        reopened = await readNative(file, "worker", "accepted");
      await worker.init(reopened, maxArea);
      same(masked, await exported(reopened.document), "Native filtered color source round trip");
      let maskError = "",
        selectionError = "";
      try {
        await worker.applyMask(d, maxArea, "paint");
      } catch (e) {
        maskError = e.message;
      }
      try {
        await worker.stageSelection(d, maxArea, "paint");
      } catch (e) {
        selectionError = e.message;
      }
      if (!/Disable Smart Filters/.test(maskError) || !/Smart Filters/.test(selectionError))
        throw Error("Unsafe bake/staging must explain filter limitations");
      const moved = {
        ...d,
        layers: d.layers.map((l) =>
          l.id === "paint" ? { ...l, transform: { ...l.transform, x: 8 } } : l,
        ),
      };
      await worker.init(session, maxArea);
      const movedPixels = await exported(moved);
      if (movedPixels.data.every((v, i) => v === masked.data[i]))
        throw Error("Whole-layer transform did not move filtered artwork");
      const hidden = {
          ...d,
          layers: d.layers.map((l) => (l.id === "paint" ? { ...l, visible: false } : l)),
        },
        hiddenPixels = await exported(hidden);
      if (hiddenPixels.data.some((v, i) => i % 4 === 3 && v))
        throw Error("Hidden layer leaks filter output");
      return {
        passed: true,
        filterSelectionMask: true,
        layerMask: true,
        r6BaseColorNoDoubleBake: true,
        nativeRoundTrip: true,
        r5WholeLayerTransform: true,
        selectedPixelGuard: selectionError,
        maskBakeGuard: maskError,
        visibility: true,
        pixelTolerance: 0,
      };
    } finally {
      worker.dispose();
      sourceCanvas.width = sourceCanvas.height = 1;
    }
  });
  assert.equal(result.passed, true);
  assert.deepEqual(errors, []);
  await mkdir("/workspace/r8-evidence", { recursive: true });
  await writeFile(
    "/workspace/r8-evidence/processing-browser.json",
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...result, errors }, null, 2));
} finally {
  await browser.close();
}
