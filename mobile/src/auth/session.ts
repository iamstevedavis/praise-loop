import { api } from "../api";
import { sessionStore } from "./store";
import { signInWithEmailCode } from "./email";

// Demo sign-in. The route only exists on a development server started with
// MOBILE_DEV_AUTH=1; production and every other build answer 404.
export async function signInDemo(): Promise<void> {
  const session = await api.request<{ token?: unknown }>("/api/mobile/session/dev", { method: "POST" });
  if (typeof session?.token !== "string" || session.token.length === 0) {
    throw new Error("The demo sign-in response was invalid.");
  }
  await sessionStore.save(session.token);
}

// Email one-time code (#157): the server verifies the code and returns a normal
// bearer session, which is stored exactly like the demo and Google paths.
export async function signInWithEmail(email: string, code: string): Promise<void> {
  const token = await signInWithEmailCode(api, email, code);
  await sessionStore.save(token);
}

// Revoking is best-effort: the local token is cleared even when the server is
// unreachable, so the next launch starts signed out.
export async function signOut(): Promise<void> {
  try {
    await api.request("/api/mobile/session/revoke", { method: "POST" });
  } catch {
    // Ignored on purpose.
  }
  await sessionStore.clear();
}
