// The bearer token is the only thing kept on the device, and it goes to the
// platform keychain (expo-secure-store), never to AsyncStorage or logs.
export const SESSION_TOKEN_KEY = "praiseloop.mobile.token";

export type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export function createSessionStore(storage: SecureStorage) {
  let cached: string | null | undefined;

  return {
    // undefined means "not read yet"; null means "read, no token".
    async load(): Promise<string | null> {
      if (cached !== undefined) return cached;
      const stored = await storage.getItemAsync(SESSION_TOKEN_KEY);
      cached = stored && stored.length > 0 ? stored : null;
      return cached;
    },
    async save(token: string): Promise<void> {
      if (!token) throw new Error("A session token is required");
      // Publish the token only once it is durable. If the keychain write fails,
      // the in-memory token must not be used by the API client while the app
      // reports a failed sign-in and cannot restore that session on launch.
      await storage.setItemAsync(SESSION_TOKEN_KEY, token);
      cached = token;
    },
    async clear(): Promise<void> {
      cached = null;
      await storage.deleteItemAsync(SESSION_TOKEN_KEY);
    },
    // Synchronous read for the API client's per-request getToken hook.
    current(): string | null {
      return cached ?? null;
    }
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
