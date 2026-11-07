import { AuroraFlow } from "./design/aurora-flow";
import { CinematicGallery } from "./design/cinematic-gallery";
import { ArtworkCover } from "./design/artwork-cover";
import { DepthSurface } from "./design/depth-surface";
import { AppearanceButton } from "./design/preferences";
import { Wordmark } from "./chrome";
import { DownloadAppButton } from "./download-app";
import { storageMessage } from "@/lib/studio/db";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useStudio } from "@/lib/studio/store";
import { countLabel, formatDay } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { usePreloadChapterRoute } from "@/lib/studio/route-preload";
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
  Upload,
} from "lucide-react";
import { BACKUP_EXTENSION } from "@/lib/studio/backup";
import { importProject, requestPersistentStorage } from "@/lib/studio/backup-store";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

export function Library() {
  const projects = useStudio((state) => state.projects);
  const panels = useStudio((state) => state.panels);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== "/" ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        document.querySelector('[role="dialog"]') ||
        (e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      e.preventDefault();
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const chapters = useStudio((state) => state.chapters);
  const createProject = useStudio((state) => state.createProject);
  const backupInput = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const hasProjects = projects.length > 0;
  useEffect(() => {
    // Once there is work worth keeping, ask the browser not to evict it under storage pressure.
    if (hasProjects) void requestPersistentStorage();
  }, [hasProjects]);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  usePreloadChapterRoute(open);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ordered = [...projects]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((project) => project.title.toLowerCase().includes(search.toLowerCase()));

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const created = await createProject(title);
      setTitle("");
      setOpen(false);
      await navigate({
        to: "/p/$projectId/c/$chapterId",
        params: { projectId: created.projectId, chapterId: created.chapterId },
      });
    } catch (problem) {
      setError(storageMessage(problem));
    } finally {
      setSaving(false);
    }
  }

  async function onRestore(file: File | undefined) {
    if (!file || restoring) return;
    setRestoring(true);
    setRestoreError("");
    try {
      const projectId = await importProject(file);
      await navigate({ to: "/p/$projectId", params: { projectId } });
    } catch (problem) {
      setRestoreError(storageMessage(problem));
    } finally {
      setRestoring(false);
      if (backupInput.current) backupInput.current.value = "";
    }
  }

  return (
    <div className="studio-layout library-shell">
      <aside className="library-rail">
        <Wordmark />
        <p className="eyebrow rail-section-title">Your creative space</p>
        <nav aria-label="Workspace navigation">
          <a href="#workspace" className="rail-link active" aria-current="page">
            <PanelsTopLeft className="size-4" />
            My projects<span>{projects.length.toString().padStart(2, "0")}</span>
          </a>
          <a href="#workflow" className="rail-link">
            <WandSparkles className="size-4" />
            The studio
            <ArrowUpRight className="size-3" />
          </a>
        </nav>
        <div className="rail-note">
          <ShieldCheck className="size-5 text-accent" />
          <p>
            Your art.
            <br />
            Always yours.
          </p>
          <span>Local projects. Recoverable originals. Cloud AI only when you choose.</span>
        </div>
        <div className="rail-footer">
          <span className="status-dot" />A little space. A whole world.
        </div>
      </aside>
      <main id="workspace" tabIndex={-1} className="library-main library-content">
        <nav className="workspace-nav" aria-label="Library toolbar">
          <span className="workspace-breadcrumb">
            <span className="eyebrow">WORKSPACE</span>
            <ChevronRight className="size-3" />
            <span>My projects</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="status-pill">
              <span className="status-dot" />
              On-device studio
            </span>
            <AppearanceButton />
          </div>
        </nav>
        <section className="library-heading library-hero">
          <AuroraFlow />
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="mini-line" />A studio for visual storytellers
            </p>
            <h1 className="hero-title">
              Every frame.
              <br />
              <em>A world.</em>
            </h1>
            <p className="hero-description">
              From the first panel to the final scroll.
              <br />A considered space to create, refine, and tell your story.
            </p>
            <div className="hero-actions">
              <Button intent="create" className="new-project-button" onClick={() => setOpen(true)}>
                <Plus className="size-4" />
                New project
                <ArrowUpRight className="size-4" />
              </Button>
              <a className="hero-secondary focus-ring" href="#workflow">
                Explore the studio
                <ChevronRight className="size-4" />
              </a>
              <button
                type="button"
                className="hero-secondary focus-ring"
                disabled={restoring}
                onClick={() => backupInput.current?.click()}
              >
                <Upload className="size-4" />
                {restoring ? "Restoring…" : "Restore backup"}
              </button>
              <DownloadAppButton className="hero-secondary focus-ring" />
              <input
                ref={backupInput}
                type="file"
                accept={BACKUP_EXTENSION}
                hidden
                onChange={(e) => void onRestore(e.target.files?.[0])}
              />
            </div>
            {restoreError ? (
              <p role="alert" className="form-error">
                {restoreError}
              </p>
            ) : null}
            <div className="hero-footnote">
              <ShieldCheck className="size-3" />
              Your originals always have a way home.
            </div>
          </div>
          <div className="hero-art">
            <CinematicGallery />
          </div>
        </section>
        <div className="studio-stats library-metrics">
          <div>
            <span className="metric-icon">
              <BookOpen className="size-4" />
            </span>
            <AnimatedMetric value={projects.length} />
            <span>Projects</span>
          </div>
          <div>
            <span className="metric-icon">
              <Layers3 className="size-4" />
            </span>
            <AnimatedMetric value={chapters.length} />
            <span>Chapters</span>
          </div>
          <div>
            <span className="metric-icon">
              <Sparkles className="size-4" />
            </span>
            <AnimatedMetric value={panels.length} />
            <span>Panels</span>
          </div>
          <span className="metrics-note">A collection of worlds in the making.</span>
        </div>
        <div className="projects-toolbar">
          <div>
            <p className="eyebrow">THE LIBRARY</p>
            <h2 className="font-display text-2xl">
              Your projects <span className="project-count">{projects.length}</span>
            </h2>
          </div>
          <label className="project-search">
            <Search className="size-4" />
            <input
              ref={searchInput}
              aria-label="Search projects"
              placeholder="Find a story…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </label>
        </div>
        {ordered.length === 0 ? (
          <section className="empty-project library-empty">
            <div className="empty-illustration" aria-hidden="true">
              <span />
              <span />
              <span>
                <BookOpen />
              </span>
            </div>
            <div>
              <p className="eyebrow">{search ? "NO MATCHES" : "YOUR FIRST CHAPTER"}</p>
              <h2>{search ? "A different title, perhaps?" : "Make something worth scrolling."}</h2>
              <p>
                {search
                  ? "No projects match your search. Try another title."
                  : "Bring your panels. We’ll give them room to become a story."}
              </p>
              {!search ? (
                <Button variant="secondary" onClick={() => setOpen(true)}>
                  <Plus className="size-4" />
                  Create your first project
                  <ArrowUpRight className="size-4" />
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              )}
            </div>
            <span className="empty-annotation" aria-hidden="true">
              01 — IT STARTS HERE
            </span>
          </section>
        ) : (
          <ul className="project-grid project-shelf">
            {ordered.map((project, index) => {
              const projectChapters = chapters.filter((c) => c.projectId === project.id),
                ids = new Set(projectChapters.map((c) => c.id));
              const cover = panels
                .filter((p) => ids.has(p.chapterId))
                .sort((a, b) => a.order - b.order)[0];
              return (
                <li
                  key={project.id}
                  style={{ "--motion-index": Math.min(index, 8) } as CSSProperties}
                >
                  <DepthSurface>
                    <Link
                      to="/p/$projectId"
                      params={{ projectId: project.id }}
                      className="project-card project-shelf-card focus-ring"
                    >
                      <ArtworkCover thumbId={cover?.thumbId} index={index} />
                      <span className="project-card-info">
                        <span className="project-card-title">
                          {project.title}
                          <ArrowUpRight className="size-4" />
                        </span>
                        <span className="project-card-meta">
                          {countLabel(projectChapters.length, "chapter")}
                          <span>Edited {formatDay(project.updatedAt)}</span>
                        </span>
                      </span>
                    </Link>
                  </DepthSurface>
                </li>
              );
            })}
          </ul>
        )}
        <section id="workflow" className="workflow-section">
          <div className="workflow-heading">
            <p className="eyebrow">FROM AN IDEA TO AN INFINITE SCROLL</p>
            <h2>Your story. Your rhythm.</h2>
            <p>Thoughtful tools, out of the way until you need them.</p>
          </div>
          <div className="workflow-grid">
            {[
              {
                n: "01",
                icon: Layers3,
                title: "Set the scene.",
                body: "Import your artwork. Reorder panels with a touch. Give every moment its space.",
                tag: "COMPOSE",
              },
              {
                n: "02",
                icon: WandSparkles,
                title: "Find the finer detail.",
                body: "Precise edits, local AI enhancement, and character references. Always with originals intact.",
                tag: "REFINE",
              },
              {
                n: "03",
                icon: BookOpen,
                title: "Let the story unfold.",
                body: "One continuous chapter. Compare, read, and export the version you’re ready to share.",
                tag: "PUBLISH",
              },
            ].map((item) => (
              <DepthSurface key={item.n} className="workflow-card-depth">
                <div className="workflow-card" data-feature={item.tag.toLowerCase()}>
                  <span>
                    {item.n} / {item.tag}
                  </span>
                  <item.icon className="size-5" />
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </DepthSurface>
            ))}
          </div>
        </section>
        <footer className="studio-footer">
          <Wordmark />
          <span>Made for the stories only you can tell.</span>
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-3" />
            Private by choice. Local by default.
          </span>
        </footer>
        <nav className="mobile-library-nav" aria-label="Mobile workspace navigation">
          <a href="#workspace" aria-current="page">
            <PanelsTopLeft className="size-4" />
            Library
          </a>
          <button type="button" onClick={() => setOpen(true)}>
            <Plus className="size-5" />
            <span>New story</span>
          </button>
          <a href="#workflow">
            <WandSparkles className="size-4" />
            Studio
          </a>
        </nav>
        <Modal
          open={open}
          onOpenChange={setOpen}
          title="New project"
          description="Every world begins with a first chapter."
        >
          <form onSubmit={(event) => void onCreate(event)} className="flex flex-col gap-4">
            <label className="editor-field-label">
              Project title
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Night Market"
                className="field"
                maxLength={80}
              />
            </label>
            <p className="form-note">
              <Layers3 className="size-4" />
              Chapter 1 will be ready for your first panels.
            </p>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            <Button intent="create" type="submit" disabled={saving}>
              <Plus className="size-4" />
              {saving ? "Creating…" : "Create chapter 1"}
            </Button>
          </form>
        </Modal>
      </main>
    </div>
  );
}

function AnimatedMetric({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const lastValue = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      lastValue.current = value;
      setDisplayValue(value);
      return;
    }
    const startValue = lastValue.current;
    const startTime = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / 620);
      const eased = 1 - (1 - progress) ** 4;
      const next = Math.round(startValue + (value - startValue) * eased);
      lastValue.current = next;
      setDisplayValue(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <strong>{String(displayValue).padStart(2, "0")}</strong>;
}
