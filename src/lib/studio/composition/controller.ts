import { createStore, type StoreApi } from "zustand/vanilla";
import { createHistory, record, undo, redo, type History } from "../editor/history";
import { useStudio } from "../store";
import type { Chapter, Panel } from "../types";
import {
  createComposition,
  orderedPanels,
  readComposition,
  reconcile,
  type CompositionDocument,
  type CompositionObject,
  type Fade,
  type Space,
  type Transition,
} from "./model";
import { saveComposition } from "./storage";
export type Frame = { document: CompositionDocument; order: string[] };
export type Selection =
  | { kind: "panel"; id: string }
  | { kind: "space"; id: string; slot: "top" | "bottom" | "after" | "opening" | "ending" }
  | { kind: "object"; id: string }
  | { kind: "fade"; id: string; panelId: string }
  | { kind: "transition"; id: string }
  | null;
export type Session = {
  history: History<Frame>;
  selection: Selection;
  selectedPanels: string[];
  focus: string | null;
  status: "saved" | "unsaved" | "saving" | "error";
  error: string | null;
  blocked: boolean;
  schemaUnavailable: boolean;
  revision: number;
  expectedOrder: string[];
  generation: number;
  zoom: number;
  before: boolean;
  preview: boolean;
  tool: string;
  mobileProperties: boolean;
  drawBoundary?: boolean;
};
export type Controller = StoreApi<Session> & {
  change: (fn: (d: CompositionDocument) => CompositionDocument, group?: string) => void;
  reorder: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  flush: () => Promise<void>;
  select: (s: Selection) => void;
  synchronize: (chapter: Chapter, panels: Panel[]) => void;
};
const controllers = new Map<string, Controller>();
let guardsInstalled = false;
function installSaveGuards() {
  if (guardsInstalled || typeof window === "undefined") return;
  guardsInstalled = true;
  const pending = () =>
    [...controllers.entries()].filter(
      ([id, c]) =>
        useStudio.getState().chapters.some((chapter) => chapter.id === id) &&
        c.getState().status !== "saved",
    );
  window.addEventListener("beforeunload", (event) => {
    if (pending().length) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden")
      for (const [, c] of pending())
        void c
          .flush()
          .catch(() =>
            useStudio.setState({
              banner:
                "Composition changes could not be saved. Return to Composition & FX and export recovery before leaving.",
            }),
          );
  });
}
export let clipboard: Space | Fade | CompositionObject | Transition | undefined;
export const copySettings = (value: NonNullable<typeof clipboard>) => {
  clipboard = structuredClone(value);
};
export function getController(chapter: Chapter, panels: Panel[]): Controller {
  installSaveGuards();
  const existing = controllers.get(chapter.id);
  if (existing) return existing;
  const read = chapter.composition === undefined ? null : readComposition(chapter.composition);
  const document = read?.record?.document ?? createComposition(chapter, panels),
    order = orderedPanels(panels).map((p) => p.id);
  const store = createStore<Session>(() => ({
    history: createHistory({ document: reconcile(document, panels), order }),
    selection: null,
    selectedPanels: [],
    focus: null,
    status: "saved",
    error: read?.error ?? null,
    blocked: !!read?.error,
    schemaUnavailable: !!read?.error,
    revision: read?.record?.revision ?? 0,
    expectedOrder: order,
    generation: 0,
    zoom: 1,
    before: false,
    preview: false,
    tool: "Panels",
    mobileProperties: false,
  }));
  let timer: ReturnType<typeof setTimeout> | undefined, running: Promise<void> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void controller.flush().catch(() => {}), 650);
  };
  const commit = (history: History<Frame>) => {
    if (store.getState().blocked) return;
    store.setState((s) => ({
      history,
      status: "unsaved",
      error: null,
      generation: s.generation + 1,
    }));
    schedule();
  };
  const controller: Controller = Object.assign(store, {
    change: (fn: (d: CompositionDocument) => CompositionDocument, group?: string) => {
      const s = store.getState();
      if (s.blocked) return;
      const next = fn(s.history.present.document);
      if (next === s.history.present.document) return;
      commit(record(s.history, { ...s.history.present, document: next }, group));
    },
    reorder: (ids: string[]) => {
      const s = store.getState();
      commit(record(s.history, { ...s.history.present, order: ids }));
    },
    undo: () => {
      const s = store.getState();
      if (s.history.past.length) commit(undo(s.history));
    },
    redo: () => {
      const s = store.getState();
      if (s.history.future.length) commit(redo(s.history));
    },
    select: (selection: Selection) => store.setState({ selection, mobileProperties: true }),
    flush: async () => {
      clearTimeout(timer);
      if (running) return running;
      const s = store.getState();
      if (s.blocked || s.status === "saved") return;
      running = (async () => {
        while (true) {
          const start = store.getState(),
            frame = start.history.present;
          store.setState({ status: "saving" });
          try {
            const saved = await saveComposition(
              chapter.id,
              frame.document,
              start.revision,
              start.expectedOrder,
              frame.order,
            );
            store.setState((current) => ({
              revision: saved.record.revision,
              expectedOrder: frame.order,
              status: current.generation === start.generation ? "saved" : "unsaved",
              error: null,
            }));
            useStudio.setState((state) => ({
              chapters: state.chapters.map((c) => (c.id === chapter.id ? saved.chapter : c)),
              panels: state.panels.map((p) => saved.panels.find((n) => n.id === p.id) ?? p),
              projects: state.projects.map((p) => (p.id === saved.project?.id ? saved.project : p)),
            }));
            if (store.getState().generation === start.generation) break;
          } catch (error) {
            store.setState({
              status: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "Could not save composition. Export recovery before leaving.",
            });
            throw error;
          }
        }
      })().finally(() => {
        running = undefined;
      });
      return running;
    },
    synchronize: (nextChapter: Chapter, nextPanels: Panel[]) => {
      const s = store.getState(),
        actual = orderedPanels(nextPanels).map((p) => p.id);
      if (s.status === "saving") return;
      const stored = readComposition(nextChapter.composition).record;
      if (JSON.stringify(actual) !== JSON.stringify(s.expectedOrder)) {
        const next = reconcile(
          s.status === "saved" && stored ? stored.document : s.history.present.document,
          nextPanels,
        );
        store.setState({
          history: createHistory({ document: next, order: actual }),
          expectedOrder: actual,
          revision: stored?.revision ?? s.revision,
          generation: s.generation + 1,
          status: "unsaved",
          selection: null,
          focus: s.focus && actual.includes(s.focus) ? s.focus : null,
          error:
            "Chapter images changed. Composition references were reconciled and history restarted.",
        });
        schedule();
        return;
      }
      if (stored && stored.revision !== s.revision) {
        store.setState({
          blocked: true,
          status: "error",
          error: "Another editor saved this composition. Export recovery before reloading.",
        });
      }
    },
  });
  controllers.set(chapter.id, controller);
  return controller;
}
