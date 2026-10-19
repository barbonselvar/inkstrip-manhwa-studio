import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCharacters, type CharacterProfile } from "./types.ts";
const profile: CharacterProfile = {
  id: "william",
  name: "William",
  notes: "Black hair",
  primaryId: "front",
  updatedAt: 1,
  references: [{ id: "front", angle: "Front", blob: new Blob(["test"], { type: "image/png" }) }],
};
test("character validation requires explicit independent references, correct primary, unique IDs and storage bounds", () => {
  validateCharacters([profile]);
  assert.throws(() => validateCharacters([profile, profile]));
  assert.throws(() => validateCharacters([{ ...profile, primaryId: "missing" }]));
  assert.throws(() => validateCharacters([{ ...profile, references: [] }]));
  assert.throws(() =>
    validateCharacters([
      {
        ...profile,
        references: [
          {
            ...profile.references[0]!,
            blob: new Blob([new Uint8Array(750001)], { type: "image/png" }),
          },
        ],
      },
    ]),
  );
});
