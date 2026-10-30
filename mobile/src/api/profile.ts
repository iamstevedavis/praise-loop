import type { ApiClient } from "./client";

// Mirrors NAME_MAX_LENGTH in lib/services/profile.ts. The phone rejects a bad
// name before sending it; the server enforces the same rule either way.
export const NAME_MAX_LENGTH = 80;

export type NameSource = "provider" | "owner";

// Read-only mirror of GET /api/profile (#149). The server owns every value; the
// app shows them and may edit the name. `initials` is the server's avatar
// fallback (src/profile/identity.ts computes the same letters locally, so the
// queue's avatar works before the profile has loaded).
export type Profile = {
  name: string | null;
  email: string | null;
  nameSource: NameSource | null;
  provider: string;
  initials: string;
};

function normalize(data: unknown): Profile {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The server returned an invalid profile.");
  }
  const row = data as Partial<Profile>;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  return {
    name,
    email: typeof row.email === "string" ? row.email : null,
    nameSource: row.nameSource === "owner" || row.nameSource === "provider" ? row.nameSource : null,
    provider: typeof row.provider === "string" ? row.provider : "google",
    initials: typeof row.initials === "string" && row.initials.length > 0 ? row.initials : "?"
  };
}

export async function fetchProfile(client: ApiClient): Promise<Profile> {
  return normalize(await client.request<unknown>("/api/profile"));
}

// A rejected name arrives as a 400 with the server's own wording, which the
// client surfaces as the message; every other failure keeps its usual kind.
export async function saveName(client: ApiClient, name: string): Promise<Profile> {
  return normalize(await client.request<unknown>("/api/profile", { method: "PATCH", body: { name } }));
}
