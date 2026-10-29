import * as SecureStore from "expo-secure-store";
import { createSessionStore } from "./sessionStore";

// The single keychain-backed store the app reads from. Kept separate from
// session.ts so the API client can ask for the token without a module cycle.
export const sessionStore = createSessionStore(SecureStore);
