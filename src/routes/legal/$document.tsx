import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import "@/components/accounts/accounts.css";
export const Route = createFileRoute("/legal/$document")({
  beforeLoad: ({ params }) => {
    if (!["terms", "privacy"].includes(params.document)) throw notFound();
  },
  head: ({ params }) => ({
    meta: [{ title: `${params.document === "privacy" ? "Privacy" : "Terms"} · Inkstrip` }],
  }),
  component: Legal,
});
function Legal() {
  const { document } = Route.useParams();
  return (
    <main className="account-page">
      <header className="account-header">
        <Link to="/" className="wordmark">
          Inkstrip.
        </Link>
        <Link to="/account" className="account-back">
          Your account
        </Link>
      </header>
      <article className="account-legal">
        <p className="account-kicker">EFFECTIVE NOVEMBER 6, 2026</p>
        {document === "privacy" ? (
          <>
            <h1>Your stories. Your privacy.</h1>
            <p>
              The local Inkstrip editor stores projects and artwork in this browser. Creating an
              account does not upload them. Local data may be accessible to other people using the
              same browser profile.
            </p>
            <h2>Account information</h2>
            <p>
              When cloud accounts are enabled, Supabase processes authentication credentials, email
              verification and recovery requests. Inkstrip stores your user ID, email, display name,
              optional avatar URL, connected provider names, preferences and timestamps. Passwords
              remain managed by Supabase Auth. Google and Facebook sign-in use the provider’s
              consent process; Inkstrip never asks for your provider password.
            </p>
            <h2>Private cloud copies</h2>
            <p>
              Only projects you explicitly select and confirm are uploaded. Cloud packages include
              the selected project’s original images, chapter metadata, editing documents,
              composition layers and associated assets and presets. Private storage and database
              ownership policies restrict access to the authenticated owner. This is
              access-controlled storage, not end-to-end encryption. Authorized service operators and
              infrastructure providers may process stored data to operate the service.
            </p>
            <h2>Sessions and security</h2>
            <p>
              Necessary HttpOnly cookies maintain your session and protect account requests. A small
              account-scoped transfer journal in browser storage supports interrupted uploads.
              Security event records contain event names, outcomes, request identifiers and, where
              needed, account IDs. Passwords, verification codes and session tokens are not written
              to application logs. Rate limits use keyed hashes of request subjects.
            </p>
            <h2>Controls and retention</h2>
            <p>
              You can edit your profile, download verified project packages, sign out and request
              cloud account deletion from your account area. Deletion removes active cloud files,
              project records and your account. Infrastructure backups and security records follow
              the configured provider retention periods; security records do not contain artwork or
              passwords. Local copies remain until you remove them yourself. Disabling an account
              does not remove browser-local projects.
            </p>
            <h2>External services and questions</h2>
            <p>
              Email delivery and Google/Facebook sign-in involve their respective providers and
              privacy policies. An externally hosted avatar is loaded directly from the URL you
              supply. For privacy or data access questions, contact the repository maintainer
              through the{" "}
              <a
                href="https://github.com/barbonselvar/inkstrip-manhwa-studio"
                target="_blank"
                rel="noreferrer"
              >
                Inkstrip repository
              </a>
              . Do not post private account information or artwork in public issues.
            </p>
          </>
        ) : (
          <>
            <h1>Terms of use</h1>
            <p>
              Inkstrip is a creative editing application. These terms cover use of its optional
              cloud account features. The local editing tools remain available without signing in.
            </p>
            <h2>Your work belongs to you</h2>
            <p>
              You retain ownership of your artwork and projects. You grant the service permission to
              store, process and deliver the material you explicitly upload so that the cloud
              features can work. Upload only material you have permission to use. Do not use the
              service for unlawful activity, malicious files or unauthorized access.
            </p>
            <h2>Your account</h2>
            <p>
              Provide accurate account information, verify your email and protect your credentials.
              Do not upload another person’s browser-local projects to your account without
              authorization. Provider sign-in is subject to the provider’s own terms and consent
              process.
            </p>
            <h2>Backups and availability</h2>
            <p>
              Keep independent backups of important work. Browser storage can be cleared by the
              browser or device owner. Cloud availability, quotas and retention depend on the
              configured infrastructure. The application provides download and explicit migration
              controls, but cannot guarantee uninterrupted service or recovery of every lost file.
            </p>
            <h2>Changes and deletion</h2>
            <p>
              You can stop using cloud features, download your projects and delete your cloud
              account in the account area after confirming your identity. Deletion is permanent for
              active cloud data and does not delete local copies. Material changes to these terms
              should be communicated before they apply to continued cloud use.
            </p>
            <h2>Service limitations</h2>
            <p>
              The application is provided as available, to the extent permitted by applicable law.
              Nothing in these terms limits rights that cannot legally be excluded. For questions,
              use the{" "}
              <a
                href="https://github.com/barbonselvar/inkstrip-manhwa-studio"
                target="_blank"
                rel="noreferrer"
              >
                Inkstrip repository
              </a>{" "}
              to contact the maintainer without publishing private information.
            </p>
          </>
        )}
        <p>
          <Link to="/account">Return to your account →</Link>
        </p>
      </article>
    </main>
  );
}
