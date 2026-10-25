import { validateOperation, type ColorOperation } from "./color-engine.ts";
export const ADJUSTMENT_KINDS = [
  "brightnessContrast",
  "levels",
  "curves",
  "hsl",
  "balance",
  "exposure",
  "vibrance",
  "blackWhite",
  "invert",
  "threshold",
  "posterize",
] as const;
export type AdjustmentOperation = Extract<
  ColorOperation,
  { kind: (typeof ADJUSTMENT_KINDS)[number] }
>;
export type AdjustmentLayerSettings = {
  version: 1;
  operation: AdjustmentOperation;
  preset?: { name: string };
};
export function isAdjustmentOperation(a: ColorOperation): a is AdjustmentOperation {
  return (ADJUSTMENT_KINDS as readonly string[]).includes(a.kind);
}
function keys(v: unknown, allowed: string[], required: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Object.keys(v).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(v, k))
  )
    throw Error("Invalid adjustment-layer record.");
}
export function validateAdjustmentLayer(a: unknown): asserts a is AdjustmentLayerSettings {
  keys(a, ["version", "operation", "preset"], ["version", "operation"]);
  const v = a as AdjustmentLayerSettings;
  if (v.version !== 1)
    throw Error("Unsupported adjustment-layer settings version. Nothing was changed.");
  validateOperation(v.operation);
  if (!isAdjustmentOperation(v.operation))
    throw Error("This adjustment type cannot be persisted as a color adjustment layer.");
  if (v.preset !== undefined) {
    keys(v.preset, ["name"], ["name"]);
    if (
      typeof v.preset.name !== "string" ||
      !v.preset.name.trim() ||
      v.preset.name.length > 80 ||
      [...v.preset.name].some((c) => c.charCodeAt(0) < 32)
    )
      throw Error("Invalid adjustment preset metadata.");
  }
}
/** Bounded trust boundary for untrusted JSON and canonical serialization. */
export function validateNativeTree(v: unknown) {
  let nodes = 0;
  const walk = (value: unknown, depth: number) => {
    if (++nodes > 4_000_000 || depth > 48)
      throw Error("Native metadata exceeds its structural budget.");
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value.length > 4_000_000 - nodes)
        throw Error("Native metadata exceeds its structural budget.");
      for (const item of value) walk(item, depth + 1);
    } else
      for (const k of Object.keys(value)) {
        if (["__proto__", "prototype", "constructor"].includes(k))
          throw Error("Unsafe native metadata key.");
        walk((value as Record<string, unknown>)[k], depth + 1);
      }
  };
  walk(v, 0);
}
export function canonicalNative(value: unknown) {
  validateNativeTree(value);
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
