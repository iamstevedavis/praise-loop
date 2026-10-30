import { createApiClient } from "../src/api/client";
import { fetchProfile, NAME_MAX_LENGTH, saveName, type Profile } from "../src/api/profile";
import { displayName, initials, nameActionLabel, nameProblem } from "../src/profile/identity";

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "Ada Lovelace",
    email: "ada@example.invalid",
    nameSource: "provider",
    provider: "google",
    initials: "AL",
    ...overrides
  };
}

function client(status: number, body: unknown = {}, calls: { url: string; method?: string; body?: unknown }[] = []) {
  return createApiClient({
    baseUrl: "http://localhost:3000",
    getToken: () => "mobile-token",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
    }) as typeof fetch
  });
}

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  name: "Ada Lovelace",
  email: "ada@example.invalid",
  nameSource: "provider",
  provider: "google",
  initials: "AL",
  ...overrides
});

describe("profile API", () => {
  it("reads the signed-in owner's name and email", async () => {
    const loaded = await fetchProfile(client(200, profileRow()));
    expect(loaded).toEqual(profile());
  });

  it("keeps a missing name as null instead of an empty string", async () => {
    const loaded = await fetchProfile(client(200, profileRow({ name: null, nameSource: null, provider: "google", initials: "N" })));
    expect(loaded.name).toBeNull();
    expect(loaded.nameSource).toBeNull();
    expect(loaded.email).toBe("ada@example.invalid");
  });

  it("rejects anything that is not a profile object", async () => {
    await expect(fetchProfile(client(200, null))).rejects.toThrow(/invalid profile/i);
    await expect(fetchProfile(client(200, ["ada@example.invalid"]))).rejects.toThrow(/invalid profile/i);
  });

  it("saves a name with PATCH and returns the profile the server now holds", async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const updated = await saveName(client(200, profileRow({ name: "Ada L.", nameSource: "owner" }), calls), "Ada L.");
    expect(calls[0]).toEqual({ url: "http://localhost:3000/api/profile", method: "PATCH", body: { name: "Ada L." } });
    expect(updated).toMatchObject({ name: "Ada L.", nameSource: "owner" });
  });

  it("shows the server's own words when it rejects a name", async () => {
    const error = await saveName(client(400, { error: "Enter your name." }), "  ").catch(cause => cause);
    expect(error).toMatchObject({ kind: "http", status: 400, message: "Enter your name." });
  });

  it("maps a saved-name request on an ended session to signed out", async () => {
    await expect(saveName(client(401), "Ada")).rejects.toMatchObject({ kind: "signedOut" });
  });
});

describe("profile identity", () => {
  it("builds initials from the name, or from the email when there is none", () => {
    expect(initials(profile())).toBe("AL");
    expect(initials(profile({ name: null, email: "demo-free@praiseloop.invalid" }))).toBe("DF");
    expect(initials(profile({ name: "Ada" }))).toBe("A");
    expect(initials(profile({ name: null, email: "owner.one@example.invalid" }))).toBe("OO");
    expect(initials(null)).toBe("?");
    expect(initials(profile({ name: null, email: "" }))).toBe("?");
  });

  it("shows the name when set, and asks for one when it is missing", () => {
    expect(displayName(profile({ name: "  Ada Lovelace  " }))).toBe("Ada Lovelace");
    expect(displayName(profile({ name: null }))).toBeNull();
    expect(displayName(profile({ name: "   " }))).toBeNull();
    expect(displayName(null)).toBeNull();
    expect(nameActionLabel(profile())).toBe("Edit name");
    expect(nameActionLabel(profile({ name: null }))).toBe("Add your name");
    expect(nameActionLabel(null)).toBe("Add your name");
  });

  it("mirrors the server's name rule", () => {
    expect(nameProblem("Ada Lovelace")).toBeNull();
    expect(nameProblem("  Ada  ")).toBeNull();
    expect(nameProblem("A".repeat(NAME_MAX_LENGTH))).toBeNull();
    expect(nameProblem("A".repeat(NAME_MAX_LENGTH + 1))).toBe(`Keep your name to ${NAME_MAX_LENGTH} characters or fewer.`);
    expect(nameProblem("")).toBe("Enter your name.");
    expect(nameProblem("   ")).toBe("Enter your name.");
    expect(nameProblem("Ada\nLovelace")).toBe("Remove control characters from your name.");
    expect(nameProblem("Ada\u007fLovelace")).toBe("Remove control characters from your name.");
  });
});
