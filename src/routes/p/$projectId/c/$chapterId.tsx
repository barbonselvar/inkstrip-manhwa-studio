import { ChapterStudio } from "@/components/studio/chapter-studio";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$projectId/c/$chapterId")({
  component: ChapterPage,
});

function ChapterPage() {
  const { projectId, chapterId } = Route.useParams();
  return <ChapterStudio projectId={projectId} chapterId={chapterId} />;
}
