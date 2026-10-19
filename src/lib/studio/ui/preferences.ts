export type StudioPreferences = {
  motion: "system" | "quiet";
  atmosphere: boolean;
  transparency: boolean;
};
export const DEFAULT_PREFERENCES: StudioPreferences = {
  motion: "system",
  atmosphere: true,
  transparency: true,
};
export const PREFERENCES_KEY = "inkstrip-studio-appearance-v1";
export function parsePreferences(raw: string | null): StudioPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      motion: value?.motion === "quiet" ? "quiet" : "system",
      atmosphere: typeof value?.atmosphere === "boolean" ? value.atmosphere : true,
      transparency: typeof value?.transparency === "boolean" ? value.transparency : true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
