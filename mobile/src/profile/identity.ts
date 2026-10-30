import { NAME_MAX_LENGTH, type Profile } from "../api/profile";

// The same rule the server enforces in lib/services/profile.ts, so a typo is
// caught on the phone instead of costing a round trip. Kept in step by tests on
// both sides; the wording is the phone's own.
const CONTROL_CHARACTERS = /\p{Cc}/u;

export function nameProblem(value: string): string | null {
  const name = value.trim();
  if (name.length === 0) return "Enter your name.";
  if (name.length > NAME_MAX_LENGTH) return `Keep your name to ${NAME_MAX_LENGTH} characters or fewer.`;
  if (CONTROL_CHARACTERS.test(name)) return "Remove control characters from your name.";
  return null;
}

// The name to show, or null when the owner has not set one and Google gave none.
export function displayName(profile: Profile | null): string | null {
  const name = profile?.name?.trim();
  return name ? name : null;
}

export function nameActionLabel(profile: Profile | null): string {
  return displayName(profile) ? "Edit name" : "Add your name";
}

// The avatar label: the name's initials, or the email's local part ("demo-free@…"
// → "DF") when there is no name. Mirrors initialsFor() on the server, and never
// empty so the button always renders.
export function initials(profile: Profile | null): string {
  const source = displayName(profile) ?? profile?.email?.split("@")[0] ?? "";
  const words = source
    .split(/[\s._-]+/)
    .map(word => Array.from(word).find(char => /[\p{L}\p{N}]/u.test(char)))
    .filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]]).join("").toUpperCase();
}
