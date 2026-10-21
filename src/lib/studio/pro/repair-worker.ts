import { affine } from "./transform";
import { projectSurface } from "./transform-surface";
import { worldPoint, validateDocument, type ProDocument, type Stroke, type Layer } from "./model";
import { isLocked } from "./operations";
import { documentSources } from "./raster-budget";
import { stroke, selectionCanvas } from "./render";
import {
  findRepairDonor,
  spatialHeal,
  MAX_REPAIR_PIXELS,
  type RepairRequest,
  type RepairRect,
} from "./repair";

function repairMask(
  target: Layer,
  s: Stroke,
  width: number,
  height: number,
  origin = { x: 0, y: 0 },
) {
  const local = new OffscreenCanvas(Math.ceil(target.width), Math.ceil(target.height)),
    lc = local.getContext("2d")!;
  try {
    if (s.patch) {
      const patch = selectionCanvas(s.patch, target.width, target.height);
      lc.globalAlpha = s.flow;
      lc.drawImage(patch, 0, 0);
      lc.globalAlpha = 1;
      patch.width = patch.height = 1;
    } else stroke(lc, { ...s, opacity: 1, color: "#ffffff", erase: false });
    if (s.clip) {
      const clip = selectionCanvas(s.clip, target.width, target.height);
      lc.globalCompositeOperation = "destination-in";
      lc.drawImage(clip, 0, 0);
      clip.width = clip.height = 1;
    }
    if (target.transform.deform)
      return projectSurface(local, target.transform, width, height, 1, origin);
    const out = new OffscreenCanvas(width, height),
      ctx = out.getContext("2d")!,
      m = affine(target.transform);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - origin.x, m[5] - origin.y);
    ctx.drawImage(local, 0, 0);
    return out;
  } finally {
    local.width = local.height = 1;
  }
}
/** Prepare an immutable native-resolution donor texture. Nothing is published to
 * the session until the caller validates the returned document and PNG asset. */
export async function renderRepair(
  doc: ProDocument,
  request: RepairRequest,
  composite: OffscreenCanvas,
  get: (id: string, scale: number) => Promise<ImageBitmap>,
  maxArea: number,
) {
  const target = doc.layers.find((l) => l.id === request.layerId),
    s = request.stroke;
  if (!target || target.kind !== "paint" || isLocked(doc, target.id))
    throw new Error("Repair needs an unlocked paint layer.");
  let parent: typeof target | undefined = target;
  while (parent) {
    if (!parent.visible) throw new Error("Show the target layer and its groups before repairing.");
    parent = doc.layers.find((l) => l.id === parent?.parentId);
  }
  if (
    !["spot", "patch", "heal"].includes(request.kind) ||
    s.erase ||
    s.repair ||
    (request.kind === "patch" && !s.patch) ||
    (request.kind === "heal" && !s.clone)
  )
    throw new Error("Invalid repair request.");
  const tentative = {
    ...doc,
    layers: doc.layers.map((l) => (l.id === target.id ? { ...l, strokes: [...l.strokes, s] } : l)),
  };
  validateDocument(tentative);
  documentSources(tentative, maxArea);
  const matrix = affine(target.transform);
  const points = s.points.map((p) => worldPoint(p, target)),
    tip = s.patch
      ? s.patch.feather
      : (s.size / 2) *
        Math.max(Math.hypot(matrix[0], matrix[2]), Math.hypot(matrix[1], matrix[3])) *
        Math.max(...s.points.map((p) => p.pressure ?? 1)),
    left = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)) - tip)),
    top = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)) - tip)),
    right = Math.min(doc.width, Math.ceil(Math.max(...points.map((p) => p.x)) + tip + 1)),
    bottom = Math.min(doc.height, Math.ceil(Math.max(...points.map((p) => p.y)) + tip + 1)),
    initialBody = { x: left, y: top, width: right - left, height: bottom - top };
  let body = initialBody;
  if (target.transform.deform) {
    const full = repairMask(target, s, doc.width, doc.height);
    try {
      const data = full.getContext("2d")!.getImageData(0, 0, doc.width, doc.height).data;
      let x0 = doc.width,
        y0 = doc.height,
        x1 = 0,
        y1 = 0;
      for (let y = 0; y < doc.height; y++)
        for (let x = 0; x < doc.width; x++)
          if (data[(y * doc.width + x) * 4 + 3]) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x + 1);
            y1 = Math.max(y1, y + 1);
          }
      body = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    } finally {
      full.width = full.height = 1;
    }
  }
  if (body.width < 1 || body.height < 1) throw new Error("Draw the repair inside the artwork.");
  const radius = Math.ceil(
      Math.max(8, Math.min(64, s.patch ? Math.min(body.width, body.height) / 2 : tip * 2)),
    ),
    area: RepairRect = {
      x: Math.max(0, body.x - radius * 2 - 4),
      y: Math.max(0, body.y - radius * 2 - 4),
      width: 0,
      height: 0,
    };
  area.width = Math.min(doc.width, body.x + body.width + radius * 2 + 4) - area.x;
  area.height = Math.min(doc.height, body.y + body.height + radius * 2 + 4) - area.y;
  if (area.width * area.height > MAX_REPAIR_PIXELS)
    throw new Error(
      "Repair neighborhood exceeds one megapixel. Use smaller patches or shorter strokes.",
    );
  let offset = { x: 0, y: 0 };
  if (request.kind === "spot") {
    const image = composite.getContext("2d")!.getImageData(0, 0, doc.width, doc.height);
    offset = findRepairDonor(image.data, doc.width, doc.height, body);
  } else if (request.kind === "heal") {
    offset = { x: s.clone!.source.x - points[0]!.x, y: s.clone!.source.y - points[0]!.y };
  } else {
    if (!request.source || !Number.isFinite(request.source.x) || !Number.isFinite(request.source.y))
      throw new Error("Choose a source region for Patch Repair.");
    const first = points[0]!,
      opposite = points[2]!;
    offset = {
      x: request.source.x - (first.x + opposite.x) / 2,
      y: request.source.y - (first.y + opposite.y) / 2,
    };
  }
  const donorWidth = request.kind === "heal" ? s.clone!.width : doc.width,
    donorHeight = request.kind === "heal" ? s.clone!.height : doc.height;
  if (
    body.x + offset.x < 0 ||
    body.y + offset.y < 0 ||
    body.x + body.width + offset.x > donorWidth ||
    body.y + body.height + offset.y > donorHeight
  )
    throw new Error("The source region must fit inside the sampled artwork.");
  const mask = repairMask(target, s, area.width, area.height, area),
    mc = mask.getContext("2d")!,
    donor = new OffscreenCanvas(area.width, area.height),
    dc = donor.getContext("2d")!;
  try {
    const coverage = mc.getImageData(0, 0, area.width, area.height);
    if (!coverage.data.some((v, i) => i % 4 === 3 && v > 0))
      throw new Error("The repair does not intersect the active selection.");
    const source = request.kind === "heal" ? await get(s.clone!.assetId, 1) : composite;
    // The donor's surrounding context can itself cross the original damage.
    // Exclude those shifted pixels from tone estimates as well as target damage.
    dc.drawImage(mask, -offset.x, -offset.y);
    const donorDamage = dc.getImageData(0, 0, area.width, area.height);
    dc.clearRect(0, 0, area.width, area.height);
    dc.drawImage(source, -area.x - offset.x, -area.y - offset.y);
    const sampled = dc.getImageData(0, 0, area.width, area.height),
      targetPixels = composite
        .getContext("2d")!
        .getImageData(area.x, area.y, area.width, area.height);
    sampled.data.set(
      spatialHeal(
        sampled.data,
        targetPixels.data,
        coverage.data,
        area.width,
        area.height,
        radius,
        donorDamage.data,
      ),
    );
    dc.putImageData(sampled, 0, 0);
    const assetId = crypto.randomUUID(),
      blob = await donor.convertToBlob({ type: "image/png" }),
      repaired: Stroke = {
        ...s,
        erase: false,
        clone: {
          assetId,
          width: area.width,
          height: area.height,
          source: { x: 0, y: 0 },
          destination: { x: area.x, y: area.y },
          targetTransform: { ...target.transform },
          mode: "clone",
        },
        repair: {
          kind: request.kind,
          source: { x: points[0]!.x + offset.x, y: points[0]!.y + offset.y },
          destination: points[0]!,
          algorithm: "spatial-v1",
        },
      },
      document = {
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === target.id ? { ...l, strokes: [...l.strokes, repaired] } : l,
        ),
      };
    validateDocument(document);
    documentSources(document, maxArea);
    return { blob, assetId, document, layerId: target.id };
  } finally {
    mask.width = mask.height = donor.width = donor.height = 1;
  }
}
