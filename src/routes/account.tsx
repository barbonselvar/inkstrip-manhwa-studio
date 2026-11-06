import { createFileRoute } from "@tanstack/react-router";
import { AccountPage } from "@/components/accounts/account-page";
export const Route = createFileRoute("/account")({
  validateSearch: (s: Record<string, unknown>): { notice?: string } => ({
    notice:
      typeof s.notice === "string" &&
      ["oauth_cancelled", "identity_mismatch", "oauth_failed"].includes(s.notice)
        ? s.notice
        : undefined,
  }),
  head: () => ({
    meta: [{ title: "Your account · Inkstrip" }, { name: "robots", content: "noindex" }],
  }),
  component: AccountRoute,
});
function AccountRoute() {
  const { notice } = Route.useSearch();
  return <AccountPage notice={notice} />;
}
