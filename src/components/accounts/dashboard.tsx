import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Cloud,
  Upload,
  Download,
  LogOut,
  ShieldCheck,
  RefreshCw,
  X,
  ArrowUpRight,
  Check,
  HardDrive,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useStudio } from "@/lib/studio/store";
import { accountGet, accountPost, AccountError } from "@/lib/accounts/client";
import {
  uploadLocalProject,
  restoreCloudProject,
  downloadCloudProject,
} from "@/lib/accounts/transfers";
import {
  strongPassword,
  type AccountStatus,
  type AccountUser,
  type CloudProject,
} from "@/lib/accounts/policy";
import { PasswordField } from "./account-page";
const pretty = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;
export function AccountDashboard({
  user,
  status,
  onRefresh,
  onLogout,
  onOAuth,
}: {
  user: AccountUser;
  status: AccountStatus;
  onRefresh: () => Promise<AccountStatus>;
  onLogout: () => void;
  onOAuth: (p: "google" | "facebook", purpose?: string) => void;
}) {
  const local = useStudio((s) => s.projects),
    chapters = useStudio((s) => s.chapters),
    panels = useStudio((s) => s.panels),
    ready = useStudio((s) => s.ready);
  const [projects, setProjects] = useState<CloudProject[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState({ stage: "", done: 0, total: 0 }),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState<string | null>(null),
    [name, setName] = useState(user.name),
    [avatar, setAvatar] = useState(user.avatar ?? ""),
    [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [deletion, setDeletion] = useState(""),
    [fresh, setFresh] = useState(status.fresh),
    [compactProjects, setCompactProjects] = useState(user.preferences.compactProjects === true);
  const task = useRef<AbortController | null>(null),
    alive = useRef(true);
  const load = useCallback(async () => {
    if (user.deleting) return;
    const r = await accountGet<{ projects: CloudProject[] }>("projects");
    if (alive.current) setProjects(r.projects);
  }, [user.deleting]);
  useEffect(() => {
    alive.current = true;
    void load().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
      task.current?.abort();
    };
  }, [load]); // Account changes cancel transfers.
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (task.current) return;
    const c = new AbortController();
    task.current = c;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn(c.signal);
    } catch (e) {
      if (alive.current)
        setError(
          c.signal.aborted
            ? "Transfer stopped. Local copies remain intact; upload again to resume verified chunks."
            : e instanceof Error
              ? e.message
              : "The request failed.",
        );
    } finally {
      task.current = null;
      if (alive.current) {
        setBusy(false);
        setProgress({ stage: "", done: 0, total: 0 });
      }
    }
  };
  const move = async (id: string, separate = false) => {
    if (!consent) throw Error("Confirm this account owns the selected local projects.");
    try {
      const r = await uploadLocalProject(
        user.id,
        id,
        separate,
        task.current!.signal,
        (stage, done, total) => {
          if (alive.current) setProgress({ stage, done, total });
        },
      );
      setConflict(null);
      setMessage(`Cloud revision ${r.revision} verified. Your local copy was preserved.`);
      await load();
    } catch (e) {
      if (e instanceof AccountError && e.code === "revision_conflict") setConflict(id);
      throw e;
    }
  };
  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    void run(async (signal) => {
      await accountPost(
        "profile",
        { name, avatar, preferences: { ...user.preferences, compactProjects } },
        signal,
      );
      await onRefresh();
      setMessage("Profile saved.");
    });
  };
  return (
    <section className={`account-dashboard ${compactProjects ? "account-compact" : ""}`}>
      <div className="account-dashboard-heading">
        <div>
          <p className="account-kicker">YOUR CREATIVE HOME</p>
          <h1>
            Welcome, <em>{user.name}.</em>
          </h1>
          <p>Your originals stay local. Your cloud copies travel with you.</p>
        </div>
        <button
          className="account-secondary"
          onClick={() => {
            task.current?.abort();
            onLogout();
          }}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
      {user.deleting && (
        <div className="account-error" role="alert">
          Account deletion is in progress. Cloud access is paused. Confirm your identity below to
          retry cleanup; local projects remain intact.
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-message" role="status">
          {message}
        </p>
      )}
      <div className="account-dashboard-grid">
        <section className="account-dashboard-card account-profile">
          <div className="account-profile-avatar">
            {user.name.slice(0, 2).toUpperCase()}
            {avatar && (
              <img
                src={avatar}
                alt="Profile"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
          </div>
          <h2>Creator profile</h2>
          <p className="account-verified">
            <ShieldCheck size={16} />
            Email verified
          </p>
          <p className="account-email">{user.email}</p>
          <form onSubmit={saveProfile}>
            <label className="account-field">
              <span>Display name</span>
              <input
                aria-label="Display name"
                value={name}
                minLength={2}
                maxLength={80}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="account-field">
              <span>Avatar URL</span>
              <input
                type="url"
                value={avatar}
                placeholder="https://…"
                maxLength={1024}
                onChange={(e) => setAvatar(e.target.value)}
              />
            </label>
            <label className="account-check">
              <input
                type="checkbox"
                checked={compactProjects}
                onChange={(e) => setCompactProjects(e.target.checked)}
              />
              Use a compact cloud project list
            </label>
            <button className="account-secondary" disabled={busy || user.deleting}>
              Save profile
            </button>
          </form>
          <h3>Connected providers</h3>
          <div className="account-provider-badges">
            {user.providers.map((p) => (
              <span key={p}>
                <Check size={13} />
                {p}
              </span>
            ))}
          </div>
          {(["google", "facebook"] as const)
            .filter((p) => !user.providers.includes(p))
            .map((p) => (
              <button
                key={p}
                className="account-text-button"
                disabled={!status[p] || busy || user.deleting}
                onClick={() => onOAuth(p, "link")}
              >
                Connect {p} <ArrowUpRight size={12} />
              </button>
            ))}
          <small>Joined {new Date(user.createdAt).toLocaleDateString()}</small>
        </section>
        <section className="account-dashboard-card account-cloud">
          <div className="account-section-heading">
            <div>
              <span className="account-small-mark">
                <Cloud size={20} />
              </span>
              <h2>Private cloud projects</h2>
            </div>
            <button
              className="account-icon"
              aria-label="Refresh cloud projects"
              disabled={busy || user.deleting}
              onClick={() =>
                void run(async () => {
                  await load();
                })
              }
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <p className="account-subtitle">
            {projects.length} cloud {projects.length === 1 ? "project" : "projects"} · versioned
            editable packages
          </p>
          {!projects.length && (
            <div className="account-cloud-empty">
              <Cloud size={34} />
              <h3>Your cloud library starts here.</h3>
              <p>Select local projects below to upload a private, complete editing package.</p>
            </div>
          )}
          {projects.map((p) => (
            <article key={p.id} className="account-cloud-project">
              <div>
                <strong>{p.title}</strong>
                <span>
                  Revision {p.head_revision} · {pretty(Number(p.bytes ?? 0))} ·{" "}
                  {new Date(p.updated_at).toLocaleDateString()}
                </span>
              </div>
              <div>
                <button
                  className="account-secondary"
                  disabled={busy || p.head_revision < 1 || user.deleting}
                  onClick={() =>
                    void run(async (signal) => {
                      await restoreCloudProject(user.id, p, signal, (stage, done, total) =>
                        setProgress({ stage, done, total }),
                      );
                      setMessage(
                        "Cloud project restored to this device. Existing projects were not overwritten.",
                      );
                    })
                  }
                >
                  <Download size={15} />
                  Restore locally
                </button>
                <button
                  className="account-text-button"
                  disabled={busy || p.head_revision < 1 || user.deleting}
                  onClick={() =>
                    void run(async (signal) => {
                      await downloadCloudProject(user.id, p, signal, (stage, done, total) =>
                        setProgress({ stage, done, total }),
                      );
                      setMessage("Verified editable package downloaded.");
                    })
                  }
                >
                  Download package
                </button>
              </div>
            </article>
          ))}
          <div className="account-local-import">
            <h3>
              <HardDrive size={18} />
              Local projects on this device
            </h3>
            <p>
              On a shared device, these may belong to someone else. Nothing is uploaded
              automatically.
            </p>
            {!ready ? (
              <p role="status">Reading local project metadata…</p>
            ) : !local.length ? (
              <p>
                No local projects yet. <Link to="/">Create your first chapter</Link>.
              </p>
            ) : (
              <>
                <div className="account-local-list">
                  {local.map((p) => {
                    const cs = chapters.filter((c) => c.projectId === p.id),
                      count = panels.filter((x) => cs.some((c) => c.id === x.chapterId)).length;
                    return (
                      <label key={p.id} className="account-local-row">
                        <input
                          type="checkbox"
                          disabled={busy || user.deleting}
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                            )
                          }
                        />
                        <span>
                          <strong>{p.title}</strong>
                          <small>
                            {cs.length} chapters · {count} images · updated{" "}
                            {new Date(p.updatedAt).toLocaleDateString()}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <label className="account-check account-import-consent">
                  <input
                    type="checkbox"
                    disabled={busy || user.deleting}
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    I confirm these projects belong in <strong>{user.email}</strong>. Keep the local
                    copies.
                  </span>
                </label>
                <button
                  className="account-primary"
                  disabled={busy || !consent || !selected.length || user.deleting}
                  onClick={() =>
                    void run(async () => {
                      for (const id of selected) await move(id);
                    })
                  }
                >
                  <Upload size={17} />
                  Upload selected projects
                </button>
                {conflict && (
                  <button
                    className="account-secondary"
                    disabled={busy || !consent}
                    onClick={() => void run(async () => move(conflict, true))}
                  >
                    Upload conflicting project as a separate copy
                  </button>
                )}
              </>
            )}
            <p className="account-transfer-note">
              Uploads resume by verified chunks. A newer cloud revision causes a conflict instead of
              an overwrite. Restoring an existing local project ID is refused; download its package
              for safe recovery.
            </p>
          </div>
          {busy && (
            <div className="account-transfer-progress" role="status">
              <span>{progress.stage || "Working…"}</span>
              {progress.total > 0 && (
                <>
                  <progress max={progress.total} value={progress.done} />
                  <small>
                    {pretty(progress.done)} / {pretty(progress.total)}
                  </small>
                </>
              )}
              <button className="account-text-button" onClick={() => task.current?.abort()}>
                <X size={14} />
                Stop transfer
              </button>
            </div>
          )}
        </section>
      </div>
      <details className="account-dashboard-card account-security">
        <summary>
          <ShieldCheck size={18} />
          Security & account deletion
        </summary>
        <div className="account-security-grid">
          <section>
            <h3>Confirm your identity</h3>
            <p>
              Sensitive actions require a fresh provider-confirmed session, valid for two minutes.
            </p>
            {user.providers.includes("email") ? (
              <>
                <PasswordField label="Current password" value={current} onChange={setCurrent} />
                <button
                  className="account-secondary"
                  disabled={busy || !current}
                  onClick={() =>
                    void run(async (signal) => {
                      await accountPost("reauth", { password: current }, signal);
                      setCurrent("");
                      setFresh(true);
                      setMessage("Identity confirmed for the next sensitive action.");
                    })
                  }
                >
                  Confirm identity
                </button>
              </>
            ) : (
              <div className="account-providers">
                {(["google", "facebook"] as const)
                  .filter((p) => user.providers.includes(p))
                  .map((p) => (
                    <button
                      key={p}
                      disabled={!status[p] || busy}
                      onClick={() => onOAuth(p, "reauth")}
                    >
                      Reauthenticate with {p}
                    </button>
                  ))}
              </div>
            )}
            <p className="account-subtitle">
              {fresh
                ? "Confirmation available; the server checks its expiry and single-use status."
                : "Confirm again before changing your password or deleting the account."}
            </p>
          </section>
          <section>
            <h3>Change password</h3>
            <PasswordField
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PasswordField
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
            <button
              className="account-secondary"
              disabled={busy || !fresh || !password}
              onClick={() =>
                void run(async (signal) => {
                  strongPassword(password);
                  if (password !== confirm) throw Error("The passwords do not match.");
                  await accountPost("change-password", { password }, signal);
                  setPassword("");
                  setConfirm("");
                  setFresh(false);
                  setMessage("Password changed. Other refresh sessions were signed out.");
                })
              }
            >
              Update password
            </button>
          </section>
          <section className="account-delete">
            <h3>Delete cloud account</h3>
            <p>
              Permanently removes your Supabase account, profile, cloud projects and uploaded files.
              This cannot be undone. Local project copies stay on this device.
            </p>
            <label className="account-field">
              <span>Type DELETE to confirm</span>
              <input
                value={deletion}
                autoComplete="off"
                onChange={(e) => setDeletion(e.target.value)}
              />
            </label>
            <button
              className="account-danger"
              disabled={busy || !fresh || deletion !== "DELETE"}
              onClick={() =>
                void run(async (signal) => {
                  await accountPost("delete-account", { confirm: deletion }, signal);
                  task.current = null;
                  await onRefresh();
                })
              }
            >
              Permanently delete cloud account
            </button>
          </section>
        </div>
      </details>
    </section>
  );
}
