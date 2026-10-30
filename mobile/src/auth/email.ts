import type { ApiClient } from "../api/client";

// Email one-time-code sign-in (#157). Kept behind an ApiClient so the phone
// screen and the tests share one request shape.
export async function requestEmailCode(client: ApiClient, email: string): Promise<void> {
  await client.request("/api/auth/email/request", { method: "POST", body: { email } });
}

export async function signInWithEmailCode(client: ApiClient, email: string, code: string): Promise<string> {
  const session = await client.request<{ token?: unknown }>("/api/mobile/session/email", {
    method: "POST",
    body: { email, code }
  });
  if (typeof session?.token !== "string" || session.token.length === 0) {
    throw new Error("The email sign-in response was invalid.");
  }
  return session.token;
}
