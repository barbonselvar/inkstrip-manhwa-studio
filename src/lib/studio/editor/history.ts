export type History<T> = { past: T[]; present: T; future: T[]; group?: string };
export const same = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
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
