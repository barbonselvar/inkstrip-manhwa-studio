export type History<T> = { past: T[]; present: T; future: T[]; group?: string };
/** Exact `JSON.stringify(value)` length and a 32-bit hash of its token structure. */
export type Fingerprint = { length: number; hash: number };
// History snapshots are immutable and share unchanged sub-objects (layers, strokes),
// so fingerprints are composed from cached child fingerprints: a new snapshot only
// hashes the objects that changed. Only numbers are retained, never JSON text.
const prints = new WeakMap<object, Fingerprint>();
const OFFSET = 0x811c9dc5;
const mix = (hash: number, n: number) => Math.imul(hash ^ n, 0x01000193) >>> 0;
function hashText(text: string, hash = OFFSET) {
  for (let i = 0; i < text.length; i++) hash = mix(hash, text.charCodeAt(i));
  return hash;
}
const leaf = (text: string, tag: number): Fingerprint => ({
  length: text.length,
  hash: hashText(text, mix(OFFSET, tag)),
});
const NULL = leaf("null", 1),
  TRUE = leaf("true", 3),
  FALSE = leaf("false", 3);
const keys = new Map<string, Fingerprint>();
function keyPrint(key: string) {
  let cached = keys.get(key);
  if (!cached) {
    cached = leaf(JSON.stringify(key), 7);
    if (keys.size < 4096) keys.set(key, cached);
  }
  return cached;
}
const isPlain = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return Array.isArray(value) || proto === Object.prototype || proto === null;
};
/** Follows JSON.stringify: equal JSON text always yields an equal fingerprint. Returns
 * undefined where JSON omits the value (undefined, functions, symbols). */
function print(value: unknown): Fingerprint | undefined {
  switch (typeof value) {
    case "string":
      return leaf(JSON.stringify(value), 2);
    case "number":
      // Same text as JSON.stringify: String(-0) is "0"; non-finite numbers become null.
      return leaf(Number.isFinite(value) ? String(value) : "null", 3);
    case "boolean":
      return value ? TRUE : FALSE;
    case "bigint":
      return leaf(JSON.stringify(value), 3); // throws, exactly like JSON.stringify
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }
  if (value === null) return NULL;
  const object = value as Record<string, unknown>;
  const cached = prints.get(object);
  if (cached) return cached;
  // toJSON, class instances and typed arrays keep JSON's exact semantics via text.
  if (typeof object.toJSON === "function" || !isPlain(object)) {
    const text = JSON.stringify(object);
    return text === undefined ? undefined : leaf(text, 4);
  }
  let length = 2,
    items = 0,
    nested = false;
  let hash = mix(OFFSET, Array.isArray(object) ? 5 : 6);
  if (Array.isArray(object)) {
    for (const item of object) {
      const child = print(item) ?? NULL;
      nested ||= typeof item === "object" && item !== null;
      length += child.length + (items++ ? 1 : 0);
      hash = mix(mix(hash, child.hash), child.length);
    }
  } else {
    for (const key of Object.keys(object)) {
      const child = print(object[key]);
      if (!child) continue;
      nested ||= typeof object[key] === "object" && object[key] !== null;
      const name = keyPrint(key);
      length += name.length + 1 + child.length + (items++ ? 1 : 0);
      hash = mix(mix(mix(hash, name.hash), child.hash), child.length);
    }
  }
  const result = { length, hash };
  // Leaves (e.g. stroke points) are hashed only through their parent; skip caching them.
  if (nested || Array.isArray(object)) prints.set(object, result);
  return result;
}
export function fingerprint(value: unknown): Fingerprint {
  return print(value) ?? { length: 0, hash: OFFSET };
}
/** Structural equality by serialized form. Different fingerprints prove a difference;
 * equal fingerprints are always confirmed by the full comparison, so a hash collision
 * can never hide a change. A stale fingerprint can only cause an extra entry or save. */
export function same<T>(a: T, b: T) {
  if (Object.is(a, b)) return true;
  const x = fingerprint(a),
    y = fingerprint(b);
  if (x.length !== y.length || x.hash !== y.hash) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
export function createHistory<T>(value: T): History<T> {
  return { past: [], present: value, future: [] };
}
export function record<T>(state: History<T>, next: T, group?: string): History<T> {
  if (same(state.present, next)) return state;
  return {
    past: group && group === state.group ? state.past : [...state.past, state.present].slice(-50),
    present: next,
    future: [],
    group,
  };
}
export function undo<T>(state: History<T>): History<T> {
  const previous = state.past.at(-1);
  return previous === undefined
    ? state
    : {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, 50),
      };
}
export function redo<T>(state: History<T>): History<T> {
  const next = state.future[0];
  return next === undefined
    ? state
    : {
        past: [...state.past, state.present].slice(-50),
        present: next,
        future: state.future.slice(1),
      };
}
