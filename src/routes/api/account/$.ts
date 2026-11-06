import { createFileRoute } from "@tanstack/react-router";
const handle = async ({ request }: { request: Request }) => {
  const { handleAccount } = await import("@/lib/accounts/server.server");
  return handleAccount(request);
};
export const Route = createFileRoute("/api/account/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
