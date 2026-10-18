import { ProjectView } from "@/components/studio/project-view";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$projectId/")({
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  return <ProjectView projectId={projectId} />;
}
