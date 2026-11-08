/** Library header for the desktop app: open/import project files and recent projects. */
import "@/desktop.css";
import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/lib/desktop/bridge";
import type { RecentProject } from "@/lib/desktop/contract";
import { FileUp, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const send = (command: "open-project" | "import-backup" | "new-project") =>
  window.dispatchEvent(new CustomEvent("inkstrip:desktop-command", { detail: command }));

export function DesktopLibraryPanel() {
  const bridge = desktopBridge();
  const [recent, setRecent] = useState<RecentProject[]>([]);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const load = () => void bridge.recentProjects().then((r) => alive && setRecent(r));
    load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [bridge]);
  if (!bridge) return null;
  return (
    <section className="desktop-library" aria-label="Project files">
      <div className="desktop-library-actions">
        <Button variant="secondary" onClick={() => send("open-project")}>
          <FolderOpen className="size-4" /> Open project… <kbd>Ctrl+O</kbd>
        </Button>
        <Button variant="ghost" onClick={() => send("import-backup")}>
          <FileUp className="size-4" /> Import website backup…
        </Button>
      </div>
      {recent.length ? (
        <div>
          <p className="eyebrow">RECENT PROJECT FILES</p>
          <ul className="desktop-recent">
            {recent.slice(0, 8).map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  className="focus-ring"
                  disabled={!r.file}
                  title={r.path}
                  onClick={() => r.file && window.dispatchEvent(new CustomEvent("inkstrip:desktop-open", { detail: r.file }))}
                >
                  <span className="truncate text-sm text-fg">{r.title || r.path}</span>
                  <span className="truncate text-xs text-muted">{r.missing ? "Moved or deleted" : r.path}</span>
                </button>
                <button
                  type="button"
                  className="focus-ring desktop-recent-remove"
                  aria-label={`Remove ${r.title} from recent projects`}
                  onClick={() => void bridge.removeRecent(r.path).then(() => setRecent((all) => all.filter((x) => x.path !== r.path)))}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
