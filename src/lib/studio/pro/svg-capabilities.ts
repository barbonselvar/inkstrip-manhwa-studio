/**
 * The SVG importer's element allow-list and its user-facing description, in one place.
 * svg-import.ts enforces SVG_ELEMENTS; the Assets help renders SVG_IMPORT_HELP, so the help
 * cannot drift from what the importer accepts (INK-AUD-004).
 */
export const SVG_ELEMENTS = [
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "path",
  "text",
  "title",
  "desc",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "textPath",
  "tspan",
] as const;

/** Each entry lists the elements it relies on; a unit test checks them against SVG_ELEMENTS. */
export const SVG_IMPORT_HELP = {
  supported: [
    {
      text: "paths, compound contours and basic shapes",
      elements: ["path", "rect", "circle", "ellipse", "line", "polygon", "polyline"],
    },
    { text: "groups and affine transforms", elements: ["g"] },
    { text: "uniform text and text on a path", elements: ["text", "textPath"] },
    {
      text: "local linear and radial gradients",
      elements: ["linearGradient", "radialGradient", "stop"],
    },
    { text: "local clipping paths", elements: ["clipPath"] },
    { text: "opaque (binary) masks", elements: ["mask"] },
  ],
  rejected: [
    { text: "scripts and event handlers", elements: ["script"] },
    { text: "external or embedded images and links", elements: ["image", "a", "use"] },
    { text: "style sheets, filters and patterns", elements: ["style", "filter", "pattern"] },
    { text: "soft (graded) masks and clip opacity", elements: [] },
  ],
} as const;

const list = (items: readonly { text: string }[]) =>
  items.map((item, i) => (i && i === items.length - 1 ? `and ${item.text}` : item.text)).join("; ");

export const svgImportHelp = () =>
  `SVG imports as editable layers: ${list(SVG_IMPORT_HELP.supported)}. ` +
  `Rejected with a reason: ${list(SVG_IMPORT_HELP.rejected)}.`;
