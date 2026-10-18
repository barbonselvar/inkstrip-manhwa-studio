import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useStudio } from "@/lib/studio/store";
import { countLabel, formatDay } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

export function Library() {
  const projects = useStudio((state) => state.projects);
  const chapters = useStudio((state) => state.chapters);
  const createProject = useStudio((state) => state.createProject);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const ordered = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

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
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 pt-8 pb-16">
      <p className="text-xs font-medium tracking-widest text-subtle uppercase">Studio</p>
      <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl text-fg sm:text-5xl">Inkstrip</h1>
          <p className="mt-3 max-w-md text-muted">
            Stitch photos into a tall vertical manhwa. Projects and chapters stay on this device.
          </p>
        </div>
        <Button className="w-full shrink-0 sm:w-auto" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          New project
        </Button>
      </div>

      {ordered.length === 0 ? (
        <section className="rise mt-14 rounded-xl border border-border bg-bg-elevated p-5">
          <PageStack />
          <h2 className="mt-6 font-display text-3xl text-fg">A long page, panel by panel.</h2>
          <p className="mt-3 max-w-md text-muted">
            Create a project, open Chapter 1, and stack as many photos as the chapter needs. Display
            stitches only the ones you check.
          </p>
        </section>
      ) : (
        <ul className="mt-10 flex flex-col gap-3">
          {ordered.map((project) => {
            const count = chapters.filter((chapter) => chapter.projectId === project.id).length;
            return (
              <li key={project.id} className="rise">
                <Link
                  to="/p/$projectId"
                  params={{ projectId: project.id }}
                  className="focus-ring flex items-center gap-4 rounded-xl border border-border bg-bg-elevated p-4 hover:border-muted"
                >
                  <span className="hidden h-14 w-1 shrink-0 rounded-full bg-paper sm:block" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-2xl text-fg">{project.title}</span>
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

      <p className="mt-10 text-sm text-subtle">Photos never leave this browser.</p>

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
  );
}

function PageStack() {
  return (
    <div className="relative h-24 w-16" aria-hidden>
      <div className="absolute top-2 left-3 h-20 w-14 rounded-sm bg-bg-subtle" />
      <div className="absolute top-1 left-1.5 h-20 w-14 rounded-sm border border-border bg-bg" />
      <div className="absolute top-0 left-0 flex h-20 w-14 flex-col gap-1 rounded-sm bg-paper p-1.5">
        <span className="h-2 w-full bg-ink" />
        <span className="h-6 w-full bg-ink/80" />
        <span className="h-4 w-full bg-ink/70" />
      </div>
    </div>
  );
}
