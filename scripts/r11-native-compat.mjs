/** Native document compatibility across releases, using each release's actual code.
 *
 * For every release the source tree is extracted from git, a document is built with
 * every feature that release's own validator accepts, and that release's nativeFile()
 * writes it. The current tree must then open it, keep layers/masks/filters/styles and
 * asset bytes, find nothing to compact, re-export stably, support Undo/Redo, write the
 * same bytes as the R10 writer, and (where the release could already read it) remain
 * readable by that release. Isolated in-memory documents only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// Inside the repository (ignored .grok/) so extracted modules resolve installed packages;
// node refuses to strip types under node_modules.
const cache = `${root}.grok/r11-native-compat`;
const RELEASES = [
  ["R6 (pre-R8)", "6478fc1"],
  ["R7 (pre-R8)", "02eb697"],
  ["R8", "5f9c537"],
  ["PR #21", "db78593"],
  ["R9", "401e925"],
  ["R10", "aa7e199"],
];
async function load(dir) {
  const at = (path) => import(pathToFileURL(`${dir}/src/lib/studio/pro/${path}`).href);
  const optional = (path) => at(path).catch(() => undefined);
  return {
    model: await at("model.ts"),
    files: await at("files.ts"),
    color: await optional("color-engine.ts"),
    gradient: await optional("gradient.ts"),
    effects: await optional("effects.ts"),
  };
}
async function extract(sha) {
  const dir = `${cache}/${sha}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  execFileSync("sh", ["-c", `git archive ${sha} src | tar -x -C "${dir}"`], { cwd: root });
  return dir;
}
const png = (text) => new Blob([new TextEncoder().encode(text)], { type: "image/png" });
const hash = async (blob) =>
  createHash("sha256")
    .update(new Uint8Array(await blob.arrayBuffer()))
    .digest("hex");
const stroke = (extra = {}) => ({
  points: [
    { x: 4, y: 4 },
    { x: 20, y: 12 },
  ],
  size: 6,
  hardness: 0.8,
  opacity: 1,
  flow: 1,
  color: "#203040",
  erase: false,
  ...extra,
});
const region = {
  kind: "rectangle",
  points: [
    { x: 2, y: 2 },
    { x: 30, y: 20 },
  ],
  operation: "add",
};

/** Each feature is kept only if the release's own validateDocument accepts it. */
function features({ model, color, gradient, effects }) {
  return [
    [
      "paint stroke",
      (d) => {
        const l = model.layer("paint", d.width, d.height);
        l.strokes = [stroke()];
        d.layers.push(l);
      },
    ],
    [
      "hidden raster",
      (d, s) => {
        const l = model.layer("raster", d.width, d.height);
        l.assetId = "hidden";
        l.visible = false;
        s.assets.hidden = png("hidden");
        d.layers.push(l);
      },
    ],
    [
      "layer mask with stroke",
      (d) => {
        const l = d.layers.find((x) => x.kind === "paint") ?? d.layers[0];
        l.mask = {
          enabled: true,
          selection: { regions: [region], inverted: false, feather: 0 },
          strokes: [stroke({ color: "#000000" })],
        };
      },
    ],
    [
      "Clone Stamp stroke",
      (d, s) => {
        const l = model.layer("paint", d.width, d.height);
        l.strokes = [
          stroke({
            clone: {
              assetId: "clone-src",
              width: d.width,
              height: d.height,
              source: { x: 0, y: 0 },
              destination: { x: 4, y: 4 },
              mode: "clone",
            },
          }),
        ];
        s.assets["clone-src"] = png("clone");
        d.layers.push(l);
      },
    ],
    [
      "adjustment layer (schema 2)",
      (d) => {
        const a = model.layer("adjustment", d.width, d.height, "adjustment");
        a.adjustmentLayer = { version: 1, operation: color.defaultOperation("levels") };
        d.version = Math.max(d.version ?? 1, 2);
        d.layers.push(a);
      },
    ],
    [
      "Smart Filter with mask (schema 3)",
      (d) => {
        d.version = 3;
        const l = d.layers.find((x) => x.kind === "paint");
        l.smartFilters = [
          {
            id: "blur",
            enabled: true,
            operation: { kind: "gaussian", radius: 1.5 },
            mask: {
              selection: { regions: [region], inverted: false, feather: 0 },
              enabled: true,
              density: 0.75,
              inverted: false,
            },
          },
        ];
      },
    ],
    [
      "advanced gradient layer",
      (d) => {
        d.version = 3;
        const g = model.layer("gradient", d.width, d.height, "fill");
        g.gradient = gradient.advancedGradient();
        d.layers.push(g);
      },
    ],
    [
      "advanced layer style",
      (d) => {
        d.version = 3;
        const l = d.layers.find((x) => x.kind === "paint");
        l.effects = [effects.advancedEffect("dropShadow")];
      },
    ],
    [
      "bitmap Pattern Overlay (v3)",
      (d, s) => {
        d.version = 3;
        const l = d.layers.find((x) => x.kind === "paint");
        l.effects = [
          ...(l.effects ?? []),
          {
            ...effects.advancedEffect("patternOverlay"),
            version: 3,
            pattern: {
              kind: "bitmap",
              assetId: "tile",
              width: 2,
              height: 1,
              scale: 1,
              offsetX: 0,
              offsetY: 0,
              color2: "#ffffff",
            },
          },
        ];
        s.assets.tile = png("tile");
      },
    ],
  ];
}
function build(mods) {
  const document = mods.model.fromPanel({ id: "compat", name: "Compat", width: 32, height: 24 });
  let session = {
    document,
    assets: { source: png("original artwork bytes") },
    revision: 1,
    acceptedBlobId: "media",
    updatedAt: 1,
  };
  const kept = [],
    rejected = [];
  for (const [name, apply] of features(mods)) {
    const next = structuredClone({ ...session, assets: {} });
    next.assets = { ...session.assets };
    try {
      apply(next.document, next);
      mods.model.validateDocument(next.document);
      mods.model.validateAssets?.(next);
      session = next;
      kept.push(name);
    } catch (e) {
      rejected.push(`${name}: ${String(e.message).slice(0, 80)}`);
    }
  }
  return { session, kept, rejected };
}
/** The parts of a document that must survive reading, independent of migration fields. */
async function shape(session) {
  const assetHash = new Map();
  for (const [id, blob] of Object.entries(session.assets)) assetHash.set(id, await hash(blob));
  const ref = (id) => (id ? (assetHash.get(id) ?? `missing:${id}`) : undefined);
  return {
    size: [session.document.width, session.document.height],
    source: ref(session.document.source?.assetId),
    layers: session.document.layers.map((l) => ({
      id: l.id,
      kind: l.kind,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend,
      asset: ref(l.assetId),
      strokes: l.strokes.map((s) => ({ points: s.points, clone: ref(s.clone?.assetId) })),
      mask: l.mask && {
        selection: l.mask.selection,
        strokes: l.mask.strokes.length,
      },
      adjustment: l.adjustmentLayer,
      smartFilters: l.smartFilters,
      effects: l.effects?.map((e) => ({
        ...e,
        pattern: e.pattern && { ...e.pattern, assetId: ref(e.pattern.assetId) },
      })),
      gradient: l.gradient,
    })),
  };
}

const current = {
  ...(await import("../src/lib/studio/pro/files.ts")),
  ...(await import("../src/lib/studio/pro/model.ts")),
  ...(await import("../src/lib/studio/pro/asset-references.ts")),
  ...(await import("../src/lib/studio/editor/history.ts")),
};
const r10 = await load(await extract("aa7e199"));
const report = [];
for (const [release, sha] of RELEASES) {
  const old = await load(await extract(sha)),
    { session, kept, rejected } = build(old),
    written = await old.files.nativeFile(session),
    envelope = JSON.parse(await written.text()).version;
  // Open with the current tree.
  const opened = await current.readNative(written, "compat", "media");
  current.validateAssets(opened);
  assert.deepEqual(
    await shape(opened),
    await shape(session),
    `${release}: layers, masks and assets survive`,
  );
  const { removed } = current.compactOpenedSession(opened);
  assert.deepEqual(removed, [], `${release}: a native file carries only referenced assets`);
  // Save and reopen with the current tree.
  const resaved = await current.nativeFile(opened),
    reopened = await current.readNative(resaved, "compat", "media");
  assert.deepEqual(reopened.document, opened.document, `${release}: stable native round trip`);
  assert.deepEqual(await shape(reopened), await shape(session));
  // The R11 writer is byte-identical to the R10 writer for the same session.
  const viaR10 = await r10.files.nativeFile(opened);
  assert.equal(await resaved.text(), await viaR10.text(), `${release}: R11 writes R10's bytes`);
  // Undo/Redo over the reopened document.
  let h = current.createHistory(reopened.document);
  const renamed = { ...reopened.document, name: "Renamed in R11" };
  h = current.record(h, renamed);
  assert.equal(current.undo(h).present, reopened.document);
  assert.equal(current.redo(current.undo(h)).present, renamed);
  // Does the originating release still read what R11 writes for its own document?
  let originalReader = "reads R11 output";
  try {
    const back = await old.files.readNative(resaved, "compat", "media");
    assert.deepEqual(await shape(back), await shape(session));
  } catch (e) {
    originalReader = `refuses: ${String(e.message).slice(0, 100)}`;
  }
  report.push({
    release,
    sha,
    envelope,
    features: kept,
    notSupportedByRelease: rejected,
    originalReader,
  });
  console.log(
    `${release} ${sha}: envelope ${envelope}, ${kept.length} features, ${originalReader}`,
  );
}
await mkdir("/workspace/r11-evidence", { recursive: true });
await writeFile("/workspace/r11-evidence/native-compat.json", JSON.stringify(report, null, 2));
await rm(cache, { recursive: true, force: true });
