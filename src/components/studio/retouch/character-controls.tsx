import { useEffect, useState } from "react";
import { useImageUrl } from "@/lib/studio/use-image-url";
import { Button } from "@/components/ui/button";
import { ImagePicker } from "../picker/image-picker";
import { useStudio } from "@/lib/studio/store";
import { updateProject, storageMessage } from "@/lib/studio/db";
import { makeReference } from "@/lib/studio/characters/reference";
import { validateCharacters, type CharacterProfile } from "@/lib/studio/characters/types";
import type { Selection } from "@/lib/studio/retouch/selection";
function Thumb({ blob }: { blob: Blob }) {
  const { url, error } = useImageUrl(blob);
  return (
    <img
      src={url || undefined}
      title={error || undefined}
      alt="Character reference face"
      className="character-thumb"
    />
  );
}
const REFERENCE_ACCEPT = "image/png,image/jpeg,image/webp";

export function CharacterControls({
  projectId,
  blob,
  strokes,
  disabled,
  onReference,
}: {
  projectId: string;
  blob: Blob;
  strokes: Selection[];
  disabled: boolean;
  onReference: (ref: Blob | undefined, notes: string, name: string) => void;
}) {
  const project = useStudio((s) => s.projects.find((p) => p.id === projectId)),
    profiles = project?.characters ?? [];
  const [picking, setPicking] = useState(false);
  const [id, setId] = useState(
      () => sessionStorage.getItem(`inkstrip-character:${projectId}`) ?? "",
    ),
    [refId, setRefId] = useState(""),
    [name, setName] = useState(""),
    [notes, setNotes] = useState(""),
    [angle, setAngle] = useState("Front"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const selected = profiles.find((p) => p.id === id),
    reference =
      selected?.references.find((r) => r.id === (refId || selected.primaryId)) ??
      selected?.references.find((r) => r.id === selected.primaryId);
  useEffect(() => {
    setName(selected?.name ?? "");
    setNotes(selected?.notes ?? "");
  }, [selected]);
  useEffect(() => {
    onReference(reference?.blob, selected?.notes ?? "", selected?.name ?? "");
  }, [reference, selected, onReference]);
  async function mutate(fn: (p: CharacterProfile[]) => CharacterProfile[]) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const saved = await updateProject(projectId, (p) => {
        const characters = fn(p.characters ?? []);
        validateCharacters(characters);
        return { ...p, characters, updatedAt: Date.now() };
      });
      useStudio.setState((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? saved : p)),
      }));
      setNotice("Character library saved on this device.");
      return true;
    } catch (e) {
      setError(storageMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveReference(upload?: File) {
    if (!upload && !strokes.length) {
      setError("Select a reference face before saving.");
      return;
    }
    if (
      upload &&
      (!["image/jpeg", "image/png", "image/webp"].includes(upload.type) || upload.size > 12_000_000)
    ) {
      setError("Upload PNG, JPEG or WebP under 12MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const crop = await makeReference(upload ?? blob, upload ? undefined : strokes);
      const newId = id && selected ? id : crypto.randomUUID(),
        rid = crypto.randomUUID();
      const saved = await mutate((list) => {
        const existing = list.find((p) => p.id === newId);
        const ref = { id: rid, angle: angle.trim().slice(0, 80) || "Reference", blob: crop };
        if (existing)
          return list.map((p) =>
            p.id === newId
              ? { ...p, references: [...p.references, ref], updatedAt: Date.now() }
              : p,
          );
        return [
          ...list,
          {
            id: newId,
            name: name.trim().slice(0, 80) || "New character",
            notes: notes.slice(0, 1000),
            references: [ref],
            primaryId: rid,
            updatedAt: Date.now(),
          },
        ];
      });
      if (!saved) return;
      setId(newId);
      setRefId(rid);
      sessionStorage.setItem(`inkstrip-character:${projectId}`, newId);
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset
      disabled={disabled || busy}
      className="image-property-fields character-library-fields"
    >
      <h3 className="font-display">Character Library</h3>
      <p className="text-xs text-muted">
        Saved locally within this project, reusable across its chapters. References are independent
        PNG crops. No automatic identity matching.
      </p>
      <label className="editor-field-label">
        Character
        <select
          className="field"
          aria-label="Character profile"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setRefId("");
            sessionStorage.setItem(`inkstrip-character:${projectId}`, e.target.value);
          }}
        >
          <option value="">New character</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="editor-field-label">
        Character name
        <input
          className="field"
          aria-label="Character name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="editor-field-label">
        Appearance notes
        <textarea
          className="field"
          aria-label="Character appearance notes"
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <label className="editor-field-label">
        Reference angle
        <input
          className="field"
          aria-label="Reference angle"
          maxLength={80}
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
        />
      </label>
      <Button variant="secondary" disabled={!strokes.length} onClick={() => void saveReference()}>
        Save selected face reference
      </Button>
      <Button variant="secondary" aria-haspopup="dialog" onClick={() => setPicking(true)}>
        Upload cropped reference
      </Button>
      <input
        type="file"
        accept={REFERENCE_ACCEPT}
        aria-label="Upload character reference"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void saveReference(f);
          e.target.value = "";
        }}
      />
      <ImagePicker
        open={picking}
        onOpenChange={setPicking}
        mode="single"
        title="Character reference"
        description="Choose one cropped face image. It stays in this project on this device."
        accept={REFERENCE_ACCEPT}
        photoAccept={REFERENCE_ACCEPT}
        confirmLabel={() => "Save reference"}
        onConfirm={([file]) => {
          if (file) void saveReference(file);
        }}
      />
      {selected ? (
        <>
          <Button
            variant="ghost"
            onClick={() =>
              void mutate((list) =>
                list.map((p) =>
                  p.id === id
                    ? {
                        ...p,
                        name: name.trim().slice(0, 80),
                        notes: notes.slice(0, 1000),
                        updatedAt: Date.now(),
                      }
                    : p,
                ),
              )
            }
          >
            Update character details
          </Button>
          <select
            className="field"
            aria-label="Character reference angle"
            value={reference?.id ?? ""}
            onChange={(e) => setRefId(e.target.value)}
          >
            {selected.references.map((r) => (
              <option key={r.id} value={r.id}>
                {r.angle}
                {r.id === selected.primaryId ? " · primary" : ""}
              </option>
            ))}
          </select>
          {reference ? (
            <>
              <Thumb blob={reference.blob} />
              <Button
                variant="ghost"
                onClick={() =>
                  void mutate((list) =>
                    list.map((p) => (p.id === id ? { ...p, primaryId: reference.id } : p)),
                  )
                }
              >
                Use as primary reference
              </Button>
              <Button
                variant="ghost"
                disabled={selected.references.length < 2}
                onClick={() =>
                  void mutate((list) =>
                    list.map((p) =>
                      p.id === id
                        ? {
                            ...p,
                            references: p.references.filter((r) => r.id !== reference.id),
                            primaryId:
                              p.primaryId === reference.id
                                ? p.references.find((r) => r.id !== reference.id)!.id
                                : p.primaryId,
                          }
                        : p,
                    ),
                  )
                }
              >
                Remove selected reference
              </Button>
            </>
          ) : null}
          <Button
            variant="danger"
            onClick={() => {
              if (
                confirm(
                  `Remove character ${selected.name} and its saved references? Panels remain unchanged.`,
                )
              )
                void mutate((list) => list.filter((p) => p.id !== id));
            }}
          >
            Remove character
          </Button>
        </>
      ) : null}
      {notice ? (
        <p role="status" className="inline-success">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
