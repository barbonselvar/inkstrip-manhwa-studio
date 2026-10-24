// R1 source inventory, not a claim that every conditional control is visible/tested.
// Run from repository root: node docs/raster-completion/generate-control-inventory.mjs
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";

const files = [
  "pro-workspace",
  "pro-canvas",
  "pro-properties",
  "pro-layers",
  "pro-refine",
  "pro-transform",
  "pro-geometry",
  "pro-color",
  "pro-appearance",
  "pro-anchors",
  "pro-inspector-tabs",
];
const controls = [];
const compact = (value) => value.replace(/\s+/g, " ").trim();
for (const name of files) {
  const path = `src/components/studio/pro/${name}.tsx`;
  const source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      if (
        [
          "Button",
          "button",
          "input",
          "select",
          "textarea",
          "ProNumber",
          "DropdownMenu.Item",
          "AlertDialog.Action",
          "AlertDialog.Cancel",
        ].includes(tag)
      ) {
        const attributes = Object.fromEntries(
          node.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((item) => [
              item.name.getText(ast),
              compact(item.initializer?.getText(ast) ?? "true"),
            ]),
        );
        const handlers = Object.fromEntries(
          Object.entries(attributes).filter(([key]) => /^on[A-Z]/.test(key)),
        );
        const children = ts.isJsxOpeningElement(node) ? node.parent.children : [];
        const label = compact(
          children
            .filter(ts.isJsxText)
            .map((child) => child.text)
            .join(" "),
        );
        const sections = [];
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (
            ts.isJsxElement(parent) &&
            parent.openingElement.tagName.getText(ast) === "ToolSection"
          ) {
            const title = parent.openingElement.attributes.properties.find(
              (item) => ts.isJsxAttribute(item) && item.name.getText(ast) === "title",
            );
            if (title) sections.unshift(compact(title.initializer?.getText(ast) ?? ""));
          }
        }
        controls.push({
          path,
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          tag,
          label:
            attributes["aria-label"] ??
            attributes.label ??
            (label || attributes.title || "dynamic/structural; inspect source"),
          sections,
          handlers,
          disabled: attributes.disabled ?? null,
          value: attributes.value ?? attributes.checked ?? null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
writeFileSync(
  "docs/raster-completion/CONTROL_INVENTORY.json",
  `${JSON.stringify(
    {
      schema: 1,
      baseSha: "a90c656c8b68cb2016a7a1cd09e720ef3ed145ab",
      sourceSha: "9ac54645643ae01b297ad1de00c4d28b590b07e5",
      scope:
        "JSX definitions on Raster-accessible shared surfaces. Map-generated controls are templates; mode/selection gates still apply. View controls need no document mutation. Empty local handlers can belong to Radix triggers/actions; inspect enclosing components. This is source evidence, not per-control interaction coverage.",
      controls,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Inventoried ${controls.length} JSX control definitions across ${files.length} shared surfaces.`,
);
