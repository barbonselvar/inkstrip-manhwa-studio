/**
 * Desktop-only chrome, mounted by the root route only inside the Windows app.
 * Native file commands (New/Open/Save/Save As/Revert/Export), keyboard shortcuts,
 * unsaved-change tracking, autosave + crash recovery, project backups, close/quit
 * protection, settings, and the owner-approved update flow.
 */
import "@/desktop.css";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { desktopBridge, flushEditors } from "@/lib/desktop/bridge";
import type {
  AppInfo,
  CloseRequest,
  DesktopSettings,
  DownloadEvent,
  FileRef,
  MenuCommand,
  ProjectLink,
  RecoverySnapshot,
  UpdateState,
} from "@/lib/desktop/contract";
import {
  fingerprintProject,
  openProjectFile,
  revertToSaved,
  saveProject,
  writeRecoverySnapshot,
  type ConflictChoice,
  type OpenConflict,
  type SaveMode,
} from "@/lib/desktop/project-file";
import { storageMessage } from "@/lib/studio/db";
import { useStudio } from "@/lib/studio/store";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert, Download, FileWarning, HardDriveDownload, Loader2, RefreshCw, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Busy = { label: string; stage: string; fraction: number } | null;
type Toast = { id: number; tone: "ok" | "error" | "info"; text: string };
type DialogKind = "settings" | "recovery" | "backups" | "about" | "updates" | null;
type ProjectStatus = { projectId: string; link: ProjectLink | null; fingerprint: string | null; dirty: boolean };
type Pending = { title: string; projectId: string; linked: boolean }[];

const currentProjectId = (pathname: string) => /^\/p\/([^/]+)/.exec(pathname)?.[1] ?? null;
const timeAgo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleString();
};
const size = (bytes: number) =>
  bytes > 1024 * 1024 * 1024
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : bytes > 1024 * 1024
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function DesktopShell() {
  const bridge = desktopBridge()!;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projectId = currentProjectId(pathname);
  const projects = useStudio((s) => s.projects);
  const project = projects.find((p) => p.id === projectId) ?? null;

  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [conflict, setConflict] = useState<{ conflict: OpenConflict; resolve: (c: ConflictChoice) => void } | null>(null);
  const [closePrompt, setClosePrompt] = useState<{ pending: Pending; reason: "close" | "update"; resolve: (c: "save" | "discard" | "cancel") => void } | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [crashReport, setCrashReport] = useState<{ dirty: Pending; snapshots: RecoverySnapshot[] } | null>(null);
  const [revertConfirm, setRevertConfirm] = useState(false);

  /** Fingerprint of each project when first seen this session: "modified this session". */
  const baseline = useRef(new Map<string, string>());
  const lastSnapshot = useRef(new Map<string, string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 12000 : 5000);
  }, []);

  /** Serialize file operations: no two saves/opens ever interleave. */
  const exclusive = useCallback(<T,>(run: () => Promise<T>) => {
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => {});
    return next;
  }, []);

  const statusOf = useCallback(
    async (id: string): Promise<ProjectStatus> => {
      const [link, fingerprint] = await Promise.all([bridge.getLink(id), fingerprintProject(id)]);
      if (fingerprint && !baseline.current.has(id)) baseline.current.set(id, fingerprint);
      const dirty = !!fingerprint && (link ? link.fingerprint !== fingerprint : baseline.current.get(id) !== fingerprint);
      return { projectId: id, link, fingerprint, dirty };
    },
    [bridge],
  );

  const refresh = useCallback(async () => {
    if (!projectId) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await statusOf(projectId));
    } catch {
      /* storage busy; next tick */
    }
  }, [projectId, statusOf]);

  // ---- status polling + window title ----
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const dirty = !!status?.dirty;
    void bridge.setTitle(project ? `${project.title}${status && !status.link ? " (not saved to a file)" : ""}` : "", dirty);
  }, [bridge, project, status]);

  // ---- save / open ----
  const progress = (label: string) => (stage: string, fraction: number) => setBusy({ label, stage, fraction });

  const save = useCallback(
    (mode: SaveMode, id = projectId) =>
      exclusive(async () => {
        if (!id) {
          toast("Open a project to save it.");
          return false;
        }
        try {
          const outcome = await saveProject(id, mode, progress(mode === "export" ? "Exporting a copy" : "Saving project"));
          if (!outcome) return false;
          if (mode !== "export") baseline.current.set(id, outcome.fingerprint);
          toast(
            `${mode === "export" ? "Copy exported to" : "Saved to"} ${outcome.file.name} · ${size(outcome.result.size)}`,
            "ok",
          );
          return true;
        } catch (error) {
          toast(`Not saved: ${storageMessage(error)} Your work is still safe in the Inkstrip workspace.`, "error");
          return false;
        } finally {
          setBusy(null);
          void refresh();
        }
      }),
    [exclusive, projectId, refresh, toast],
  );

  const resolveConflict = useCallback(
    (c: OpenConflict) => new Promise<ConflictChoice>((resolve) => setConflict({ conflict: c, resolve })),
    [],
  );

  const open = useCallback(
    (ref: FileRef) =>
      exclusive(async () => {
        try {
          const outcome = await openProjectFile(ref, resolveConflict, progress("Opening project"));
          if (!outcome) return;
          const s = await statusOf(outcome.projectId);
          if (s.fingerprint) baseline.current.set(outcome.projectId, s.fingerprint);
          await navigate({ to: "/p/$projectId", params: { projectId: outcome.projectId } });
          if (outcome.action === "imported" && ref.kind !== "project")
            toast("Imported. Use Save (Ctrl+S) to keep it as an .inkstrip project file.", "ok");
          if (outcome.action === "replaced" || outcome.action === "reloaded")
            toast("Opened the saved file. The previous workspace copy was kept in Recover Autosaved Work.", "info");
        } catch (error) {
          toast(`Could not open ${ref.name}: ${storageMessage(error)}`, "error");
        } finally {
          setBusy(null);
          setConflict(null);
          void refresh();
        }
      }),
    [exclusive, navigate, refresh, resolveConflict, statusOf, toast],
  );

  const newProject = useCallback(async () => {
    try {
      const { projectId: id } = await useStudio.getState().createProject("Untitled project");
      await navigate({ to: "/p/$projectId", params: { projectId: id } });
    } catch (error) {
      toast(storageMessage(error), "error");
    }
  }, [navigate, toast]);

  /** Which projects have work that is not in a file yet (current + modified this session). */
  const pendingWork = useCallback(async (): Promise<Pending> => {
    // Projects opened this session, the current one, and every project saved to a file
    // (its unsaved changes may come from an earlier session).
    const linked = (await bridge.listLinks().catch(() => [])).map((l) => l.projectId);
    const ids = new Set([...baseline.current.keys(), ...(projectId ? [projectId] : []), ...linked]);
    const out: Pending = [];
    for (const id of ids) {
      const p = useStudio.getState().projects.find((x) => x.id === id);
      if (!p) continue;
      const s = await statusOf(id).catch(() => null);
      if (s?.dirty) out.push({ title: p.title, projectId: id, linked: !!s.link });
    }
    return out;
  }, [bridge, projectId, statusOf]);

  /** Flush editors, then let the user save pending work. True = safe to proceed. */
  const prepareToLeave = useCallback(
    async (reason: "close" | "update") => {
      try {
        await flushEditors();
      } catch (error) {
        toast(`An editor could not save: ${storageMessage(error)}`, "error");
        return false;
      }
      const pending = await pendingWork();
      if (pending.length) {
        const choice = await new Promise<"save" | "discard" | "cancel">((resolve) => setClosePrompt({ pending, reason, resolve }));
        setClosePrompt(null);
        if (choice === "cancel") return false;
        if (choice === "save") {
          for (const item of pending) if (!(await save("save", item.projectId))) return false;
        }
      }
      // Safety net before an update restarts the app: snapshot anything still unsaved.
      if (reason === "update")
        for (const item of await pendingWork()) await writeRecoverySnapshot(item.projectId).catch(() => {});
      return true;
    },
    [pendingWork, save, toast],
  );

  // ---- commands ----
  const command = useCallback(
    async (cmd: MenuCommand) => {
      switch (cmd) {
        case "new-project":
          return newProject();
        case "open-project": {
          const ref = await bridge.openProjectDialog().catch((e) => {
            toast(storageMessage(e), "error");
            return null;
          });
          if (ref) await open(ref);
          return;
        }
        case "import-backup": {
          const ref = await bridge.importBackupDialog().catch((e) => {
            toast(storageMessage(e), "error");
            return null;
          });
          if (ref) await open(ref);
          return;
        }
        case "save":
          return void (await save("save"));
        case "save-as":
          return void (await save("save-as"));
        case "export-copy":
          return void (await save("export"));
        case "revert":
          if (!projectId || !status?.link) return toast("This project has no saved file to revert to.");
          return setRevertConfirm(true);
        case "recovery":
        case "backups":
        case "settings":
        case "about":
          return setDialog(cmd);
        case "updates":
          setDialog("updates");
          setUpdate(await bridge.checkForUpdates());
          return;
        case "zoom-in":
        case "zoom-out":
        case "zoom-fit": {
          const action = cmd === "zoom-in" ? "in" : cmd === "zoom-out" ? "out" : "fit";
          const event = new CustomEvent("inkstrip:zoom", { detail: { action }, cancelable: true });
          // An open canvas editor handles zoom itself; otherwise zoom the interface.
          if (window.dispatchEvent(event)) await bridge.setZoom(action === "fit" ? "reset" : action);
          return;
        }
        default:
          return;
      }
    },
    [bridge, newProject, open, projectId, save, status?.link, toast],
  );

  // ---- events from main ----
  useEffect(() => {
    const off = [
      bridge.on("menu-command", ({ command: c }) => void command(c)),
      bridge.on("open-file", (ref) => void open(ref)),
      bridge.on("update-state", (s) => setUpdate(s)),
      bridge.on("download", (d: DownloadEvent) => {
        if (d.state === "completed") toast(`Exported ${d.name}`, "ok");
        else if (d.state === "interrupted") toast(`Export of ${d.name} was interrupted.`, "error");
      }),
      bridge.on("close-request", (req: CloseRequest) => {
        void prepareToLeave(req.reason).then((ok) => bridge.closeReady(req.id, ok));
      }),
    ];
    return () => off.forEach((f) => f());
  }, [bridge, command, open, prepareToLeave, toast]);

  // ---- commands from in-page desktop controls (library panel) ----
  useEffect(() => {
    const onCommand = (e: Event) => void command((e as CustomEvent<MenuCommand>).detail);
    const onOpen = (e: Event) => void open((e as CustomEvent<FileRef>).detail);
    window.addEventListener("inkstrip:desktop-command", onCommand);
    window.addEventListener("inkstrip:desktop-open", onOpen);
    return () => {
      window.removeEventListener("inkstrip:desktop-command", onCommand);
      window.removeEventListener("inkstrip:desktop-open", onOpen);
    };
  }, [command, open]);

  // ---- startup: pending file, crash recovery, settings, update state ----
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const [ready, appInfo, s, u] = await Promise.all([
        bridge.rendererReady(),
        bridge.info(),
        bridge.getSettings(),
        bridge.updateState(),
      ]);
      setInfo(appInfo);
      setSettings(s);
      setUpdate(u);
      await useStudio.getState().hydrate();
      if (!appInfo.lastExitClean) {
        const links = await bridge.listLinks();
        const dirty: Pending = [];
        for (const link of links) {
          const fp = await fingerprintProject(link.projectId).catch(() => null);
          const p = useStudio.getState().projects.find((x) => x.id === link.projectId);
          if (fp && p && fp !== link.fingerprint) dirty.push({ title: p.title, projectId: p.id, linked: true });
        }
        const snapshots = await bridge.listRecovery();
        if (dirty.length || snapshots.length) setCrashReport({ dirty, snapshots });
      }
      if (ready.pendingOpen) await open(ready.pendingOpen);
    })();
  }, [bridge, open]);

  // ---- autosave: recovery snapshots (+ optional project file) ----
  useEffect(() => {
    if (!settings?.autosave.enabled || !projectId) return;
    const id = projectId;
    const timer = setInterval(
      () =>
        void exclusive(async () => {
          const s = await statusOf(id).catch(() => null);
          if (!s?.fingerprint || !s.dirty || lastSnapshot.current.get(id) === s.fingerprint) return;
          try {
            await flushEditors().catch(() => {});
            if (settings.autosave.writeProjectFile && s.link) {
              const outcome = await saveProject(id, "save");
              if (outcome) baseline.current.set(id, outcome.fingerprint);
            } else lastSnapshot.current.set(id, await writeRecoverySnapshot(id));
          } catch (error) {
            toast(`Autosave failed: ${storageMessage(error)}`, "error");
          }
        }),
      settings.autosave.intervalMinutes * 60_000,
    );
    return () => clearInterval(timer);
  }, [exclusive, projectId, settings, statusOf, toast]);

  // ---- keyboard shortcuts (bubble phase: editors handle their own keys first) ----
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, MenuCommand | undefined> = {
        n: e.shiftKey ? undefined : "new-project",
        o: e.shiftKey ? undefined : "open-project",
        s: e.shiftKey ? "save-as" : "save",
        ",": "settings",
        "=": "zoom-in",
        "+": "zoom-in",
        "-": "zoom-out",
        "0": "zoom-fit",
      };
      const cmd = map[k];
      if (!cmd) return;
      if (cmd.startsWith("zoom") && e.defaultPrevented) return;
      e.preventDefault();
      void command(cmd);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [command]);

  // ---- drag and drop .inkstrip files ----
  useEffect(() => {
    const isProject = (name: string) => /\.inkstrip(-project)?$/i.test(name);
    const over = (e: DragEvent) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => isProject(f.name));
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      void bridge
        .tokenForDroppedFile(file)
        .then((ref) => (ref ? open(ref) : toast("That file could not be opened.", "error")))
        .catch((err) => toast(storageMessage(err), "error"));
    };
    window.addEventListener("dragover", over, true);
    window.addEventListener("drop", drop, true);
    return () => {
      window.removeEventListener("dragover", over, true);
      window.removeEventListener("drop", drop, true);
    };
  }, [bridge, open, toast]);

  const installUpdate = useCallback(async () => {
    if (!(await prepareToLeave("update"))) return;
    try {
      await bridge.installUpdate();
    } catch (error) {
      toast(storageMessage(error), "error");
    }
  }, [bridge, prepareToLeave, toast]);

  const showUpdateCard =
    update &&
    dialog !== "updates" &&
    (update.status === "available" || update.status === "downloading" || update.status === "downloaded") &&
    updateDismissed !== `${update.status}:${"version" in update ? update.version : ""}`;

  return (
    <>
      {project && status ? (
        <DesktopStatusBar
          status={status}
          busy={!!busy}
          onSave={() => void save("save")}
          onSaveAs={() => void save("save-as")}
        />
      ) : null}

      {busy ? (
        <div className="desktop-busy" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm text-fg">{busy.label}</p>
            <p className="truncate text-xs text-muted">{busy.stage}</p>
            <div className="desktop-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="desktop-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`desktop-toast desktop-toast-${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            {t.tone === "ok" ? <CheckCircle2 className="size-4 shrink-0" /> : t.tone === "error" ? <CircleAlert className="size-4 shrink-0" /> : null}
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {showUpdateCard && update ? (
        <UpdateCard
          state={update}
          onDownload={() => void bridge.downloadUpdate().then(setUpdate)}
          onCancel={() => void bridge.cancelUpdateDownload().then(setUpdate)}
          onInstall={() => void installUpdate()}
          onNotes={() => setDialog("updates")}
          onDismiss={() => setUpdateDismissed(`${update.status}:${"version" in update ? update.version : ""}`)}
          onPage={(url) => void bridge.openExternal(url)}
        />
      ) : null}

      {conflict ? <ConflictDialog conflict={conflict.conflict} onChoose={(c) => conflict.resolve(c)} /> : null}

      {closePrompt ? (
        <Modal
          open
          onOpenChange={(o) => !o && closePrompt.resolve("cancel")}
          title={closePrompt.reason === "update" ? "Save before updating?" : "Save changes before closing?"}
          description="These projects have changes that are not in an .inkstrip file yet. Nothing is lost if you don't save: the changes stay in your Inkstrip workspace and you can save them later."
        >
          <ul className="desktop-list">
            {closePrompt.pending.map((p) => (
              <li key={p.projectId}>
                <FileWarning className="size-4 text-accent" />
                <span className="truncate">{p.title}</span>
                <span className="text-xs text-muted">{p.linked ? "unsaved changes" : "never saved to a file"}</span>
              </li>
            ))}
          </ul>
          <div className="desktop-actions">
            <Button variant="ghost" onClick={() => closePrompt.resolve("cancel")}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => closePrompt.resolve("discard")}>
              {closePrompt.reason === "update" ? "Update without saving to file" : "Close without saving to file"}
            </Button>
            <Button intent="save" onClick={() => closePrompt.resolve("save")}>
              <Save className="size-4" /> Save
            </Button>
          </div>
        </Modal>
      ) : null}

      <Modal
        open={revertConfirm}
        onOpenChange={setRevertConfirm}
        title="Revert to the saved file?"
        description="Changes made since the last save are replaced by the saved file. A copy of the current workspace version is kept in Recover Autosaved Work."
      >
        <div className="desktop-actions">
          <Button variant="ghost" onClick={() => setRevertConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setRevertConfirm(false);
              if (!projectId) return;
              void exclusive(async () => {
                setBusy({ label: "Reverting", stage: "Reading the saved file", fraction: 0.3 });
                try {
                  await revertToSaved(projectId);
                  baseline.current.delete(projectId);
                  toast("Reverted to the saved file.", "ok");
                } catch (error) {
                  toast(storageMessage(error), "error");
                } finally {
                  setBusy(null);
                  void refresh();
                }
              });
            }}
          >
            Revert
          </Button>
        </div>
      </Modal>

      {crashReport ? (
        <Modal
          open
          onOpenChange={(o) => !o && setCrashReport(null)}
          title="Inkstrip didn't close normally"
          description="Your workspace was preserved. Editors restore their autosaved drafts when you reopen a page."
        >
          {crashReport.dirty.length ? (
            <>
              <p className="text-sm text-fg">Projects with changes not yet saved to their file:</p>
              <ul className="desktop-list">
                {crashReport.dirty.map((p) => (
                  <li key={p.projectId}>
                    <FileWarning className="size-4 text-accent" />
                    <span className="truncate">{p.title}</span>
                    <Button size="sm" variant="secondary" onClick={() => void save("save", p.projectId)}>
                      Save now
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {crashReport.snapshots.length ? (
            <p className="mt-3 text-sm text-muted">
              {crashReport.snapshots.length} autosave snapshot{crashReport.snapshots.length === 1 ? " is" : "s are"} also available.
            </p>
          ) : null}
          <div className="desktop-actions">
            <Button variant="secondary" onClick={() => (setCrashReport(null), setDialog("recovery"))}>
              Review autosaves
            </Button>
            <Button onClick={() => setCrashReport(null)}>Continue</Button>
          </div>
        </Modal>
      ) : null}

      {dialog === "settings" && settings ? (
        <SettingsDialog
          settings={settings}
          onClose={() => setDialog(null)}
          onChange={async (patch) => setSettings(await bridge.setSettings(patch))}
          toast={toast}
        />
      ) : null}
      {dialog === "recovery" ? <RecoveryDialog onClose={() => setDialog(null)} onOpen={(ref) => (setDialog(null), void open(ref))} /> : null}
      {dialog === "backups" ? (
        <BackupsDialog projectId={projectId} onClose={() => setDialog(null)} onOpen={(ref) => (setDialog(null), void open(ref))} />
      ) : null}
      {dialog === "about" && info ? <AboutDialog info={info} onClose={() => setDialog(null)} /> : null}
      {dialog === "updates" ? (
        <UpdatesDialog
          state={update}
          info={info}
          onClose={() => setDialog(null)}
          onCheck={() => void bridge.checkForUpdates().then(setUpdate)}
          onDownload={() => void bridge.downloadUpdate().then(setUpdate)}
          onCancel={() => void bridge.cancelUpdateDownload().then(setUpdate)}
          onInstall={() => void installUpdate()}
          onPage={(url) => void bridge.openExternal(url)}
        />
      ) : null}
    </>
  );
}

function DesktopStatusBar({
  status,
  busy,
  onSave,
  onSaveAs,
}: {
  status: ProjectStatus;
  busy: boolean;
  onSave: () => void;
  onSaveAs: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const linked = status.link && !(status.link.file.size === 0 && status.link.file.modifiedAt === 0);
  return (
    <div className="desktop-statusbar" data-dirty={status.dirty || undefined}>
      {linked ? (
        <span className="truncate" title={status.link!.file.path}>
          {status.dirty ? "● Unsaved changes · " : "Saved · "}
          {status.link!.file.name}
          {status.dirty ? "" : ` · ${timeAgo(status.link!.savedAt)}`}
        </span>
      ) : status.link ? (
        <span className="truncate text-danger">The saved file was moved or deleted · use Save As</span>
      ) : (
        <span className="truncate">Not saved to a file yet</span>
      )}
      <button type="button" className="focus-ring" disabled={busy} onClick={linked ? onSave : onSaveAs} title={linked ? "Save (Ctrl+S)" : "Save As (Ctrl+Shift+S)"}>
        <Save className="size-3.5" /> {linked ? "Save" : "Save as…"}
      </button>
    </div>
  );
}

function ConflictDialog({ conflict, onChoose }: { conflict: OpenConflict; onChoose: (c: ConflictChoice) => void }) {
  const text =
    conflict.reason === "unsaved"
      ? "Your workspace copy of this project has changes that were never saved to this file."
      : conflict.reason === "other-file"
        ? `Your workspace copy of this project is saved to a different file${conflict.linkedPath ? ` (${conflict.linkedPath})` : ""}.`
        : "This project is already in your workspace but has never been saved to a file.";
  return (
    <Modal open onOpenChange={(o) => !o && onChoose("cancel")} title={`Open “${conflict.title}”`} description={text}>
      <p className="text-sm text-muted">
        Opening the file replaces the workspace copy. The current workspace copy is kept first in Recover Autosaved Work, so
        nothing is lost.
      </p>
      <div className="desktop-actions">
        <Button variant="ghost" onClick={() => onChoose("cancel")}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => onChoose("keep")}>
          Keep workspace version
        </Button>
        <Button onClick={() => onChoose("replace")}>Open the file</Button>
      </div>
    </Modal>
  );
}

function UpdateCard({
  state,
  onDownload,
  onCancel,
  onInstall,
  onNotes,
  onDismiss,
  onPage,
}: {
  state: UpdateState;
  onDownload: () => void;
  onCancel: () => void;
  onInstall: () => void;
  onNotes: () => void;
  onDismiss: () => void;
  onPage: (url: string) => void;
}) {
  return (
    <aside className="desktop-update" aria-label="Software update">
      <button type="button" className="desktop-update-close focus-ring" aria-label="Later" onClick={onDismiss}>
        <X className="size-4" />
      </button>
      {state.status === "available" ? (
        <>
          <p className="font-medium text-fg">Inkstrip {state.version} is available</p>
          <p className="text-xs text-muted">
            {state.installable ? "A verified update from the official release channel." : "This test build can't install updates automatically."}
          </p>
          <div className="desktop-actions">
            <Button size="sm" variant="ghost" onClick={onNotes}>
              Release notes
            </Button>
            {state.installable ? (
              <Button size="sm" onClick={onDownload}>
                <Download className="size-4" /> Download
              </Button>
            ) : (
              <Button size="sm" onClick={() => onPage(state.pageUrl)}>
                Open release page
              </Button>
            )}
          </div>
        </>
      ) : state.status === "downloading" ? (
        <>
          <p className="font-medium text-fg">Downloading Inkstrip {state.version}…</p>
          <div className="desktop-progress" aria-label={`${Math.round(state.percent)}%`}>
            <span style={{ width: `${state.percent}%` }} />
          </div>
          <p className="text-xs text-muted">
            {Math.round(state.percent)}%{state.total ? ` of ${size(state.total)}` : ""}
          </p>
          <div className="desktop-actions">
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : state.status === "downloaded" ? (
        <>
          <p className="font-medium text-fg">Inkstrip {state.version} is ready to install</p>
          <p className="text-xs text-muted">
            Verified. Inkstrip saves your work first, installs, and reopens. Projects, settings and backups are kept.
          </p>
          <div className="desktop-actions">
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Later
            </Button>
            <Button size="sm" onClick={onInstall}>
              <RefreshCw className="size-4" /> Install and Restart
            </Button>
          </div>
        </>
      ) : null}
    </aside>
  );
}

function UpdatesDialog({
  state,
  info,
  onClose,
  onCheck,
  onDownload,
  onCancel,
  onInstall,
  onPage,
}: {
  state: UpdateState | null;
  info: AppInfo | null;
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onInstall: () => void;
  onPage: (url: string) => void;
}) {
  let body: ReactNode = null;
  if (!state || state.status === "checking") body = <p className="text-sm text-muted">Checking for updates…</p>;
  else if (state.status === "disabled") body = <p className="text-sm text-muted">{state.reason}</p>;
  else if (state.status === "idle" || state.status === "not-available")
    body = <p className="text-sm text-fg">Inkstrip {info?.version} is the latest version.</p>;
  else if (state.status === "error") body = <p className={`text-sm ${state.offline ? "text-muted" : "text-danger"}`}>{state.message}</p>;
  else
    body = (
      <>
        <p className="text-sm text-fg">
          {state.status === "downloaded" ? `Version ${state.version} is downloaded and verified.` : `Version ${state.version} is available.`}
          {state.status === "available" && !state.installable ? " This test build cannot install it automatically." : ""}
        </p>
        {state.notes ? <pre className="desktop-notes">{state.notes}</pre> : null}
        {state.status === "downloading" ? (
          <div className="desktop-progress">
            <span style={{ width: `${state.percent}%` }} />
          </div>
        ) : null}
      </>
    );
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Software updates" description={`Installed version: ${info?.version ?? "…"}`} wide>
      {body}
      <div className="desktop-actions">
        {state?.status === "available" && !state.installable ? (
          <Button variant="secondary" onClick={() => onPage(state.pageUrl)}>
            Open release page
          </Button>
        ) : null}
        {state?.status === "downloading" ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel download
          </Button>
        ) : null}
        {state?.status === "available" && state.installable ? (
          <Button onClick={onDownload}>
            <HardDriveDownload className="size-4" /> Download update
          </Button>
        ) : null}
        {state?.status === "downloaded" ? (
          <Button onClick={onInstall}>
            <RefreshCw className="size-4" /> Install and Restart
          </Button>
        ) : null}
        {state && ["idle", "not-available", "error"].includes(state.status) ? (
          <Button variant="secondary" onClick={onCheck}>
            Check again
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

function SettingsDialog({
  settings,
  onClose,
  onChange,
  toast,
}: {
  settings: DesktopSettings;
  onClose: () => void;
  onChange: (patch: Parameters<NonNullable<ReturnType<typeof desktopBridge>>["setSettings"]>[0]) => Promise<void>;
  toast: (t: string, tone?: Toast["tone"]) => void;
}) {
  const bridge = desktopBridge()!;
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  useEffect(() => {
    void bridge.hasCloudKey().then(setHasKey);
  }, [bridge]);
  const toggle = (label: string, checked: boolean, change: (v: boolean) => void, hint?: string) => (
    <label className="desktop-setting">
      <input type="checkbox" checked={checked} onChange={(e) => change(e.target.checked)} />
      <span>
        <span className="text-sm text-fg">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Settings" wide>
      <div className="desktop-settings">
        <section>
          <h3>Autosave and recovery</h3>
          {toggle("Autosave", settings.autosave.enabled, (v) => void onChange({ autosave: { enabled: v } }), "Writes a recovery snapshot of the open project when it has unsaved changes.")}
          <label className="desktop-setting">
            <span className="text-sm text-fg">Every</span>
            <input
              className="field w-20"
              type="number"
              min={1}
              max={60}
              value={settings.autosave.intervalMinutes}
              onChange={(e) => void onChange({ autosave: { intervalMinutes: Number(e.target.value) } })}
            />
            <span className="text-sm text-muted">minutes</span>
          </label>
          {toggle(
            "Also save into the project file",
            settings.autosave.writeProjectFile,
            (v) => void onChange({ autosave: { writeProjectFile: v } }),
            "Off: your .inkstrip file changes only when you press Save.",
          )}
          <label className="desktop-setting">
            <span className="text-sm text-fg">Keep</span>
            <input
              className="field w-20"
              type="number"
              min={0}
              max={50}
              value={settings.backups.keep}
              onChange={(e) => void onChange({ backups: { keep: Number(e.target.value) } })}
            />
            <span className="text-sm text-muted">previous versions per project</span>
          </label>
        </section>
        <section>
          <h3>Updates</h3>
          {toggle("Check for updates automatically", settings.updates.autoCheck, (v) => void onChange({ updates: { autoCheck: v } }))}
          {toggle("Download updates automatically", settings.updates.autoDownload, (v) => void onChange({ updates: { autoDownload: v } }), "Installation always waits for you to click Install and Restart.")}
        </section>
        <section>
          <h3>Cloud AI (optional)</h3>
          <p className="text-xs text-muted">
            Off by default. When on, AI Erase / Face correction in cloud mode sends the selected region to OpenAI with your own
            API key. Local repair, enhancement and OCR never upload artwork.
          </p>
          {toggle("Allow cloud AI edits", settings.ai.cloudEnabled, (v) => void onChange({ ai: { cloudEnabled: v } }))}
          <div className="desktop-setting">
            <input
              className="field flex-1"
              type="password"
              autoComplete="off"
              placeholder={hasKey ? "A key is stored (encrypted with Windows)" : "OpenAI API key"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!key}
              onClick={() =>
                void bridge
                  .setCloudKey(key)
                  .then(() => (setKey(""), setHasKey(true), toast("Key stored securely.", "ok")))
                  .catch((e) => toast(storageMessage(e), "error"))
              }
            >
              Save key
            </Button>
            {hasKey ? (
              <Button size="sm" variant="danger" onClick={() => void bridge.setCloudKey(null).then(() => setHasKey(false))}>
                Remove
              </Button>
            ) : null}
          </div>
        </section>
        <section>
          <h3>Folders</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void bridge.openFolder("recovery")}>
              Recovery
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void bridge.openFolder("backups")}>
              Backups
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void bridge.openFolder("logs")}>
              Logs
            </Button>
          </div>
          {toggle("Developer tools", settings.developer.devTools, (v) => void onChange({ developer: { devTools: v } }), "Takes effect after restarting Inkstrip.")}
        </section>
      </div>
    </Modal>
  );
}

function RecoveryDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (ref: FileRef) => void }) {
  const bridge = desktopBridge()!;
  const [items, setItems] = useState<RecoverySnapshot[] | null>(null);
  const load = useCallback(() => void bridge.listRecovery().then(setItems), [bridge]);
  useEffect(load, [load]);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Recover autosaved work"
      description="Autosave snapshots and copies kept before a workspace project was replaced. Restoring asks before replacing anything."
      wide
    >
      {items === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No autosaved snapshots.</p>
      ) : (
        <ul className="desktop-list">
          {items.map((s) => (
            <li key={s.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{s.title}</span>
                <span className="block text-xs text-muted">
                  {new Date(s.createdAt).toLocaleString()} · {size(s.size)}
                  {s.linkedPath ? ` · file: ${s.linkedPath}` : ""}
                </span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => onOpen(s.file)}>
                Restore
              </Button>
              <Button size="sm" variant="danger" onClick={() => void bridge.discardRecovery(s.id).then(load)}>
                Discard
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="desktop-actions">
        <Button variant="secondary" onClick={() => void bridge.openFolder("recovery")}>
          Open folder
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function BackupsDialog({ projectId, onClose, onOpen }: { projectId: string | null; onClose: () => void; onOpen: (ref: FileRef) => void }) {
  const bridge = desktopBridge()!;
  const [items, setItems] = useState<FileRef[] | null>(null);
  useEffect(() => {
    if (projectId) void bridge.listBackups(projectId).then(setItems);
  }, [bridge, projectId]);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Project backups"
      description="Each Save keeps the previous version of the file here. Restoring asks before replacing the workspace copy."
      wide
    >
      {!projectId ? (
        <p className="text-sm text-muted">Open a project to see its backups.</p>
      ) : items === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No previous versions yet. They appear after you save over an existing file.</p>
      ) : (
        <ul className="desktop-list">
          {items.map((f) => (
            <li key={f.token}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{new Date(f.modifiedAt).toLocaleString()}</span>
                <span className="block text-xs text-muted">{size(f.size)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void bridge.revealFile(f.token)}>
                Show
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onOpen(f)}>
                Restore this version
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="desktop-actions">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function AboutDialog({ info, onClose }: { info: AppInfo; onClose: () => void }) {
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Inkstrip Manhwa Studio" description={`Version ${info.version}`}>
      <dl className="desktop-about">
        <dt>Build</dt>
        <dd>{info.commit.slice(0, 12)}</dd>
        <dt>Code signature</dt>
        <dd>{info.signed === "valid" ? "Signed" : info.signed === "unsigned" ? "Unsigned test build" : info.signed}</dd>
        <dt>Runtime</dt>
        <dd>
          Electron {info.electron} · Chromium {info.chrome}
        </dd>
        <dt>Workspace</dt>
        <dd>{info.locations.workspace}</dd>
        <dt>Settings</dt>
        <dd>{info.locations.settings}</dd>
        <dt>Recovery</dt>
        <dd>{info.locations.recovery}</dd>
        <dt>Backups</dt>
        <dd>{info.locations.backups}</dd>
      </dl>
      <p className="mt-3 text-xs text-muted">Works fully offline. Updates, AI model downloads and cloud AI are optional and need a connection.</p>
    </Modal>
  );
}
