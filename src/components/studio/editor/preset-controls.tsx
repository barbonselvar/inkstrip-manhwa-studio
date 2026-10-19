import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import { updateProject, storageMessage } from "@/lib/studio/db";
import { validatePresets } from "@/lib/studio/workflow";
import type { Adjustments } from "@/lib/studio/editor/adjustments";
export function PresetControls({
  projectId,
  value,
  onApply,
}: {
  projectId: string;
  value: Adjustments;
  onApply: (a: Adjustments) => void;
}) {
  const presets = useStudio((s) => s.projects.find((p) => p.id === projectId)?.presets),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function update(removeId?: string) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const saved = await updateProject(projectId, (p) => {
        const next = removeId
          ? (p.presets ?? []).filter((v) => v.id !== removeId)
          : [
              ...(p.presets ?? []),
              {
                id: crypto.randomUUID(),
                name: name.trim().slice(0, 80),
                adjustments: { ...value },
              },
            ];
        validatePresets(next);
        return { ...p, presets: next, updatedAt: Date.now() };
      });
      useStudio.setState((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? saved : p)),
      }));
      setName("");
      setNotice(removeId ? "Preset removed." : "Preset saved to this project.");
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy} className="image-property-fields">
      <h3 className="font-display">Saved project presets</h3>
      <input
        className="field"
        aria-label="Preset name"
        maxLength={80}
        placeholder="My ink finish"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button variant="secondary" disabled={!name.trim()} onClick={() => void update()}>
        Save current tone preset
      </Button>
      {presets?.map((p) => (
        <div key={p.id} className="flex gap-2">
          <Button variant="secondary" onClick={() => onApply({ ...p.adjustments })}>
            {p.name}
          </Button>
          <Button
            variant="ghost"
            aria-label={`Remove preset ${p.name}`}
            onClick={() => void update(p.id)}
          >
            Remove
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted">
        Tone/filter values only; crops, geometry and masks remain image-specific. Presets are local
        to this project.
      </p>
      {notice ? (
        <p role="status" className="inline-success">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
