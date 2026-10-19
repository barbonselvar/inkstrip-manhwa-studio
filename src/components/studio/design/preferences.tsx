import { useEffect, useState } from "react";
import { Settings2, Monitor, Keyboard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  PREFERENCES_KEY,
  type StudioPreferences,
} from "@/lib/studio/ui/preferences";
function apply(value: StudioPreferences) {
  const root = document.documentElement;
  root.dataset.studioMotion = value.motion;
  root.dataset.atmosphere = String(value.atmosphere);
  root.dataset.transparency = value.transparency ? "glass" : "solid";
}
export function AppearanceRuntime() {
  useEffect(() => {
    const restore = () => {
      let value = DEFAULT_PREFERENCES;
      try {
        value = parsePreferences(localStorage.getItem(PREFERENCES_KEY));
      } catch {
        /* UI preferences are optional. */
      }
      apply(value);
    };
    restore();
    const visibility = () => {
      document.documentElement.dataset.pageVisibility = document.hidden ? "hidden" : "visible";
    };
    visibility();
    const changed = (event: StorageEvent) => {
      if (event.key === PREFERENCES_KEY) restore();
    };
    window.addEventListener("storage", changed);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("storage", changed);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return null;
}
export function AppearanceButton() {
  const [open, setOpen] = useState(false),
    [preferences, setPreferences] = useState(DEFAULT_PREFERENCES),
    [error, setError] = useState("");
  const show = () => {
    try {
      setPreferences(parsePreferences(localStorage.getItem(PREFERENCES_KEY)));
    } catch {
      /* Defaults remain usable. */
    }
    setOpen(true);
  };
  const change = (next: StudioPreferences) => {
    setPreferences(next);
    apply(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      setError("");
    } catch {
      setError("Applied for this session. This browser could not save appearance preferences.");
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Studio preferences"
        title="Studio preferences"
        onClick={show}
      >
        <Settings2 className="size-4" />
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Studio preferences"
        description="Make the space your own. Artwork and project data stay untouched."
      >
        <div className="preferences-stack">
          <div className="preference-heading">
            <Monitor className="size-4" />
            <h3>Appearance & motion</h3>
          </div>
          <label className="preference-row">
            <span>
              <strong>Motion</strong>
              <small>System always respects reduced motion.</small>
            </span>
            <select
              className="field"
              aria-label="Studio motion"
              value={preferences.motion}
              onChange={(e) =>
                change({ ...preferences, motion: e.target.value as StudioPreferences["motion"] })
              }
            >
              <option value="system">Follow system</option>
              <option value="quiet">Quiet / static</option>
            </select>
          </label>
          <label className="preference-row">
            <span>
              <strong>Ambient atmosphere</strong>
              <small>Gentle light in the library. Static on phones.</small>
            </span>
            <input
              type="checkbox"
              aria-label="Ambient atmosphere"
              checked={preferences.atmosphere}
              onChange={(e) => change({ ...preferences, atmosphere: e.target.checked })}
            />
          </label>
          <label className="preference-row">
            <span>
              <strong>Translucent surfaces</strong>
              <small>Turn off for a lighter rendering workload.</small>
            </span>
            <input
              type="checkbox"
              aria-label="Translucent surfaces"
              checked={preferences.transparency}
              onChange={(e) => change({ ...preferences, transparency: e.target.checked })}
            />
          </label>
          <div className="preference-heading">
            <Keyboard className="size-4" />
            <h3>At your fingertips</h3>
          </div>
          <dl className="shortcut-list">
            <div>
              <dt>Open focused image</dt>
              <dd>
                <kbd>E</kbd>
              </dd>
            </div>
            <div>
              <dt>Save accepted edit</dt>
              <dd>
                <kbd>Ctrl / ⌘ S</kbd>
              </dd>
            </div>
            <div>
              <dt>Undo / redo</dt>
              <dd>
                <kbd>Ctrl / ⌘ Z</kbd>
                <kbd>⇧ Z</kbd>
              </dd>
            </div>
            <div>
              <dt>Pan while selecting</dt>
              <dd>
                <kbd>Space</kbd>
              </dd>
            </div>
            <div>
              <dt>Cancel a reorder</dt>
              <dd>
                <kbd>Esc</kbd>
              </dd>
            </div>
          </dl>
          <p className="privacy-note">
            <ShieldCheck className="size-4" />
            Local processing by default. Cloud AI always requires your explicit choice.
          </p>
          {error ? (
            <p role="status" className="text-sm text-muted">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
