/**
 * Image picker state. Pure and DOM-free so selection, ordering, duplicate and
 * validation rules are unit-tested without a browser. The picker only ever
 * holds files the user explicitly chose (system picker, drop or paste); it never
 * enumerates device albums.
 */

export type PickerMode = "single" | "multiple";
export type PickerSource = "photos" | "files" | "folder" | "drop" | "paste" | "recent";

export type PickerStatus = "checking" | "ready" | "invalid";

export type PickerItem = {
  id: string;
  file: File;
  key: string;
  batchId: string;
  status: PickerStatus;
  reason?: string;
  note?: string;
  width?: number;
  height?: number;
  /** `document` items (native .inkstrip) are valid but have no image thumbnail. */
  kind: "image" | "document";
};

export type PickerBatch = {
  id: string;
  source: PickerSource;
  label: string;
  at: number;
};

export type PickerState = {
  mode: PickerMode;
  maxFiles: number;
  items: PickerItem[];
  batches: PickerBatch[];
  /** Item ids in import order. */
  selected: string[];
  /** Last user-facing notice (duplicates skipped, limits reached, …). */
  notice: string | null;
};

export type PickerAction =
  | {
      type: "add";
      files: File[];
      source: PickerSource;
      batchId: string;
      label: string;
      at: number;
      ids: string[];
      accept?: string;
      select?: boolean;
    }
  | { type: "toggle"; id: string }
  | { type: "select"; ids: string[] }
  | { type: "deselect"; id: string }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "move"; id: string; delta: number }
  | { type: "sortByName" }
  | {
      type: "validated";
      id: string;
      ok: boolean;
      reason?: string;
      note?: string;
      width?: number;
      height?: number;
      kind?: PickerItem["kind"];
    }
  | { type: "notice"; notice: string | null }
  | { type: "reset" };

export function createPickerState(mode: PickerMode, maxFiles = 250): PickerState {
  return { mode, maxFiles, items: [], batches: [], selected: [], notice: null };
}

/** Identity for duplicate detection: the same file chosen twice from any source.
 * `lastModified` is left out because mobile photo pickers stamp copies with the
 * time they were picked. */
export function fileKey(file: Pick<File, "name" | "size" | "type">) {
  return `${file.name}\u0000${file.size}\u0000${file.type}`;
}

/** Mirrors the browser's `accept` matching: MIME types, `type/*` wildcards and extensions. */
export function acceptsFile(file: Pick<File, "name" | "type">, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase(),
    type = file.type.toLowerCase();
  return accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token.startsWith(".")) return name.endsWith(token);
      if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
      return type === token;
    });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Natural order, so `page2.png` precedes `page10.png`. */
export function compareNames(a: string, b: string) {
  return collator.compare(a, b);
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  switch (action.type) {
    case "add": {
      const known = new Set(state.items.map((item) => item.key));
      const added: PickerItem[] = [];
      let duplicates = 0,
        unsupported = 0,
        overflow = 0;
      action.files.forEach((file, index) => {
        const key = fileKey(file);
        if (known.has(key)) {
          duplicates++;
          return;
        }
        if (!acceptsFile(file, action.accept)) {
          unsupported++;
          return;
        }
        if (state.items.length + added.length >= state.maxFiles) {
          overflow++;
          return;
        }
        known.add(key);
        added.push({
          id: action.ids[index] ?? `${action.batchId}-${index}`,
          file,
          key,
          batchId: action.batchId,
          status: "checking",
          kind: "image",
        });
      });
      const notices: string[] = [];
      if (duplicates) notices.push(`${plural(duplicates, "duplicate")} skipped`);
      if (unsupported) notices.push(`${plural(unsupported, "file")} not supported here`);
      if (overflow) notices.push(`limit of ${state.maxFiles} images reached`);
      let next: PickerState = {
        ...state,
        items: [...state.items, ...added],
        batches: added.length
          ? [
              ...state.batches,
              { id: action.batchId, source: action.source, label: action.label, at: action.at },
            ]
          : state.batches,
        notice: notices.length ? capitalize(notices.join(" · ")) + "." : null,
      };
      if (action.select !== false && added.length) {
        // Single mode selects the first new file; multiple appends in chosen order.
        next = pickerReducer(next, {
          type: "select",
          ids: state.mode === "single" ? [added[0]!.id] : added.map((item) => item.id),
        });
        next.notice = notices.length ? capitalize(notices.join(" · ")) + "." : null;
      }
      return next;
    }
    case "toggle":
      return state.selected.includes(action.id)
        ? pickerReducer(state, { type: "deselect", id: action.id })
        : pickerReducer(state, { type: "select", ids: [action.id] });
    case "select": {
      const selectable = action.ids.filter((id) => {
        const item = state.items.find((entry) => entry.id === id);
        return item && item.status !== "invalid";
      });
      if (!selectable.length) {
        const blocked = action.ids.some((id) =>
          state.items.some((item) => item.id === id && item.status === "invalid"),
        );
        return blocked ? { ...state, notice: "That file can't be imported." } : state;
      }
      if (state.mode === "single")
        return { ...state, selected: [selectable.at(-1)!], notice: null };
      const selected = [...state.selected];
      for (const id of selectable) if (!selected.includes(id)) selected.push(id);
      return { ...state, selected, notice: null };
    }
    case "deselect":
      return { ...state, selected: state.selected.filter((id) => id !== action.id) };
    case "remove": {
      const items = state.items.filter((item) => item.id !== action.id);
      const batchIds = new Set(items.map((item) => item.batchId));
      return {
        ...state,
        items,
        batches: state.batches.filter((batch) => batchIds.has(batch.id)),
        selected: state.selected.filter((id) => id !== action.id),
      };
    }
    case "clear":
      return { ...state, selected: [], notice: null };
    case "move": {
      const from = state.selected.indexOf(action.id);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(state.selected.length - 1, from + action.delta));
      if (to === from) return state;
      const selected = [...state.selected];
      selected.splice(to, 0, ...selected.splice(from, 1));
      return { ...state, selected };
    }
    case "sortByName": {
      const byId = new Map(state.items.map((item) => [item.id, item]));
      const selected = [...state.selected].sort(
        (a, b) =>
          compareNames(byId.get(a)!.file.name, byId.get(b)!.file.name) ||
          state.selected.indexOf(a) - state.selected.indexOf(b),
      );
      return { ...state, selected };
    }
    case "validated": {
      let found = false;
      const items = state.items.map((item) => {
        if (item.id !== action.id) return item;
        found = true;
        return {
          ...item,
          status: action.ok ? ("ready" as const) : ("invalid" as const),
          reason: action.ok ? undefined : action.reason,
          note: action.note,
          width: action.width,
          height: action.height,
          kind: action.kind ?? item.kind,
        };
      });
      if (!found) return state;
      // A file that fails validation can never stay selected for import.
      return {
        ...state,
        items,
        selected: action.ok ? state.selected : state.selected.filter((id) => id !== action.id),
      };
    }
    case "notice":
      return { ...state, notice: action.notice };
    case "reset":
      return createPickerState(state.mode, state.maxFiles);
  }
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Files to import, in the user's selection order. Invalid or pending files are excluded. */
export function selectedFiles(state: PickerState) {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  return state.selected
    .map((id) => byId.get(id))
    .filter((item): item is PickerItem => !!item && item.status === "ready")
    .map((item) => item.file);
}

/** Import is allowed once every selected file has finished validating. */
export function canConfirm(state: PickerState) {
  if (!state.selected.length) return false;
  const byId = new Map(state.items.map((item) => [item.id, item]));
  return state.selected.every((id) => byId.get(id)?.status === "ready");
}

/** Roving-focus movement through a grid of `count` cells laid out in `columns`. */
export function gridMove(index: number, key: string, columns: number, count: number) {
  if (count <= 0) return -1;
  const cols = Math.max(1, columns);
  const next =
    key === "ArrowRight"
      ? index + 1
      : key === "ArrowLeft"
        ? index - 1
        : key === "ArrowDown"
          ? index + cols
          : key === "ArrowUp"
            ? index - cols
            : key === "Home"
              ? 0
              : key === "End"
                ? count - 1
                : index;
  return Math.max(0, Math.min(count - 1, next));
}

/** Recently chosen files, kept in memory for this tab only (never persisted). */
const RECENT_LIMIT = 48;
let recent: File[] = [];
export function recentFiles() {
  return recent;
}
export function rememberRecent(files: File[]) {
  const keys = new Set(files.map(fileKey));
  recent = [...files, ...recent.filter((file) => !keys.has(fileKey(file)))].slice(0, RECENT_LIMIT);
}
export function clearRecent() {
  recent = [];
}
