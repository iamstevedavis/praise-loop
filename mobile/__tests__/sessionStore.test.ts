import { SESSION_TOKEN_KEY, createSessionStore, type SecureStorage } from "../src/auth/sessionStore";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: SecureStorage = {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); writes.push(`set:${key}`); },
    deleteItemAsync: async key => { values.delete(key); writes.push(`delete:${key}`); }
  };
  return { storage, values, writes };
}

describe("session store", () => {
  it("loads a stored token once and serves it to the API client synchronously", async () => {
    const { storage } = memoryStorage({ [SESSION_TOKEN_KEY]: "stored-token" });
    const store = createSessionStore(storage);
    expect(store.current()).toBeNull();
    await expect(store.load()).resolves.toBe("stored-token");
    expect(store.current()).toBe("stored-token");
  });

  it("treats an empty value as signed out", async () => {
    const { storage } = memoryStorage({ [SESSION_TOKEN_KEY]: "" });
    const store = createSessionStore(storage);
    await expect(store.load()).resolves.toBeNull();
    expect(store.current()).toBeNull();
  });

  it("writes and deletes only the session key", async () => {
    const { storage, values, writes } = memoryStorage();
    const store = createSessionStore(storage);

    await store.save("fresh-token");
    expect(values.get(SESSION_TOKEN_KEY)).toBe("fresh-token");
    expect(store.current()).toBe("fresh-token");

    await store.clear();
    expect(values.has(SESSION_TOKEN_KEY)).toBe(false);
    expect(store.current()).toBeNull();
    expect(writes).toEqual([`set:${SESSION_TOKEN_KEY}`, `delete:${SESSION_TOKEN_KEY}`]);
  });

  it("refuses to store an empty token", async () => {
    const store = createSessionStore(memoryStorage().storage);
    await expect(store.save("")).rejects.toThrow(/token/i);
  });

  it("keeps the previous token when the keychain write fails", async () => {
    const { storage, values, writes } = memoryStorage({ [SESSION_TOKEN_KEY]: "previous-token" });
    storage.setItemAsync = async (key, value) => { writes.push(`set:${key}:${value}`); throw new Error("keychain unavailable"); };
    const store = createSessionStore(storage);
    await store.load();

    await expect(store.save("new-token")).rejects.toThrow(/keychain unavailable/);
    // A failed sign-in must not leave the API client holding an unpersisted token.
    expect(store.current()).toBe("previous-token");
    expect(values.get(SESSION_TOKEN_KEY)).toBe("previous-token");
  });

  it("does not expose a token that was never written", async () => {
    const { storage } = memoryStorage();
    storage.setItemAsync = async () => { throw new Error("keychain unavailable"); };
    const store = createSessionStore(storage);
    await store.load();

    await expect(store.save("new-token")).rejects.toThrow(/keychain unavailable/);
    expect(store.current()).toBeNull();
  });
});
