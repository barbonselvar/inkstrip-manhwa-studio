import { fingerprint, type History } from "../editor/history.ts";
/** Conservative serialized-size accounting includes shared geometry repeatedly,
 * to conservatively limit older snapshots. Current work is never evicted.
 * The nearest Undo and Redo are always retained, even above the soft budget.
 * Blob assets remain in the separately bounded immutable source pool. */
export function budgetHistory<T>(history: History<T>, maxBytes = 32 * 1024 * 1024): History<T> {
  // Cached per immutable snapshot: each entry is serialized once, not on every edit.
  const size = (entry: T) => fingerprint(entry).length * 2;
  let bytes = size(history.present);
  const past: T[] = [],
    future: T[] = [];
  for (let i = history.past.length - 1; i >= 0; i--) {
    const cost = size(history.past[i]!);
    if (bytes + cost > maxBytes && past.length) break;
    bytes += cost;
    past.unshift(history.past[i]!);
  }
  for (const entry of history.future) {
    const cost = size(entry);
    if (bytes + cost > maxBytes && future.length) break;
    bytes += cost;
    future.push(entry);
  }
  return past.length === history.past.length && future.length === history.future.length
    ? history
    : { ...history, past, future };
}
