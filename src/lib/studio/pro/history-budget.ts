import type { History } from "../editor/history.ts";
/** Conservative serialized-size accounting includes shared geometry repeatedly,
 * so retained JS payload is bounded from above. Current work is never evicted.
 * Blob assets remain in the separately bounded immutable source pool. */
export function budgetHistory<T>(history: History<T>, maxBytes = 32 * 1024 * 1024): History<T> {
  const size = (entry: T) => JSON.stringify(entry).length * 2;
  let bytes = size(history.present);
  const past: T[] = [],
    future: T[] = [];
  for (let i = history.past.length - 1; i >= 0; i--) {
    bytes += size(history.past[i]!);
    if (bytes > maxBytes) break;
    past.unshift(history.past[i]!);
  }
  for (const entry of history.future) {
    bytes += size(entry);
    if (bytes > maxBytes) break;
    future.push(entry);
  }
  return past.length === history.past.length && future.length === history.future.length
    ? history
    : { ...history, past, future };
}
