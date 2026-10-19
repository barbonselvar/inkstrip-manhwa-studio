import { AppearanceRuntime } from "./design/preferences";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { X, Layers3, Info, WifiOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function AppReady({ children }: { children: ReactNode }) {
  const hydrate = useStudio((state) => state.hydrate);
  const ready = useStudio((state) => state.ready);
  const banner = useStudio((state) => state.banner);
  const dismissBanner = useStudio((state) => state.dismissBanner);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <>
      <AppearanceRuntime />
      <ConnectivityNotice />
      {banner ? <Banner text={banner} onDismiss={dismissBanner} /> : null}
      {ready ? children : <BootScreen />}
    </>
  );
}

export function BootScreen() {
  return (
    <main className="studio-boot" aria-busy="true" aria-label="Opening Inkstrip">
      <span className="boot-mark">
        <Layers3 />
      </span>
      <p className="font-display text-2xl">
        inkstrip<span className="text-accent">.</span>
      </p>
      <p role="status" className="text-sm text-muted">
        Opening your studio…
      </p>
      <div className="boot-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}

export function Banner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="studio-notice" role="status" aria-live="polite">
      <Info className="size-5 text-accent" aria-hidden="true" />
      <p className="text-sm text-fg">{text}</p>
      <button
        type="button"
        className="press focus-ring shrink-0 rounded-sm p-1 text-muted"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Wordmark() {
  return (
    <Link to="/" className="wordmark focus-ring rounded-sm font-display text-lg text-fg">
      <span className="wordmark-symbol" aria-hidden="true">
        <Layers3 className="size-4" />
      </span>
      Inkstrip<span className="text-accent">.</span>
    </Link>
  );
}

export function InlineTitle({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (value: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!editing) {
    return (
      <button
        type="button"
        className={cn("focus-ring max-w-full truncate rounded-sm text-left", className)}
        onClick={() => setEditing(true)}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      aria-label="Rename"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        const next = draft.trim();
        if (next && next !== value) onSave(next);
        else setDraft(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className={cn("field", className)}
    />
  );
}

export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
  className,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={description}>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="border border-danger/40"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function Segment<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="studio-segment">
      <p className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">{label}</p>
      <div
        className={cn(
          "segment-track grid gap-1 rounded-md bg-bg-subtle p-1",
          options.length === 2 ? "grid-cols-2" : "grid-cols-3",
        )}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={active}
              className={cn(
                "press focus-ring h-11 rounded-sm text-sm",
                active ? "bg-bg-elevated text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConnectivityNotice() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline ? (
    <p className="connection-notice" role="status">
      <WifiOff className="size-4" />
      Offline · local projects remain available. Model downloads and cloud AI need a connection.
    </p>
  ) : null;
}
