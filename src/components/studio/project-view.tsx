import { ArtworkCover } from "./design/artwork-cover";
import { AppearanceButton } from "./design/preferences";
import { DepthSurface } from "./design/depth-surface";
import { Button } from "@/components/ui/button";
import { ConfirmButton, InlineTitle, Wordmark } from "@/components/studio/chrome";
import { useStudio } from "@/lib/studio/store";
import { countLabel } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Layers3,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

export function ProjectView({ projectId }: { projectId: string }) {
  const project = useStudio((state) => state.projects.find((item) => item.id === projectId));
  const allChapters = useStudio((state) => state.chapters);
  const chapters = useMemo(
    () =>
      allChapters
        .filter((chapter) => chapter.projectId === projectId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [allChapters, projectId],
  );
  const panels = useStudio((state) => state.panels);
  const renameProject = useStudio((state) => state.renameProject);
  const deleteProject = useStudio((state) => state.deleteProject);
  const createChapter = useStudio((state) => state.createChapter);
  const deleteChapter = useStudio((state) => state.deleteChapter);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  if (!project) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 pt-8">
        <Wordmark />
        <h1 className="mt-10 font-display text-3xl">This project is gone.</h1>
        <Link to="/" className="focus-ring mt-6 inline-flex h-11 items-center text-sm text-muted">
          Back to projects
        </Link>
      </main>
    );
  }

  return (
    <main className="project-workspace story-space mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-5 pt-6 pb-16">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="press focus-ring inline-flex h-11 items-center gap-1 rounded-sm text-sm text-muted"
        >
          <ChevronLeft className="size-4" />
          Projects
        </Link>
        <div className="flex items-center gap-2">
          <AppearanceButton />
          <ConfirmButton
            title="Delete project?"
            description="Every chapter and photo in this project is removed from this device."
            confirmLabel="Delete project"
            onConfirm={() => {
              void deleteProject(project.id).then(() => navigate({ to: "/" }));
            }}
            className="press focus-ring inline-flex h-11 items-center gap-2 rounded-sm px-2 text-sm text-subtle hover:text-danger"
          >
            <Trash2 className="size-4" />
            Delete
          </ConfirmButton>
        </div>
      </div>

      <div className="project-heading story-heading">
        <div className="story-heading-copy">
          <div className="project-icon mb-6 inline-flex">
            <BookOpen className="size-7" />
          </div>
          <p className="eyebrow mb-2">Your story / chapter library</p>
          <InlineTitle
            value={project.title}
            onSave={(value) => void renameProject(project.id, value)}
            className="mt-4 font-display text-4xl text-fg"
          />
          <p className="mt-3 max-w-md text-sm text-muted">
            Every chapter, a world of its own. Arrange your panels, restore the details, and find
            your story’s rhythm.
          </p>
        </div>
        <div className="story-cover">
          <DepthSurface>
            <ArtworkCover
              thumbId={
                panels
                  .filter((p) => chapters.some((c) => c.id === p.chapterId))
                  .sort((a, b) => a.order - b.order)[0]?.thumbId
              }
            />
          </DepthSurface>
          <span className="eyebrow">A WORLD IN PROGRESS</span>
        </div>
      </div>
      <div className="project-summary">
        <span>
          <Layers3 className="size-4" />
          {chapters.length} chapters
        </span>
        <span>
          <ShieldCheck className="size-4" />
          Saved on this device
        </span>
      </div>

      <div className="chapter-collection-heading mt-8">
        <div>
          <p className="eyebrow">THE SEQUENCE</p>
          <h2>Chapter library</h2>
        </div>
        <Button
          intent="create"
          disabled={creating}
          onClick={() => {
            setCreating(true);
            void createChapter(project.id)
              .then((chapterId) =>
                navigate({
                  to: "/p/$projectId/c/$chapterId",
                  params: { projectId: project.id, chapterId },
                }),
              )
              .finally(() => setCreating(false));
          }}
        >
          <Plus className="size-4" />
          {creating ? "Creating…" : "New chapter"}
        </Button>
      </div>

      {chapters.length === 0 ? (
        <p className="mt-10 text-muted">
          No chapters yet. Start with one and add photos inside it.
        </p>
      ) : (
        <ol className="chapter-collection mt-8 flex flex-col gap-3">
          {chapters.map((chapter, index) => {
            const count = panels.filter((panel) => panel.chapterId === chapter.id).length;
            return (
              <li key={chapter.id} className="flex items-stretch gap-2">
                <Link
                  to="/p/$projectId/c/$chapterId"
                  params={{ projectId: project.id, chapterId: chapter.id }}
                  className="chapter-card focus-ring flex min-w-0 flex-1 items-center gap-4 rounded-xl border border-border bg-bg-elevated p-5 hover:border-muted"
                >
                  <ArtworkCover
                    thumbId={
                      panels
                        .filter((p) => p.chapterId === chapter.id)
                        .sort((a, b) => a.order - b.order)[0]?.thumbId
                    }
                    index={index}
                  />
                  <span className="chapter-index w-10 shrink-0 font-display text-2xl text-subtle tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xl text-fg">
                      {chapter.title}
                    </span>
                    <span className="mt-1 block text-sm text-muted">
                      {countLabel(count, "photo")}
                      {chapter.strip ? " · page ready" : " · not stitched"}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-subtle" />
                </Link>
                <ConfirmButton
                  title={`Delete ${chapter.title}?`}
                  description="Photos in this chapter are removed from this device."
                  confirmLabel="Delete chapter"
                  onConfirm={() => void deleteChapter(chapter.id)}
                  className="press focus-ring rounded-xl border border-border px-3 text-subtle hover:text-danger"
                >
                  <span className="sr-only">Delete {chapter.title}</span>
                  <Trash2 className="size-4" />
                </ConfirmButton>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
