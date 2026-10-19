export type CharacterReference = { id: string; angle: string; blob: Blob };
export type CharacterProfile = {
  id: string;
  name: string;
  notes: string;
  references: CharacterReference[];
  primaryId: string;
  updatedAt: number;
};
export function validateCharacters(profiles: CharacterProfile[]) {
  if (profiles.length > 32) throw new Error("Maximum 32 characters per project.");
  const ids = new Set<string>();
  let total = 0;
  for (const p of profiles) {
    if (
      !p.id ||
      ids.has(p.id) ||
      !p.name.trim() ||
      p.name.length > 80 ||
      p.notes.length > 1000 ||
      !p.references.length ||
      p.references.length > 6 ||
      !p.references.some((r) => r.id === p.primaryId)
    )
      throw new Error("Invalid character profile (1–6 references required).");
    ids.add(p.id);
    const refs = new Set<string>();
    for (const r of p.references) {
      if (
        !r.id ||
        refs.has(r.id) ||
        r.angle.length > 80 ||
        !(r.blob instanceof Blob) ||
        r.blob.type !== "image/png" ||
        r.blob.size > 750_000
      )
        throw new Error("Use PNG references under 750KB and unique reference IDs.");
      refs.add(r.id);
      total += r.blob.size;
    }
  }
  if (total > 16_000_000)
    throw new Error(
      "Character references exceed 16MB for this project. Remove unused references first.",
    );
}
