import { AssetImport } from "./asset-import";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/700.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/noto-sans-jp/700.css";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/700.css";
import "@fontsource/bangers/400.css";
import "./composition.css";
import "@fontsource/outfit/400.css";
import "@fontsource/fraunces/400.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { NumberField } from "../editor/number-field";
import { useStudio } from "@/lib/studio/store";
import type { Chapter, Panel, Project } from "@/lib/studio/types";
import { objectFlags, alignObjects, type Align } from "@/lib/studio/composition/geometry";
import { LetteringTools } from "./lettering";
import { LETTERING_TOOLS, LETTERING_ADVANCED } from "./nav";
import {
  placeBubble,
  bubble as newBubble,
  applyStyle,
  BUBBLE_STYLE_KEYS,
  TEXT_STYLE_KEYS,
} from "@/lib/studio/composition/bubble-presets";
import type { Bubble } from "@/lib/studio/composition/bubble";
import { getController, clipboard, copySettings } from "@/lib/studio/composition/controller";
import {
  layout,
  orderedPanels,
  transitionActive,
  type CompositionObject,
  type CompositionPreferences,
  type CompositionPreset,
  type Space,
  type Fade,
  type Transition,
} from "@/lib/studio/composition/model";
import { saveCompositionPreferences } from "@/lib/studio/composition/storage";
import {
  downloadComposition,
  download,
  recoveryPackage,
  type ExportOptions,
} from "@/lib/studio/composition/export";
import { importProject } from "@/lib/studio/backup-store";
import { preflightImage } from "@/lib/studio/image-policy";
import { putBlobs } from "@/lib/studio/db";
import { decodeBlob, deviceLimits } from "@/lib/studio/images";
import { loadSession } from "@/lib/studio/pro/storage";
import { ProRenderer } from "@/lib/studio/pro/client";
import { common } from "@/lib/studio/composition/library";
import { CompositionCanvas } from "./canvas";
import { CompositionLibrary } from "./library";
import { CompositionProperties, Check, Choice, Color } from "./properties";
import {
  Layers3,
  Focus,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Scan,
  Eye,
  Save,
  Download,
  SlidersHorizontal,
  Menu,
  X,
  Copy,
  ClipboardPaste,
  ArrowLeftRight,
  Magnet,
} from "lucide-react";
import { PRIMARY, ADVANCED, SUBTAB, ALIGN, normalizeTool } from "./nav";

/** Remembered per chapter so returning from a panel document keeps the open section. */
const lastLetterTool = new Map<string, string>();
const EMPTY_PREFERENCES: CompositionPreferences = { presets: [], favorites: [] };
export default function CompositionWorkspace({
  chapter,
  project,
  panels,
  mode = "composition",
  legacyDialogue,
}: {
  chapter: Chapter;
  project: Project;
  panels: Panel[];
  /** "lettering" is the Text & Bubbles editor on the same chapter scene and history. */
  mode?: "composition" | "lettering";
  legacyDialogue?: ReactNode;
}) {
  const lettering = mode === "lettering";
  const [letterTool, setLetterToolState] = useState<string>(
    () => lastLetterTool.get(chapter.id) ?? "Bubbles",
  );
  const setLetterTool = (t: string) => {
    lastLetterTool.set(chapter.id, t);
    setLetterToolState(t);
  };
  const controller = useMemo(() => getController(chapter, panels), [chapter, panels]); // The chapter controller survives mode/tab changes.
  const session = useStore(controller),
    d = session.history.present.document;
  const list = useMemo(() => {
    const byId = new Map(panels.map((p) => [p.id, p]));
    return session.history.present.order.map((id) => byId.get(id)).filter((p): p is Panel => !!p);
  }, [panels, session.history.present.order]);
  const inactiveTransitions = d.transitions.filter((t) => !transitionActive(t, list)).length;
  const preferences = project.compositionPreferences ?? EMPTY_PREFERENCES;
  const tool = lettering ? letterTool : normalizeTool(session.tool);
  const category = PRIMARY.find((c) => (c.tools as readonly string[]).includes(tool));
  const [assetOpen, setAssetOpen] = useState(false);
  const [message, setMessage] = useState(""),
    [toolsOpen, setToolsOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [preset, setPreset] = useState<{
      category: CompositionPreset["category"];
      value: CompositionPreset["value"];
    } | null>(null),
    [presetName, setPresetName] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [readerWidth, setReaderWidth] = useState("390");
  const [options, setOptions] = useState<ExportOptions>({
      format: "image/png",
      width: chapter.width,
      quality: 0.95,
      segmentHeight: 4096,
      background: "transparent",
    }),
    [exportScope, setExportScope] = useState("Complete chapter"),
    [excluded, setExcluded] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null),
    projectFileRef = useRef<HTMLInputElement>(null),
    root = useRef<HTMLElement>(null),
    job = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () =>
      element.style.setProperty("--composition-top", `${element.getBoundingClientRect().top}px`);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const onError = useCallback((text: string) => setMessage(text), []);
  useEffect(() => {
    if (session.mobileProperties) setToolsOpen(false);
  }, [session.mobileProperties]);
  const panelKey = panels.map((p) => `${p.id}:${p.blobId}:${p.order}`).join("|");
  useEffect(
    () => controller.synchronize(chapter, orderedPanels(panels)),
    [controller, chapter, panelKey, panels],
  );
  useEffect(() => {
    const state = useStudio.getState();
    if (/^Added \d+ photos?\.$/.test(state.banner ?? "")) state.dismissBanner();
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      job.current?.abort();
      void controller.flush().catch(() =>
        useStudio.setState({
          banner:
            "Composition changes could not be saved. Return to Composition & FX and export recovery before leaving.",
        }),
      );
    };
  }, [controller]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (["unsaved", "saving", "error"].includes(controller.getState().status)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden") void controller.flush().catch(() => {});
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [controller]);
  const duplicate = useCallback(() => {
    const s = controller.getState(),
      doc = s.history.present.document,
      id = s.selection?.kind === "object" ? s.selection.id : null,
      object = doc.objects.find((o) => o.id === id);
    if (!object || objectFlags(object, doc.objects).locked) return;
    const ids = new Set([object.id]);
    let added = true;
    while (added) {
      added = false;
      doc.objects.forEach((o) => {
        if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) {
          ids.add(o.id);
          added = true;
        }
      });
    }
    const mapped = new Map([...ids].map((id) => [id, crypto.randomUUID()]));
    const copies = doc.objects
      .filter((o) => ids.has(o.id))
      .map((o) => ({
        ...structuredClone(o),
        id: mapped.get(o.id)!,
        parentId: o.parentId && mapped.has(o.parentId) ? mapped.get(o.parentId) : o.parentId,
        x: o.id === object.id ? o.x + 20 : o.x,
        y: o.id === object.id ? o.y + 20 : o.y,
        name: `${o.name} copy`.slice(0, 200),
      }));
    controller.change((doc) => ({ ...doc, objects: [...doc.objects, ...copies] }));
    controller.select({ kind: "object", id: mapped.get(object.id)! });
  }, [controller]);
  const remove = useCallback(() => {
    const s = controller.getState(),
      doc = s.history.present.document,
      id = s.selection?.kind === "object" ? s.selection.id : null,
      object = doc.objects.find((o) => o.id === id);
    if (!object || objectFlags(object, doc.objects).locked) return;
    const ids = new Set([object.id]);
    let previous = 0;
    while (previous !== ids.size) {
      previous = ids.size;
      doc.objects.forEach((o) => {
        if (o.parentId && ids.has(o.parentId)) ids.add(o.id);
      });
    }
    controller.change((doc) => ({ ...doc, objects: doc.objects.filter((o) => !ids.has(o.id)) }));
    controller.select(null);
  }, [controller]);
  const paste = useCallback(() => {
    if (!clipboard || !("kind" in clipboard) || clipboard.kind === "group") return;
    const source = structuredClone(clipboard) as CompositionObject,
      owner = controller.getState().selectedPanels[0];
    const next = {
      ...source,
      id: crypto.randomUUID(),
      owner,
      parentId: undefined,
      x: source.x + 20,
      y: source.y + 20,
    };
    controller.change((doc) => ({ ...doc, objects: [...doc.objects, next] }));
    controller.select({ kind: "object", id: next.id });
  }, [controller]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const input = (event.target as Element).closest(
        "input,textarea,select,[contenteditable=true]",
      );
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void controller.flush().catch(onError);
        return;
      }
      if (
        input ||
        controller.getState().before ||
        controller.getState().preview ||
        controller.getState().blocked
      )
        return;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) controller.redo();
        else controller.undo();
      }
      if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        controller.redo();
      }
      if (command && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      }
      if (command && event.key.toLowerCase() === "c") {
        const s = controller.getState(),
          o = s.history.present.document.objects.find((o) => o.id === s.selection?.id);
        if (o) {
          event.preventDefault();
          copySettings(o);
        }
      }
      if (command && event.key.toLowerCase() === "v") {
        event.preventDefault();
        paste();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        remove();
      }
      if (event.key === "Escape")
        controller.setState({ preview: false, focus: null, mobileProperties: false });
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [controller, duplicate, remove, paste, onError]);
  const updatePreferences = async (next: CompositionPreferences) => {
    try {
      const saved = await saveCompositionPreferences(project.id, next);
      useStudio.setState((s) => ({
        projects: s.projects.map((p) => (p.id === project.id ? saved : p)),
      }));
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save presets.");
      return false;
    }
  };
  const onPreset = (category: CompositionPreset["category"], value: CompositionPreset["value"]) => {
    setPreset({ category, value: structuredClone(value) });
    setPresetName(`${category} preset`);
  };
  const applyPreset = (p: CompositionPreset) => {
    const owner = session.focus ?? session.selectedPanels[0] ?? list[0]?.id;
    if (p.category === "bubble") {
      const selected = d.objects.find(
        (o): o is Bubble => o.id === session.selection?.id && o.kind === "bubble",
      );
      const source = p.value as Bubble;
      if (selected && !selected.locked && p.collection) {
        const keys =
          p.collection === "Text style"
            ? TEXT_STYLE_KEYS
            : [...BUBBLE_STYLE_KEYS, ...TEXT_STYLE_KEYS];
        controller.change((doc) => ({
          ...doc,
          objects: doc.objects.map((o) =>
            o.id === selected.id ? applyStyle(selected, source, keys) : o,
          ),
        }));
        return;
      }
      const next = placeBubble(
        d,
        list,
        { ...structuredClone(source), id: crypto.randomUUID(), parentId: undefined },
        owner,
      );
      controller.change((doc) => ({ ...doc, objects: [...doc.objects, next] }));
      controller.select({ kind: "object", id: next.id });
      return;
    }
    if (p.category === "sfx" || p.category === "fx" || p.category === "asset") {
      const o = {
        ...structuredClone(p.value),
        id: crypto.randomUUID(),
        owner,
        parentId: undefined,
      } as CompositionObject;
      controller.change((doc) => ({ ...doc, objects: [...doc.objects, o] }));
      controller.select({ kind: "object", id: o.id });
      return;
    }
    if (!owner) {
      onError("Select a panel first.");
      return;
    }
    if (p.category === "spacing") {
      controller.change((doc) => ({
        ...doc,
        panels: {
          ...doc.panels,
          [owner]: { ...doc.panels[owner], bottom: structuredClone(p.value) as Space },
        },
      }));
      controller.setState({ tool: "Spacing" });
      controller.select({ kind: "space", id: owner, slot: "bottom" });
    }
    if (p.category === "fade") {
      const f = { ...structuredClone(p.value), id: crypto.randomUUID() } as Fade;
      controller.change((doc) => ({
        ...doc,
        panels: {
          ...doc.panels,
          [owner]: { ...doc.panels[owner], fades: [...doc.panels[owner].fades, f] },
        },
      }));
      controller.setState({ tool: "Fades" });
      controller.select({ kind: "fade", id: f.id, panelId: owner });
    }
    if (p.category === "transition") {
      const b = list[list.findIndex((x) => x.id === owner) + 1];
      if (!b) {
        onError("Select a panel with a following image.");
        return;
      }
      const t = {
        ...structuredClone(p.value),
        id: crypto.randomUUID(),
        a: owner,
        b: b.id,
      } as Transition;
      controller.change((doc) => ({ ...doc, transitions: [...doc.transitions, t] }));
      controller.select({ kind: "transition", id: t.id });
    }
  };
  const native = async (id: string) => {
    if (busy) return;
    setBusy(true);
    let renderer: ProRenderer | undefined;
    try {
      const source = await loadSession(id),
        panel = panels.find((p) => p.id === id);
      if (!source || !panel)
        throw Error(
          "No saved native draft exists for this panel. Save it in Raster or Text & Bubbles first.",
        );
      if (source.acceptedBlobId !== panel.blobId)
        throw Error(
          "This saved draft belongs to an older image revision. Reopen it in Raster before using it here.",
        );
      renderer = new ProRenderer();
      await renderer.init(source, deviceLimits().maxArea);
      const result = await renderer.export(
        source.document,
        deviceLimits().maxArea,
        "image/png",
        1,
        () => {},
      );
      if (!result.blob) throw Error("The native draft did not produce an image.");
      const decoded = await decodeBlob(result.blob);
      const snapshot = {
        blobId: crypto.randomUUID(),
        width: decoded.width,
        height: decoded.height,
        revision: source.revision,
      };
      decoded.close();
      await putBlobs([{ id: snapshot.blobId, blob: result.blob }]);
      controller.change((doc) => ({
        ...doc,
        panels: { ...doc.panels, [id]: { ...doc.panels[id], snapshot } },
      }));
      setMessage(`Using saved native revision ${source.revision}; accepted image unchanged.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Native draft could not be used.");
    } finally {
      renderer?.dispose();
      if (alive.current) setBusy(false);
    }
  };
  const overlay = async (file: File) => {
    setBusy(true);
    try {
      const info = await preflightImage(file);
      const blob = file.type === info.mime ? file : file.slice(0, file.size, info.mime),
        decoded = await decodeBlob(blob),
        width = Math.min(d.width, decoded.width),
        height = (decoded.height * width) / decoded.width;
      decoded.close();
      const blobId = crypto.randomUUID();
      await putBlobs([{ id: blobId, blob }]);
      const o = {
        ...common(file.name, width, height),
        kind: "overlay" as const,
        blobId,
        owner: session.selectedPanels[0],
      };
      controller.change((doc) => ({ ...doc, objects: [...doc.objects, o] }));
      controller.select({ kind: "object", id: o.id });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not add overlay.");
    } finally {
      setBusy(false);
    }
  };
  const saveAsset = async (
    blob: Blob,
    name: string,
    collection: string,
    w: number,
    h: number,
    place: boolean,
  ) => {
    const blobId = crypto.randomUUID();
    await putBlobs([{ id: blobId, blob }]);
    const width = Math.min(d.width, w),
      o = { ...common(name, width, (h * width) / w), kind: "overlay" as const, blobId };
    const preset: CompositionPreset = {
      id: crypto.randomUUID(),
      name,
      collection,
      category: "asset",
      value: o,
    };
    const saved = await updatePreferences({
      ...preferences,
      presets: [...preferences.presets, preset],
    });
    if (!saved) throw Error("Asset could not be saved. Free storage and retry.");
    if (place) applyPreset(preset);
    setMessage(
      place ? `Saved “${name}” to My Assets and placed it.` : `Saved “${name}” to My Assets.`,
    );
  };
  const saveStyle = (kind: "Bubble style" | "Text style", value: Bubble) =>
    void updatePreferences({
      ...preferences,
      presets: [
        ...preferences.presets,
        {
          id: crypto.randomUUID(),
          name: `${value.preset ?? value.shape} ${kind.toLowerCase()}`.slice(0, 200),
          category: "bubble",
          collection: kind,
          value: { ...structuredClone(value), owner: undefined, parentId: undefined },
        },
      ],
    }).then((ok) => ok && setMessage(`${kind} saved. Find it under Bubbles → My styles.`));
  const placeSuggestion = (index: number) => {
    const s = controller.getState().suggestions?.[index];
    if (!s) return;
    const frames = layout(d, list).frames,
      center = s.y + s.height / 2,
      frame = frames.find((f) => center >= f.top && center < f.end);
    const b = newBubble(s.preset ?? "Standard dialogue");
    const next: Bubble = {
      ...b,
      owner: frame?.panel.id,
      x: Math.round(s.x),
      y: Math.round(s.y - (frame?.imageY ?? 0)),
      tails: b.tails.map((t) => ({
        ...t,
        tip: { x: t.tip.x, y: Math.min(t.tip.y, b.height + 60) },
      })),
    };
    controller.change((doc) => ({ ...doc, objects: [...doc.objects, next] }));
    controller.setState({ suggestions: [] });
    controller.select({ kind: "object", id: next.id });
  };
  const multi = session.multi ?? [];
  const align = (m: Align) =>
    controller.change((doc) => ({
      ...doc,
      objects: alignObjects(multi, m, layout(doc, list).frames, doc.objects),
    }));
  const recover = async () => {
    setBusy(true);
    try {
      download(
        await recoveryPackage(
          project.id,
          chapter.id,
          controller.getState().schemaUnavailable
            ? undefined
            : controller.getState().history.present.document,
          controller.getState().history.present.order,
        ),
        `${project.title}-composition.inkstrip-project`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Recovery export failed.");
    } finally {
      setBusy(false);
    }
  };
  const doExport = async () => {
    if (busy) return;
    const abort = new AbortController();
    job.current = abort;
    setBusy(true);
    setProgress("Preparing export");
    try {
      const ids =
        exportScope === "Selected panels"
          ? session.selectedPanels
          : exportScope === "Focused panel"
            ? session.focus
              ? [session.focus]
              : session.selectedPanels.slice(0, 1)
            : undefined;
      if (ids && ids.length === 0) throw Error("Select at least one panel to export.");
      await downloadComposition(
        `${project.title}-${chapter.title}`,
        d,
        list,
        { ...options, panelIds: ids, excluded },
        abort.signal,
        (n, total) => {
          if (alive.current) setProgress(`Rendering ${n} / ${total}`);
        },
      );
      if (alive.current) {
        setProgress("Export complete");
        setMessage("Composition exported.");
      }
    } catch (error) {
      if (alive.current)
        setProgress(
          abort.signal.aborted
            ? "Export cancelled"
            : error instanceof Error
              ? error.message
              : "Export failed",
        );
    } finally {
      job.current = null;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section
      ref={root}
      className={`composition-studio ${session.preview ? "composition-reading-mode" : ""} ${lettering ? "is-lettering" : ""}`}
      aria-label={lettering ? "Text and Bubbles chapter editor" : "Composition and FX Studio"}
      data-composition={lettering ? "lettering" : "studio"}
      data-save-status={session.status}
    >
      <div className="composition-toolbar">
        {session.preview ? (
          <>
            <Button variant="secondary" onClick={() => controller.setState({ preview: false })}>
              <X />
              Exit reading preview
            </Button>
            <Choice
              label="Mobile reading width"
              value={readerWidth}
              options={["320", "360", "390", "430", "Full width"]}
              onChange={setReaderWidth}
            />
          </>
        ) : (
          <>
            <Button
              className="composition-tools-toggle"
              variant="ghost"
              onClick={() => {
                controller.setState({ mobileProperties: false });
                setToolsOpen(!toolsOpen);
              }}
              aria-expanded={toolsOpen}
            >
              <Menu />
              Tools
            </Button>
            <div className="composition-mode">
              <Button
                variant={!session.focus ? "secondary" : "ghost"}
                onClick={() => controller.setState({ focus: null })}
              >
                <Layers3 />
                Chapter
              </Button>
              <Button
                variant={session.focus ? "secondary" : "ghost"}
                disabled={!session.selectedPanels.length && !session.focus}
                onClick={() =>
                  controller.setState({ focus: session.focus ?? session.selectedPanels[0] })
                }
              >
                <Focus />
                Focus
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Undo composition"
              disabled={!session.history.past.length || session.blocked}
              onClick={controller.undo}
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Redo composition"
              disabled={!session.history.future.length || session.blocked}
              onClick={controller.redo}
            >
              <Redo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              onClick={() => controller.setState({ zoom: Math.max(0.15, session.zoom / 1.25) })}
            >
              <ZoomOut />
            </Button>
            <span>{Math.round(session.zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              onClick={() => controller.setState({ zoom: Math.min(5, session.zoom * 1.25) })}
            >
              <ZoomIn />
            </Button>
            <Button variant="ghost" onClick={() => controller.setState({ zoom: 1 })}>
              Fit width
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const canvas = root.current?.querySelector(".composition-viewport"),
                  scene = layout(d, list),
                  f = scene.frames.find((f) => f.panel.id === session.focus),
                  height = f ? f.gapY - f.top : scene.height;
                if (canvas)
                  controller.setState({
                    zoom: Math.max(
                      0.01,
                      Math.min(
                        1,
                        (canvas.clientHeight - 32) / height / ((canvas.clientWidth - 32) / d.width),
                      ),
                    ),
                  });
              }}
            >
              <Scan />
              Fit screen
            </Button>
            <Button
              variant="ghost"
              aria-pressed={session.snap !== false}
              title="Snap to chapter, panel and object guides"
              onClick={() => controller.setState({ snap: session.snap === false })}
            >
              <Magnet />
              Snap
            </Button>
            <Button
              variant="ghost"
              aria-pressed={session.before}
              onClick={() => controller.setState({ before: !session.before })}
            >
              <ArrowLeftRight />
              {session.before ? "Before composition" : "Before / After"}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                controller.setState({ preview: true, focus: null, zoom: 1, before: false })
              }
            >
              <Eye />
              Preview
            </Button>
            <Button
              variant="secondary"
              disabled={busy || session.blocked}
              onClick={() => void controller.flush().catch((error) => onError(String(error)))}
            >
              <Save />
              Save
            </Button>
            <Button disabled={busy} onClick={() => setExportOpen(true)}>
              <Download />
              Export
            </Button>
          </>
        )}
        <span className={`composition-save-status is-${session.status}`} role="status">
          {session.status === "saved"
            ? "Saved on this device"
            : session.status === "saving"
              ? "Saving…"
              : session.status === "unsaved"
                ? "Unsaved changes"
                : "Save failed"}
        </span>
      </div>
      {!session.preview && (session.error || message) && (
        <div className="composition-notice" role={session.status === "error" ? "alert" : "status"}>
          <span>{session.error ?? message}</span>
          <Button variant="ghost" disabled={busy} onClick={() => void recover()}>
            Export recovery
          </Button>
          {message && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Dismiss composition notice"
              onClick={() => setMessage("")}
            >
              <X />
            </Button>
          )}
        </div>
      )}
      {!session.preview && inactiveTransitions > 0 && (
        <div className="composition-notice" role="status">
          <span>
            {inactiveTransitions} {inactiveTransitions === 1 ? "transition is" : "transitions are"}{" "}
            inactive because panel adjacency changed.
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              controller.setState({ tool: "Transitions", mobileProperties: false });
              setToolsOpen(true);
            }}
          >
            Review transitions
          </Button>
        </div>
      )}
      {!list.length ? (
        <div className="composition-empty">
          <Layers3 />
          <h2>{lettering ? "Letter your chapter" : "Compose your chapter"}</h2>
          <p>
            {lettering
              ? "Add artwork in Images, then return here to place dialogue, bubbles and text across the whole chapter."
              : "Add artwork in Images, then return here to build spacing, transitions and effects."}
          </p>
        </div>
      ) : (
        <div className="composition-layout">
          {!session.preview && (
            <aside
              className={`composition-left ${toolsOpen ? "is-open" : ""}`}
              aria-label="Composition tools"
            >
              <div className="composition-mobile-panel-header">
                <strong>{lettering ? "Text & Bubbles tools" : "Composition tools"}</strong>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close tools"
                  onClick={() => setToolsOpen(false)}
                >
                  <X />
                </Button>
              </div>
              {lettering ? (
                <>
                  <nav
                    className="composition-tool-tabs is-primary"
                    aria-label="Text and bubbles sections"
                  >
                    {LETTERING_TOOLS.map((t) => (
                      <button
                        key={t}
                        className={tool === t ? "is-active" : ""}
                        aria-current={tool === t ? "page" : undefined}
                        onClick={() => setLetterTool(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </nav>
                  <details
                    className="composition-advanced-nav"
                    open={LETTERING_ADVANCED.includes(tool as never)}
                  >
                    <summary>Advanced</summary>
                    <div>
                      {LETTERING_ADVANCED.map((t) => (
                        <button
                          key={t}
                          className={tool === t ? "is-active" : ""}
                          onClick={() => setLetterTool(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </details>
                  <fieldset disabled={session.blocked || session.before || busy}>
                    <LetteringTools
                      tool={tool}
                      controller={controller}
                      session={session}
                      document={d}
                      panels={list}
                      preferences={preferences}
                      onPreferences={(next) => void updatePreferences(next)}
                      onApplyPreset={applyPreset}
                      onDuplicate={duplicate}
                      onOverlay={() => fileRef.current?.click()}
                      legacy={legacyDialogue}
                      onError={onError}
                    />
                  </fieldset>
                </>
              ) : (
                <>
                  <nav
                    className="composition-tool-tabs is-primary"
                    aria-label="Composition tool sections"
                  >
                    {PRIMARY.map((c) => (
                      <button
                        key={c.label}
                        className={category === c ? "is-active" : ""}
                        aria-current={category === c ? "page" : undefined}
                        onClick={() => controller.setState({ tool: c.tools[0] })}
                      >
                        <span className="composition-tool-icon">
                          <c.icon aria-hidden="true" />
                          {c.label}
                        </span>
                      </button>
                    ))}
                  </nav>
                  <details className="composition-advanced-nav" open={ADVANCED.includes(tool)}>
                    <summary>Advanced · layers, effects, overlays, presets</summary>
                    <div>
                      {ADVANCED.map((t) => (
                        <button
                          key={t}
                          className={tool === t ? "is-active" : ""}
                          onClick={() => controller.setState({ tool: t })}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </details>
                  <fieldset disabled={session.blocked || session.before || busy}>
                    {category && category.tools.length > 1 && (
                      <div
                        className="composition-subtabs composition-subtabs-main"
                        role="tablist"
                        aria-label={`${category.label} tools`}
                      >
                        {category.tools.map((t) => (
                          <button
                            key={t}
                            role="tab"
                            aria-selected={tool === t}
                            onClick={() => controller.setState({ tool: t })}
                          >
                            {SUBTAB[t] ?? t}
                          </button>
                        ))}
                      </div>
                    )}
                    <CompositionLibrary
                      tool={tool}
                      controller={controller}
                      session={session}
                      document={d}
                      panels={list}
                      preferences={preferences}
                      onPreferences={(next) => void updatePreferences(next)}
                      onApplyPreset={applyPreset}
                      onOverlay={() => fileRef.current?.click()}
                      onDuplicate={duplicate}
                      onDelete={remove}
                      onAssetImport={() => setAssetOpen(true)}
                      onExtractSave={saveAsset}
                    />
                  </fieldset>
                </>
              )}
              <div className="composition-project-actions">
                <Button variant="ghost" disabled={busy} onClick={() => void recover()}>
                  Export editable project
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => projectFileRef.current?.click()}
                >
                  Import editable project
                </Button>
              </div>
            </aside>
          )}
          <div
            className="composition-canvas-container"
            style={
              session.preview && readerWidth !== "Full width"
                ? { maxWidth: Number(readerWidth) + 32 }
                : undefined
            }
          >
            <CompositionCanvas
              controller={controller}
              chapter={chapter}
              panels={list}
              assetPresets={preferences.presets}
              onError={onError}
              onPlaceSuggestion={placeSuggestion}
            />
          </div>
          {!session.preview && (
            <aside
              className={`composition-right ${session.mobileProperties ? "is-open" : ""}`}
              aria-label="Composition properties"
            >
              <div className="composition-mobile-panel-header">
                <strong>Properties</strong>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close properties"
                  onClick={() => controller.setState({ mobileProperties: false })}
                >
                  <X />
                </Button>
              </div>
              {multi.length > 1 && (
                <div className="composition-multi-tools">
                  <h3>{multi.length} layers selected</h3>
                  <p className="composition-hint">
                    Drag any of them to move together. Shift-click adds or removes layers.
                  </p>
                  <div className="composition-align-grid" role="group" aria-label="Align layers">
                    {ALIGN.map((a) => (
                      <button key={a.mode} onClick={() => align(a.mode)}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <fieldset disabled={session.blocked || session.before || busy}>
                <CompositionProperties
                  onSaveStyle={saveStyle}
                  controller={controller}
                  session={session}
                  document={d}
                  panels={list}
                  onPreset={onPreset}
                  onNative={(id) => void native(id)}
                  onOverlay={() => fileRef.current?.click()}
                />
              </fieldset>
              {session.selection?.kind === "object" && (
                <div className="composition-actions composition-object-actions">
                  <Button variant="ghost" onClick={duplicate}>
                    <Copy />
                    Duplicate
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const object = d.objects.find((o) => o.id === session.selection?.id);
                      if (object) copySettings(object);
                    }}
                  >
                    Copy layer
                  </Button>
                  <Button variant="ghost" onClick={paste}>
                    <ClipboardPaste />
                    Paste
                  </Button>
                  <Button variant="danger" onClick={remove}>
                    Delete
                  </Button>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
      {!session.preview && (
        <button
          className="composition-properties-toggle"
          onClick={() => controller.setState({ mobileProperties: !session.mobileProperties })}
        >
          <SlidersHorizontal />
          Properties
        </button>
      )}
      {assetOpen && (
        <AssetImport
          open
          onClose={() => setAssetOpen(false)}
          onImport={async (blob, name, collection, w, h) => {
            await saveAsset(blob, name, collection, w, h, true);
            controller.setState({ tool: "My Assets" });
          }}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void overlay(f);
        }}
      />
      <input
        ref={projectFileRef}
        type="file"
        accept=".inkstrip-project"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) {
            setBusy(true);
            void importProject(f)
              .then(() => setMessage("Editable project imported into the Library."))
              .catch((error) => onError(String(error)))
              .finally(() => setBusy(false));
          }
        }}
      />
      <Modal
        title="Save composition preset"
        description="Reusable within this project and included in its editable package."
        open={!!preset}
        onOpenChange={(open) => {
          if (!open) setPreset(null);
        }}
      >
        <label className="editor-field-label">
          Preset name
          <input
            className="field"
            value={presetName}
            maxLength={200}
            onChange={(e) => setPresetName(e.target.value)}
          />
        </label>
        <Button
          disabled={!presetName.trim()}
          onClick={() => {
            if (!preset) return;
            void updatePreferences({
              ...preferences,
              presets: [
                ...preferences.presets,
                { id: crypto.randomUUID(), name: presetName.trim(), ...preset },
              ],
            }).then((saved) => {
              if (saved) setPreset(null);
            });
          }}
        >
          Save preset
        </Button>
      </Modal>
      <Modal
        title="Export composition"
        description="Original images stay untouched. Tall output is saved as continuous numbered segments."
        open={exportOpen}
        onOpenChange={(open) => {
          if (!busy) setExportOpen(open);
        }}
      >
        <div className="composition-export-dialog">
          <fieldset disabled={busy}>
            <Choice
              label="Export scope"
              value={exportScope}
              options={["Complete chapter", "Selected panels", "Focused panel"]}
              onChange={setExportScope}
            />
            <Choice
              label="Composition export format"
              value={options.format}
              options={["image/png", "image/jpeg", "image/webp"]}
              onChange={(format) =>
                setOptions({ ...options, format: format as ExportOptions["format"] })
              }
            />
            <p className="composition-hint">
              PNG is lossless. JPEG and browser WebP use quality encoding; lossless WebP is
              unavailable.
            </p>
            <div className="composition-two">
              <NumberField
                label="Output width"
                value={options.width}
                min={320}
                max={4096}
                onChange={(width) => setOptions({ ...options, width })}
              />
              <NumberField
                label="Segment height"
                value={options.segmentHeight}
                min={128}
                max={16384}
                onChange={(segmentHeight) => setOptions({ ...options, segmentHeight })}
              />
            </div>
            {options.format !== "image/png" && (
              <NumberField
                label="Encoding quality"
                value={options.quality}
                min={0.1}
                max={1}
                step={0.01}
                onChange={(quality) => setOptions({ ...options, quality })}
              />
            )}
            <Color
              label="Transparency matte"
              value={options.background}
              onChange={(background) => setOptions({ ...options, background })}
            />
            <p className="composition-hint">
              The matte fills transparent pixels; chapter and spacing colors stay as designed.
            </p>
            <Check
              label="Preserve transparency"
              value={options.background === "transparent"}
              onChange={(checked) =>
                setOptions({ ...options, background: checked ? "transparent" : "#ffffff" })
              }
            />
            {(d.objects.length > 0 ||
              d.transitions.length > 0 ||
              Object.values(d.panels).some((p) => p.fades.length)) && (
              <details>
                <summary>Include effect layers</summary>
                {[
                  ...d.objects.map((o) => ({ id: o.id, name: o.name })),
                  ...d.transitions.map((t) => ({ id: t.id, name: t.name ?? t.type })),
                  ...Object.values(d.panels).flatMap((p) =>
                    p.fades.map((f) => ({ id: f.id, name: f.name })),
                  ),
                ].map((o) => (
                  <Check
                    key={o.id}
                    label={o.name}
                    value={!excluded.includes(o.id)}
                    onChange={(checked) =>
                      setExcluded(
                        checked ? excluded.filter((id) => id !== o.id) : [...excluded, o.id],
                      )
                    }
                  />
                ))}
              </details>
            )}
            <Button onClick={() => void doExport()}>Export images</Button>
          </fieldset>
          {busy && (
            <Button variant="secondary" onClick={() => job.current?.abort()}>
              Cancel export
            </Button>
          )}
          {progress && <p role="status">{progress}</p>}
        </div>
      </Modal>
    </section>
  );
}
