export type OrderChange = { before: string[]; after: string[] };
export function sameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
export function validateOrder(current: string[], next: string[]) {
  if (
    next.length !== current.length ||
    new Set(next).size !== next.length ||
    next.some((id) => !current.includes(id))
  )
    throw new Error("Chapter images changed. Reload before reordering.");
}
export function insertPanel(ids: string[], from: string, to: string, after: boolean) {
  const next = ids.filter((id) => id !== from);
  const i = next.indexOf(to);
  if (!ids.includes(from) || i < 0 || from === to) return ids;
  next.splice(i + (after ? 1 : 0), 0, from);
  return next;
}
