import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useStudio } from "@/lib/studio/store";
import { countLabel, formatDay } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Plus,
  Layers3,
  Sparkles,
  ShieldCheck,
  Search,
  PanelsTopLeft,
  WandSparkles,
} from "lucide-react";
import { useState, type FormEvent } from "react";

export function Library() {
  const projects = useStudio((state) => state.projects);
  const panels = useStudio((state) => state.panels);
  const [search, setSearch] = useState("");
  const chapters = useStudio((state) => state.chapters);
  const createProject = useStudio((state) => state.createProject);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const ordered = [...projects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((project) => project.title.toLowerCase().includes(search.toLowerCase()));

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const created = await createProject(title);
      setTitle("");
      setOpen(false);
      await navigate({
        to: "/p/$projectId/c/$chapterId",
        params: { projectId: created.projectId, chapterId: created.chapterId },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="studio-layout">
      <aside className="library-rail">
        <a href="#workspace" className="brand-lockup">
          <span className="brand-symbol">
            <Layers3 className="size-5" />
          </span>
          <span>
            inkstrip<span className="brand-dot">.</span>
          </span>
        </a>
        <p className="eyebrow mt-12">Workspace</p>
        <a href="#workspace" className="rail-link active">
          <PanelsTopLeft className="size-4" />
          My projects<span>{projects.length}</span>
        </a>
        <a href="#workflow" className="rail-link">
          <WandSparkles className="size-4" />
          Studio workflow
          <ArrowUpRight className="size-3" />
        </a>
        <div className="rail-note">
          <ShieldCheck className="size-5 text-accent" />
          <p className="mt-3 text-sm text-fg">Your art. Your device.</p>
          <p className="mt-2 text-xs text-muted">
            Projects stay in your browser. Local tools run on-device; cloud AI is optional.
          </p>
        </div>
        <p className="rail-footer">INKSTRIP / MANHWA STUDIO</p>
      </aside>
      <main id="workspace" className="library-main">
        <nav className="workspace-nav">
          <span className="text-sm text-muted">
            Workspace <span className="mx-2 text-subtle">/</span>
            <span className="text-fg">My projects</span>
          </span>
          <span className="status-pill">
            <span className="status-dot" />
            On-device studio
          </span>
        </nav>
        <section className="library-heading rise">
          <div>
            <p className="eyebrow flex items-center gap-2">
              <span className="mini-line" />A new chapter starts here
            </p>
            <h1 className="mt-4 font-display text-4xl text-fg sm:text-5xl">
              Stories worth
              <br />
              <span className="text-accent">scrolling for.</span>
            </h1>
            <p className="mt-4 max-w-md text-muted">
              From raw panels to a seamless manhwa. Shape your story, restore the details, and make
              every frame count.
            </p>
          </div>
          <Button className="new-project-button" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New project
            <ArrowUpRight className="ml-3 size-4" />
          </Button>
        </section>
        <div className="studio-stats">
          <div>
            <BookOpen className="size-4" />
            <strong>{projects.length.toString().padStart(2, "0")}</strong>
            <span>Projects</span>
          </div>
          <div>
            <Layers3 className="size-4" />
            <strong>{chapters.length.toString().padStart(2, "0")}</strong>
            <span>Chapters</span>
          </div>
          <div>
            <Sparkles className="size-4" />
            <strong>{panels.length.toString().padStart(2, "0")}</strong>
            <span>Panels</span>
          </div>
        </div>
        <div className="projects-toolbar">
          <h2 className="font-display text-xl">
            Your projects <span className="ml-2 text-sm text-subtle">{projects.length}</span>
          </h2>
          <label className="project-search">
            <Search className="size-4" />
            <input
              aria-label="Search projects"
              placeholder="Find a story…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {ordered.length === 0 ? (
          <section className="empty-project rise">
            <div className="empty-project-symbol">
              <BookOpen className="size-8" />
            </div>
            <h2 className="mt-6 font-display text-3xl text-fg">Your next world is waiting.</h2>
            <p className="mt-3 max-w-md text-muted">
              {search
                ? "No projects match your search. Try another title."
                : "Start with a project. Add your panels, refine the details, and stitch a chapter that flows."}
            </p>
            {!search ? (
              <Button variant="secondary" className="mt-6" onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                Create your first project
              </Button>
            ) : null}
          </section>
        ) : (
          <ul className="project-grid">
            {ordered.map((project) => {
              const count = chapters.filter((chapter) => chapter.projectId === project.id).length;
              return (
                <li key={project.id} className="rise">
                  <Link
                    to="/p/$projectId"
                    params={{ projectId: project.id }}
                    className="project-card focus-ring"
                  >
                    <span className="project-icon" aria-hidden>
                      <BookOpen className="size-6" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-2xl text-fg">
                        {project.title}
                      </span>
                      <span className="mt-1 block text-sm text-muted tabular-nums">
                        {countLabel(count, "chapter")} · Updated {formatDay(project.updatedAt)}
                      </span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-subtle" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <section id="workflow" className="workflow-section">
          <p className="eyebrow">Made for your creative flow</p>
          <div className="workflow-grid">
            <div>
              <span>01 / COMPOSE</span>
              <Layers3 className="size-5" />
              <h3>Panel by panel.</h3>
              <p>Import, reorder, and select. Every frame in its right place.</p>
            </div>
            <div>
              <span>02 / RESTORE</span>
              <Sparkles className="size-5" />
              <h3>Bring detail forward.</h3>
              <p>Real on-device AI. Compare, enhance, or recover the original.</p>
            </div>
            <div>
              <span>03 / DISPLAY</span>
              <BookOpen className="size-5" />
              <h3>One seamless story.</h3>
              <p>Stitch your chapter. Read the full scroll. Export and share.</p>
            </div>
          </div>
        </section>
        <footer className="studio-footer">
          <span>Built for the stories only you can tell.</span>
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-3" />
            Private by design
          </span>
        </footer>

        <Modal
          open={open}
          onOpenChange={setOpen}
          title="New project"
          description="Chapter 1 is created with it, ready for photos."
        >
          <form onSubmit={(event) => void onCreate(event)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-muted">
              Title
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Night Market"
                className="field"
                maxLength={80}
              />
            </label>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create chapter 1"}
            </Button>
          </form>
        </Modal>
      </main>
    </div>
  );
}
