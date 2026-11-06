import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Check,
  LoaderCircle,
  Cloud,
  Layers3,
} from "lucide-react";
import { accountPost, accountSession, AccountError } from "@/lib/accounts/client";
import {
  emailAddress,
  passwordScore,
  strongPassword,
  type AccountStatus,
} from "@/lib/accounts/policy";
import { AccountDashboard } from "./dashboard";
import "./accounts.css";
export type AccountView =
  "login" | "signup" | "verify" | "forgot" | "recover" | "reset" | "verified" | "dashboard";
const titles: Record<AccountView, [string, string]> = {
  login: ["Welcome back.", "A quiet space for your next great story."],
  signup: ["Begin your next chapter.", "Create your private Inkstrip cloud account."],
  verify: ["Check your inbox.", "Enter the six-digit verification code from your email."],
  forgot: ["Find your way back.", "Request a recovery code for your account."],
  recover: ["One more step.", "Enter the six-digit recovery code from your email."],
  reset: ["A fresh start.", "Choose a new password for your account."],
  verified: ["You’re all set.", "Your email is verified. Your next world is waiting."],
  dashboard: ["Your creative home.", "Your account, your work, your decisions."],
};
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="account-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PasswordField({
  value,
  onChange,
  label = "Password",
  autoComplete = "current-password",
}: {
  value: string;
  onChange: (s: string) => void;
  label?: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label}>
      <span className="account-password">
        <input
          aria-label={label}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          maxLength={128}
          required
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </Field>
  );
}
function Scene() {
  return (
    <section className="account-story" aria-label="Inkstrip creative studio">
      <p className="account-kicker">
        <span /> A space for visual storytellers
      </p>
      <h1>
        Your worlds.
        <br />
        <em>Within reach.</em>
      </h1>
      <p className="account-story-copy">
        From the first frame to the final scroll.
        <br />
        Create here. Carry your stories with you.
      </p>
      <div className="account-scene" aria-hidden="true">
        <div className="account-scene-light" />
        {["adventure", "murim", "horror"].map((name, i) => (
          <div key={name} className={`account-scene-panel scene-panel-${i}`}>
            <img src={`/gallery/${name}-720.webp`} alt="" />
            <div>
              <span>{["EVERY JOURNEY", "A THOUSAND WORLDS", "IN EVERY SHADOW"][i]}</span>
              <strong>{["Beyond the frame", "Stories worth keeping", "A new beginning"][i]}</strong>
            </div>
          </div>
        ))}
        <div className="account-scene-floor" />
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} className="account-particle" style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
      <p className="account-story-note">
        <ShieldCheck size={16} /> Originals stay yours. Cloud copies stay private.
      </p>
    </section>
  );
}
export function AccountPage({
  initialView = "login",
  notice,
}: {
  initialView?: AccountView;
  notice?: string;
}) {
  const [view, setView] = useState<AccountView>(initialView),
    [status, setStatus] = useState<AccountStatus | null>(null),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [code, setCode] = useState(""),
    [accepted, setAccepted] = useState(false),
    [remember, setRemember] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [cooldown, setCooldown] = useState(0);
  const card = useRef<HTMLDivElement>(null),
    frame = useRef(0),
    request = useRef<AbortController | null>(null);
  const refresh = async () => {
    const s = await accountSession();
    setStatus(s);
    return s;
  };
  useEffect(() => {
    const c = new AbortController();
    void accountSession(c.signal)
      .then((s) => {
        setStatus(s);
        if (s.user && notice === "recovery_verified" && s.recovery) setView("reset");
        else if (s.user && notice === "email_verified") setView("verified");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      });
    return () => {
      c.abort();
      request.current?.abort();
      cancelAnimationFrame(frame.current);
    };
  }, [notice]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  const change = (next: AccountView) => {
    setView(next);
    setError("");
    setMessage("");
    setPassword("");
    setConfirm("");
    setCode("");
  };
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return;
    const c = new AbortController();
    request.current = c;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn(c.signal);
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : "The request could not be completed.");
        if (e instanceof AccountError && e.retry) setCooldown(e.retry);
      }
    } finally {
      setBusy(false);
      request.current = null;
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async (signal) => {
      if (view === "signup") {
        strongPassword(password);
        if (password !== confirm) throw Error("The passwords do not match.");
        await accountPost(
          "signup",
          { name, email: emailAddress(email), password, accepted },
          signal,
        );
        setPassword("");
        setConfirm("");
        setView("verify");
        setMessage("If this address is eligible, a verification email will arrive.");
        setCooldown(60);
      } else if (view === "login") {
        await accountPost("login", { email: emailAddress(email), password, remember }, signal);
        setPassword("");
        await refresh();
        setView("dashboard");
      } else if (view === "forgot") {
        await accountPost("forgot", { email: emailAddress(email) }, signal);
        setView("recover");
        setMessage("If this address is eligible, a recovery email will arrive.");
        setCooldown(60);
      } else if (view === "verify" || view === "recover") {
        if (status?.emailMode === "link") {
          const s = await refresh();
          if (s.user && (view === "verify" || s.recovery))
            setView(view === "verify" ? "verified" : "reset");
          else
            setMessage(
              "Open the latest email link in the same browser where you requested it, then check again.",
            );
          return;
        }
        await accountPost(
          "verify",
          { email: emailAddress(email), code, type: view === "verify" ? "signup" : "recovery" },
          signal,
        );
        setCode("");
        if (view === "recover") setView("reset");
        else {
          await refresh();
          setView("verified");
        }
      } else if (view === "reset") {
        strongPassword(password);
        if (password !== confirm) throw Error("The passwords do not match.");
        await accountPost("reset-password", { password }, signal);
        setPassword("");
        setConfirm("");
        await refresh();
        setView("login");
        setMessage("Password updated. Sign in with your new password.");
      }
    });
  };
  const oauth = (provider: "google" | "facebook", purpose?: string) =>
    void run(async (signal) => {
      const r = await accountPost<{ url: string }>(
        "oauth",
        { provider, purpose, remember },
        signal,
      );
      window.location.assign(r.url);
    });
  const emailLinks = status?.emailMode === "link",
    title: [string, string] =
      emailLinks && ["verify", "recover", "forgot"].includes(view)
        ? [
            titles[view][0],
            view === "forgot"
              ? "Request a secure password recovery link."
              : "Open the latest email link in this browser within 10 minutes. Keep this browser session open.",
          ]
        : titles[view],
    signedIn = status?.user && view !== "reset" && view !== "recover" && view !== "verified";
  return (
    <main id="workspace" className="account-page">
      <header className="account-header">
        <Link to="/" className="wordmark">
          <span className="wordmark-symbol">
            <Layers3 size={18} />
          </span>
          Inkstrip<span className="text-accent">.</span>
        </Link>
        <Link to="/" className="account-back">
          <ArrowLeft size={16} />
          Local studio
        </Link>
      </header>
      {signedIn ? (
        <AccountDashboard
          key={status.user!.id}
          user={status.user!}
          status={status}
          onRefresh={refresh}
          onLogout={() =>
            void run(async () => {
              await accountPost("logout", {});
              await refresh();
              change("login");
              setMessage("Signed out. Local copies remain on this device.");
            })
          }
          onOAuth={oauth}
        />
      ) : (
        <div className="account-auth-layout">
          <Scene />
          <section className="account-form-area">
            <div
              className="account-card"
              ref={card}
              onPointerMove={(e) => {
                if (
                  e.pointerType !== "mouse" ||
                  window.matchMedia("(prefers-reduced-motion: reduce)").matches
                )
                  return;
                const r = e.currentTarget.getBoundingClientRect(),
                  x = ((e.clientX - r.left) / r.width - 0.5) * 3,
                  y = ((e.clientY - r.top) / r.height - 0.5) * -3;
                cancelAnimationFrame(frame.current);
                frame.current = requestAnimationFrame(() => {
                  card.current?.style.setProperty("--tilt-x", `${y}deg`);
                  card.current?.style.setProperty("--tilt-y", `${x}deg`);
                });
              }}
              onPointerLeave={() => {
                card.current?.style.setProperty("--tilt-x", "0deg");
                card.current?.style.setProperty("--tilt-y", "0deg");
              }}
            >
              <span className="account-card-light" aria-hidden="true" />
              <div className="account-card-top">
                <span className="account-small-mark">
                  <Cloud size={19} />
                </span>
                <span>INKSTRIP ACCOUNT</span>
                <span className="account-private-label">
                  <LockKeyhole size={12} />
                  Private
                </span>
              </div>
              <div key={view} className="account-transition">
                <h2>{title[0]}</h2>
                <p className="account-subtitle">{title[1]}</p>
                {!status && !error && (
                  <p role="status" className="account-loading">
                    <LoaderCircle className="account-spin" size={18} />
                    Checking account availability…
                  </p>
                )}
                {status && !status.configured && (
                  <div className="account-setup" role="status">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Cloud setup is pending</strong>
                      <p>{status.reason}</p>
                      <a
                        href="https://github.com/barbonselvar/inkstrip-manhwa-studio/blob/main/docs/ACCOUNTS_SETUP.md"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Configuration guide <ArrowUpRight size={12} />
                      </a>
                    </div>
                  </div>
                )}
                {notice && !["email_verified", "recovery_verified"].includes(notice) && (
                  <p className="account-message" role="status">
                    {notice === "email_failed"
                      ? "This email link could not be verified. Request a new link and open it in the same browser."
                      : notice === "oauth_cancelled"
                        ? "Sign-in was cancelled. You can try again."
                        : notice === "identity_mismatch"
                          ? "The provider returned a different account. Sign in with your original account."
                          : "Provider sign-in could not be completed. Please try again or use email."}
                  </p>
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
                {view === "verified" ? (
                  <div className="account-success">
                    <span>
                      <Check size={30} />
                    </span>
                    <p>Email confirmed.</p>
                    <button className="account-primary" onClick={() => change("dashboard")}>
                      Enter your account <ArrowUpRight size={18} />
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={submit}
                    aria-label={
                      view === "signup"
                        ? "Create account"
                        : view === "login"
                          ? "Sign in"
                          : "Account verification"
                    }
                  >
                    <fieldset disabled={busy || !status}>
                      {view === "signup" && (
                        <Field label="Display name">
                          <input
                            autoComplete="nickname"
                            value={name}
                            minLength={2}
                            maxLength={80}
                            required
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your creator name"
                          />
                        </Field>
                      )}
                      {view !== "reset" && (
                        <Field label="Email address">
                          <input
                            type="email"
                            autoComplete="email"
                            autoCapitalize="none"
                            spellCheck={false}
                            maxLength={254}
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                          />
                        </Field>
                      )}
                      {["login", "signup", "reset"].includes(view) && (
                        <PasswordField
                          value={password}
                          onChange={setPassword}
                          autoComplete={view === "login" ? "current-password" : "new-password"}
                        />
                      )}
                      {["signup", "reset"].includes(view) && (
                        <>
                          <div
                            className="account-strength"
                            aria-label={`Password strength ${passwordScore(password)} of 4`}
                          >
                            {[1, 2, 3, 4].map((i) => (
                              <span key={i} data-active={passwordScore(password) >= i} />
                            ))}
                            <small>12+ characters · upper/lowercase · number · symbol</small>
                          </div>
                          <PasswordField
                            label="Confirm password"
                            value={confirm}
                            onChange={setConfirm}
                            autoComplete="new-password"
                          />
                        </>
                      )}
                      {!emailLinks && (view === "verify" || view === "recover") && (
                        <Field
                          label="Six-digit code"
                          hint="Codes expire after 10 minutes. Check your most recent email."
                        >
                          <input
                            aria-label="Six-digit code"
                            className="account-code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                            placeholder="000000"
                          />
                        </Field>
                      )}
                      {view === "login" && (
                        <div className="account-form-row">
                          <label className="account-check">
                            <input
                              type="checkbox"
                              checked={remember}
                              onChange={(e) => setRemember(e.target.checked)}
                            />
                            Remember session
                          </label>
                          <button
                            type="button"
                            className="account-text-button"
                            onClick={() => change("forgot")}
                          >
                            Forgot password?
                          </button>
                        </div>
                      )}
                      {view === "signup" && (
                        <label className="account-check account-terms">
                          <input
                            type="checkbox"
                            checked={accepted}
                            required
                            onChange={(e) => setAccepted(e.target.checked)}
                          />
                          <span>
                            I agree to the{" "}
                            <Link to="/legal/$document" params={{ document: "terms" }}>
                              Terms
                            </Link>{" "}
                            and{" "}
                            <Link to="/legal/$document" params={{ document: "privacy" }}>
                              Privacy Policy
                            </Link>
                            .
                          </span>
                        </label>
                      )}
                      <button
                        type="submit"
                        className="account-primary"
                        disabled={busy || !status?.configured}
                      >
                        {busy ? (
                          <>
                            <LoaderCircle className="account-spin" size={17} />
                            Please wait…
                          </>
                        ) : (
                          <>
                            {view === "login"
                              ? "Sign in"
                              : view === "signup"
                                ? "Create account"
                                : view === "forgot"
                                  ? emailLinks
                                    ? "Send recovery link"
                                    : "Send recovery code"
                                  : view === "reset"
                                    ? "Update password"
                                    : emailLinks
                                      ? "Check verification"
                                      : "Verify email"}
                            <ArrowUpRight size={18} />
                          </>
                        )}
                      </button>
                    </fieldset>
                  </form>
                )}
                {["verify", "recover"].includes(view) && (
                  <button
                    className="account-text-button account-resend"
                    disabled={busy || cooldown > 0 || !status?.configured}
                    onClick={() =>
                      void run(async (signal) => {
                        await accountPost(
                          view === "verify" ? "resend" : "forgot",
                          { email: emailAddress(email) },
                          signal,
                        );
                        setCooldown(60);
                        setMessage(
                          emailLinks
                            ? "If eligible, a new link will arrive. Open it in this browser."
                            : "If eligible, a new code will arrive. Use the latest email.",
                        );
                      })
                    }
                  >
                    {cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : emailLinks
                        ? "Resend link"
                        : "Resend code"}
                  </button>
                )}
                {["login", "signup"].includes(view) && (
                  <>
                    <div className="account-divider">
                      <span />
                      or continue with
                      <span />
                    </div>
                    <div className="account-providers">
                      <button
                        disabled={busy || !status?.google || !status.configured}
                        onClick={() => oauth("google")}
                      >
                        <span className="account-provider-letter">G</span>Google
                      </button>
                      <button
                        disabled={busy || !status?.facebook || !status.configured}
                        onClick={() => oauth("facebook")}
                      >
                        <span className="account-provider-letter">f</span>Facebook
                      </button>
                    </div>
                    {status?.configured && (!status.google || !status.facebook) && (
                      <p className="account-provider-note">
                        Unavailable providers require administrator configuration.
                      </p>
                    )}
                    <p className="account-legal-note">
                      Continuing with a provider accepts our{" "}
                      <Link to="/legal/$document" params={{ document: "terms" }}>
                        Terms
                      </Link>{" "}
                      and{" "}
                      <Link to="/legal/$document" params={{ document: "privacy" }}>
                        Privacy Policy
                      </Link>
                      . We never ask for your provider password.
                    </p>
                  </>
                )}
                <div className="account-switch">
                  {view === "login" ? (
                    <>
                      New to Inkstrip?{" "}
                      <button disabled={busy || !status} onClick={() => change("signup")}>
                        Create an account
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <button disabled={busy || !status} onClick={() => change("login")}>
                        Sign in
                      </button>
                    </>
                  )}
                  {view === "login" && (
                    <button
                      disabled={busy || !status}
                      className="account-verify-link"
                      onClick={() => change("verify")}
                    >
                      Enter an email verification code
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="account-local-note">
              <Mail size={14} />
              Your local projects stay on this device until you choose to upload them.
            </p>
          </section>
        </div>
      )}
      {signedIn && error && (
        <p className="account-error account-global-message" role="alert">
          {error}
        </p>
      )}
      <footer className="account-footer">
        <span>Made for the worlds you haven’t created yet.</span>
        <nav>
          <Link to="/legal/$document" params={{ document: "privacy" }}>
            Privacy
          </Link>
          <Link to="/legal/$document" params={{ document: "terms" }}>
            Terms
          </Link>
          <Link to="/">Continue locally</Link>
        </nav>
      </footer>
    </main>
  );
}
