import { query } from "../db";

// The signed-in owner's profile, shared by the web (#150) and phone (#151) screens
// so they never disagree. The email is the verified Google identity and stays
// read-only; changing it would break account linking.
export const NAME_MAX_LENGTH = 80;

export type NameSource = "provider" | "owner";
export type Profile = {
  name: string | null;
  email: string | null;
  nameSource: NameSource | null;
  provider: "google";
  initials: string;
};

type ProfileRow = {
  name: string | null;
  email: string | null;
  name_source: NameSource;
};

// Two letters for an avatar: first and last word of the name, or the local part
// of the email while the owner has no name yet.
export function initialsFor(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).map(word => [...word].filter(char => /[\p{L}\p{N}]/u.test(char))[0]).filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]]).join("").toUpperCase();
}

function toProfile(row: ProfileRow): Profile {
  const name = row.name?.trim() || null;
  return {
    name,
    email: row.email,
    // No name means there is no source to report, whatever the column says.
    nameSource: name ? row.name_source : null,
    // Google is the only owner provider today; demo sessions stand in for it.
    provider: "google",
    initials: initialsFor(name, row.email)
  };
}

export async function profileFor(ownerId: string): Promise<Profile> {
  const row = (await query<ProfileRow>(
    "SELECT name, email, name_source FROM auth_users WHERE id=$1",
    [ownerId]
  )).rows[0];
  if (!row) throw new Error("Owner not found");
  return toProfile(row);
}

// Returns the cleaned name, or the owner-facing reason it was rejected.
export function normalizeOwnerName(input: unknown): { name: string } | { error: string } {
  if (typeof input !== "string") return { error: "Enter a name" };
  const name = input.trim();
  if (!name) return { error: "Enter a name" };
  if (name.length > NAME_MAX_LENGTH) return { error: `Use a name of ${NAME_MAX_LENGTH} characters or fewer` };
  if (/\p{Cc}/u.test(name)) return { error: "Remove control characters from the name" };
  return { name };
}

export async function setOwnerName(ownerId: string, input: unknown): Promise<Profile | { error: string }> {
  const result = normalizeOwnerName(input);
  if ("error" in result) return result;
  const updated = await query("UPDATE auth_users SET name=$2, name_source='owner' WHERE id=$1", [ownerId, result.name]);
  if (!updated.rowCount) throw new Error("Owner not found");
  return profileFor(ownerId);
}

// Sign-in fills a missing name from the provider, but never replaces a name the
// owner chose. Used by the mobile exchange and mirrored in the web adapter.
export async function fillProviderName(ownerId: string, name: string | null | undefined): Promise<void> {
  const trimmed = name?.trim();
  if (!trimmed) return;
  await query("UPDATE auth_users SET name=$2 WHERE id=$1 AND name IS NULL AND name_source='provider'", [ownerId, trimmed]);
}
