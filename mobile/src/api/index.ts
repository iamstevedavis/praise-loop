import { createApiClient } from "./client";
import { appConfig } from "../config";
import { sessionStore } from "../auth/store";

// Every owner route takes the bearer token from the keychain. Before the first
// load resolves this returns null, so a request made too early gets a 401 rather
// than silently running unauthenticated.
export const api = createApiClient({
  baseUrl: appConfig.apiBaseUrl,
  getToken: () => sessionStore.current()
});
