import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { decode as decodePng } from "fast-png";
import { decodeRaster, encodePng, lzwLength, orient, type Raster } from "./convert/core.ts";
import { planStrip } from "./plan.ts";
import { importIssue, importSummary } from "./import-report.ts";
import { constrainedDevice, imagePolicy, preflightImage } from "./image-policy.ts";

const require = createRequire(import.meta.url);
const fixture = (name: string) => readFile(new URL(`./fixtures/import/${name}`, import.meta.url));
const blob = async (name: string, type = "") => new Blob([await fixture(name)], { type });

/** RGBA samples of the reference fixture, decoded by an independent PNG decoder. */
async function reference() {
  const png = decodePng(await fixture("original.png"));
  const rgba = new Uint8Array(png.width * png.height * 4);
  for (let i = 0, j = 0; i < png.width * png.height; i++, j += png.channels) {
    rgba.set([png.data[j]!, png.data[j + 1]!, png.data[j + 2]!, 255], i * 4);
  }
  return { width: png.width, height: png.height, rgba };
}
const rgba = (r: Raster) => Uint8Array.from(r.data as ArrayLike<number>);

test("TIFF (LZW) decodes to exactly the reference pixels", async () => {
  const ref = await reference(),
    raster = await decodeRaster("tiff", await fixture("lzw.tiff"));
  assert.deepEqual([raster.width, raster.height], [ref.width, ref.height]);
  assert.deepEqual(rgba(raster), ref.rgba);
});

test("TIFF alpha, orientation, 16-bit and multi-page inputs are handled and reported", async () => {
  const alpha = await decodeRaster("tiff", await fixture("alpha.tiff"));
  assert.deepEqual([...rgba(alpha).subarray(0, 8)], [10, 20, 30, 128, 200, 100, 50, 0]);
  const ref = await reference(),
    rotated = await decodeRaster("tiff", await fixture("rotated.tiff"));
  // Orientation 6: stored 32×24, displayed 24×32; stored (0,0) lands at displayed (23,0).
  assert.deepEqual([rotated.width, rotated.height], [24, 32]);
  assert.deepEqual([...rgba(rotated).subarray(23 * 4, 23 * 4 + 4)], [...ref.rgba.subarray(0, 4)]);
  const deep = await decodeRaster("tiff", await fixture("gray16.tiff"));
  assert.ok(deep.notes.some((n) => /16-bit/.test(n)));
  const pages = await decodeRaster("tiff", await fixture("multipage.tiff"));
  assert.ok(pages.notes.some((n) => /first TIFF page/.test(n)));
  assert.deepEqual(rgba(pages), ref.rgba);
});

/** original.tiff (uncompressed RGB) with its Compression tag rewritten. */
async function recompressed(code: number) {
  const b = new Uint8Array(await fixture("original.tiff")),
    v = new DataView(b.buffer, b.byteOffset, b.byteLength),
    ifd = v.getUint32(4, true);
  for (let i = 0; i < v.getUint16(ifd, true); i++)
    if (v.getUint16(ifd + 2 + i * 12, true) === 259) v.setUint16(ifd + 10 + i * 12, code, true);
  return b;
}

test("corrupted TIFF data is rejected instead of importing garbage pixels", async () => {
  // utif2 would "decode" each of these without error into wrong pixels.
  await assert.rejects(decodeRaster("tiff", await recompressed(5)), /invalid LZW stream/);
  await assert.rejects(decodeRaster("tiff", await recompressed(3)), /non-bilevel/);
  const whole = new Uint8Array(await fixture("original.tiff"));
  await assert.rejects(decodeRaster("tiff", whole.subarray(0, whole.length - 400)), /corrupted/);
  // Clear, "A", EOI as 9-bit MSB-first codes decodes to exactly one byte; a stream that
  // does not start with Clear is invalid.
  assert.equal(lzwLength(Uint8Array.of(128, 16, 96, 32)), 1);
  assert.equal(lzwLength(Uint8Array.of(0, 0, 0)), undefined);
});

test("JPEG XL (lossless) decodes to exactly the reference pixels", async () => {
  const { init } = await import("@jsquash/jxl/decode.js");
  const wasm = await readFile(require.resolve("@jsquash/jxl/codec/dec/jxl_dec.wasm"));
  await init(await WebAssembly.compile(wasm));
  const ref = await reference(),
    raster = await decodeRaster("jxl", await fixture("original.jxl"));
  assert.deepEqual([raster.width, raster.height], [32, 24]);
  assert.deepEqual(rgba(raster), ref.rgba);
});

test("HEIC decodes at its native size (lossy source, close to the reference)", async () => {
  const ref = await reference(),
    raster = await decodeRaster("heic", await fixture("original.heic"), {
      heif: async () => (await import("libheif-js/libheif-wasm/libheif-bundle.mjs")).default,
    });
  assert.deepEqual([raster.width, raster.height], [32, 24]);
  // HEIC is lossy with 4:2:0 chroma: the fixture's single changed pixel is smeared, so
  // compare the mean error (an independent pillow-heif decode differs by at most 2 levels).
  const px = rgba(raster);
  let sum = 0;
  for (let i = 0; i < px.length; i++) sum += Math.abs(px[i]! - ref.rgba[i]!);
  assert.ok(sum / px.length <= 1, `HEIC mean deviation ${sum / px.length}`);
  assert.ok(px.every((v, i) => i % 4 !== 3 || v === 255));
});

test("PNG encoding is lossless, exact-length and keeps alpha only when needed", async () => {
  const alpha = await decodeRaster("tiff", await fixture("alpha.tiff")),
    png = encodePng(alpha),
    back = decodePng(png);
  assert.equal(png.byteOffset, 0);
  assert.equal(png.byteLength, png.buffer.byteLength);
  assert.equal(back.channels, 4);
  assert.deepEqual(Uint8Array.from(back.data), rgba(alpha));
  const opaque = decodePng(encodePng(await decodeRaster("tiff", await fixture("lzw.tiff"))));
  assert.equal(opaque.channels, 3);
  // The stored PNG passes the app's own strict PNG validator (exact IEND termination).
  const info = await preflightImage(
    new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }),
  );
  assert.deepEqual([info.width, info.height, info.mime], [32, 24, "image/png"]);
});

test("orientation transform covers all eight EXIF orientations", () => {
  const src: Raster = {
    width: 2,
    height: 1,
    data: Uint8ClampedArray.from([1, 1, 1, 255, 2, 2, 2, 255]),
    channels: 4,
    depth: 8,
    notes: [],
  };
  const first = (o: number) => {
    const r = orient(src, o);
    return [r.width, r.height, ...[...r.data].filter((_, i) => i % 4 === 0)];
  };
  assert.deepEqual(first(1), [2, 1, 1, 2]);
  assert.deepEqual(first(2), [2, 1, 2, 1]);
  assert.deepEqual(first(3), [2, 1, 2, 1]);
  assert.deepEqual(first(4), [2, 1, 1, 2]);
  assert.deepEqual(first(5), [1, 2, 1, 2]);
  assert.deepEqual(first(6), [1, 2, 1, 2]);
  assert.deepEqual(first(7), [1, 2, 2, 1]);
  assert.deepEqual(first(8), [1, 2, 2, 1]);
});

test("JPEG XL and converted formats pass header preflight with real dimensions", async () => {
  const jxl = await preflightImage(await blob("original.jxl"));
  assert.deepEqual([jxl.type, jxl.mime, jxl.width, jxl.height], ["jxl", "image/jxl", 32, 24]);
  // The HEIC stores a 64×64 coded plane cropped (clap) to 32×24: the primary item's
  // displayed size is what decoders output, not the coded or library-guessed size.
  const heic = await preflightImage(await blob("original.heic"));
  assert.deepEqual([heic.type, heic.width, heic.height], ["heic", 32, 24]);
  const avif = await preflightImage(await blob("original.avif"));
  assert.deepEqual([avif.width, avif.height], [32, 24]);
});

test("memory-aware tier: reported memory decides; touch alone only when memory is unknown", () => {
  assert.equal(constrainedDevice(8, true), false); // e.g. Samsung flagship, Chrome
  assert.equal(constrainedDevice(4, true), false); // 4–7.9 GiB phones
  assert.equal(constrainedDevice(2, true), true);
  assert.equal(constrainedDevice(2, false), true);
  assert.equal(constrainedDevice(undefined, true), true); // Safari/Firefox touch devices
  assert.equal(constrainedDevice(undefined, false), false);
  // The two budgets themselves are unchanged.
  assert.equal(imagePolicy().maxPixels, 32_000_000);
  assert.equal(imagePolicy(true).maxPixels, 16_000_000);
});

const desktop = { maxSide: 16384, maxArea: 32_000_000 },
  touch = { maxSide: 8192, maxArea: 16_000_000 };

test("plan: zero, one and several images", () => {
  assert.deepEqual(planStrip([], 800, 0, desktop).parts, []);
  const one = planStrip([{ id: "a", sw: 1600, sh: 1200 }], 800, 24, desktop);
  assert.equal(one.parts.length, 1);
  assert.equal(one.totalHeight, 600);
  assert.deepEqual(one.parts[0]!.panels, [
    { id: "a", drawW: 800, drawH: 600, x: 0, y: 0, srcY: 0, fullH: 600 },
  ]);
  const three = planStrip(
    ["a", "b", "c"].map((id) => ({ id, sw: 800, sh: 1000 })),
    800,
    20,
    desktop,
  );
  assert.equal(three.parts.length, 1);
  assert.deepEqual(
    three.parts[0]!.panels.map((p) => [p.id, p.y]),
    [
      ["a", 0],
      ["b", 1020],
      ["c", 2040],
    ],
  );
  assert.equal(three.totalHeight, 3040);
});

test("plan: a long vertical image keeps full width and continues across parts", () => {
  const plan = planStrip([{ id: "tall", sw: 1080, sh: 20000 }], 800, 0, touch);
  assert.equal(plan.width, 800);
  const segments = plan.parts.flatMap((p) => p.panels);
  assert.ok(plan.parts.length >= 2);
  assert.ok(plan.parts.every((p) => p.height <= touch.maxSide && p.height * 800 <= touch.maxArea));
  assert.ok(segments.every((s) => s.drawW === 800 && s.fullH === 14815));
  // Segments tile the scaled panel exactly, with no gap or overlap.
  let next = 0;
  for (const s of segments) {
    assert.equal(s.srcY, next);
    next += s.drawH;
  }
  assert.equal(next, 14815);
  assert.equal(plan.totalHeight, 14815);
});

test("plan: whole panels move to the next part and the seam is kept across the break", () => {
  const frames = [
    { id: "a", sw: 800, sh: 6000 },
    { id: "b", sw: 800, sh: 4000 },
  ];
  const plan = planStrip(frames, 800, 30, touch);
  assert.equal(plan.parts.length, 2);
  assert.deepEqual(
    plan.parts.map((p) => p.panels.map((s) => [s.id, s.y, s.drawH])),
    [[["a", 0, 6000]], [["b", 30, 4000]]],
  );
  assert.equal(plan.totalHeight, 6000 + 30 + 4000);
});

test("import issues are specific and classified", () => {
  const cases: [unknown, string][] = [
    [new DOMException("x", "NotReadableError"), "access"],
    [new DOMException("x", "QuotaExceededError"), "storage"],
    [
      Error("This encoded image format is not supported. Export PNG/JPEG/WebP first."),
      "unsupported",
    ],
    [Error("Truncated JPEG termination. Image was not decoded or imported."), "corrupted"],
    [Error("Image exceeds the 16 megapixel device budget (21.6 MP)."), "dimensions"],
    [Error("Image file exceeds the 40MiB encoded-file budget or is empty."), "too-large"],
    [Error("TIFF conversion failed: bad strip"), "conversion"],
    [Error("This browser could not decode the validated image."), "decode"],
  ];
  for (const [error, kind] of cases)
    assert.equal(importIssue("f.png", error).kind, kind, String(error));
  assert.doesNotMatch(
    importIssue("a", Error("Truncated JPEG termination. Image was not decoded or imported."))
      .reason,
    /was not decoded or imported/,
  );
  assert.equal(importSummary(2, [], 1), "Added 2 photos. 1 converted to lossless PNG.");
  assert.match(
    importSummary(1, [importIssue("x.heic", Error("bad")), importIssue("y", Error("bad"))], 0),
    /Added 1 photo\. 2 files were not imported/,
  );
});

test("LGPL-3.0 libheif stays a separate, unmodified, replaceable file with notices and source", async () => {
  const { createHash } = await import("node:crypto");
  const read = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url));
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  // Our code never bundles the Library: the worker only takes its URL, the core takes a loader.
  const worker = (await read("src/lib/studio/convert/worker.ts")).toString(),
    core = (await read("src/lib/studio/convert/core.ts")).toString();
  assert.doesNotMatch(core, /(from|import\()\s*["']libheif-js/);
  assert.deepEqual(
    [...worker.matchAll(/(?:from|import\()\s*["']([^"']*libheif-js[^"']*)["']/g)].map((m) => m[1]),
    ["../../../../node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs?url"],
  );
  // The notices name the exact shipped file, versions and hosted Corresponding Source.
  const notices = (await read("public/licenses/THIRD-PARTY-NOTICES.txt")).toString(),
    pkg = JSON.parse((await read("node_modules/libheif-js/package.json")).toString());
  assert.match(notices, new RegExp(`libheif-js ${pkg.version.replace(/\./g, "\\.")}`));
  assert.ok(
    notices.includes(sha(await read("node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs"))),
  );
  for (const tarball of ["libheif-1.23.5.tar.gz", "libde265-1.0.15.tar.gz"])
    assert.ok(notices.includes(sha(await read(`public/licenses/source/${tarball}`))), tarball);
  // Versions compiled into the shipped WebAssembly match the hosted source.
  const wasm = (await read("node_modules/libheif-js/libheif-wasm/libheif.wasm")).toString("latin1");
  assert.ok(wasm.includes("1.23.5") && wasm.includes("1.0.15"));
  for (const text of [
    "LGPL-3.0.txt",
    "GPL-3.0.txt",
    "libheif-LGPL-3.0.txt",
    "libde265-LGPL-3.0.txt",
  ])
    assert.match(
      (await read(`public/licenses/${text}`)).toString(),
      /GENERAL PUBLIC LICENSE|Lesser General Public License/,
    );
});
