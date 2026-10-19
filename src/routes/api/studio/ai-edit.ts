import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/studio/ai-edit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { imageEdit } = await import("@/lib/ai/image-edit.server");
        return imageEdit(request, {
          key: process.env.INKSTRIP_OPENAI_API_KEY,
          access: process.env.INKSTRIP_AI_ACCESS_TOKEN,
        });
      },
    },
  },
});
