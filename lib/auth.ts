import type { NextAuthOptions } from "next-auth";
import { cookies } from "next/headers";
import GoogleProvider from "next-auth/providers/google";
import { authAdapter } from "./auth-adapter";
import { signInWithIdentity, type AuthIdentity } from "./authLinking";

type GoogleProfile = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
};

// The owner who started a link from an already signed-in page. The OAuth callback
// still carries the session cookie, which is the proof that this is an add-method
// action rather than a fresh sign-in.
async function signedInOwner() {
  try {
    const store = await cookies();
    const token = store.get("__Secure-next-auth.session-token")?.value ?? store.get("next-auth.session-token")?.value;
    if (!token || token.length > 512) return null;
    return (await authAdapter.getSessionAndUser!(token))?.user.id ?? null;
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  adapter: authAdapter, secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "database", maxAge: 8 * 60 * 60 },
  providers: [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" })],
  // Every provider sign-in goes through the shared linking policy before NextAuth
  // creates a session. The adapter row is written first, so NextAuth's callback
  // handler finds the same owner the policy chose instead of making a second one.
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      const google = profile as GoogleProfile | undefined;
      const verified = google?.email_verified === true || google?.email_verified === "true";
      if (!verified || typeof google?.email !== "string" || !google.email.trim()) return false;
      const subject = typeof account.providerAccountId === "string" && account.providerAccountId
        ? account.providerAccountId
        : typeof google.sub === "string" ? google.sub : "";
      if (!subject) return false;
      const identity: AuthIdentity = {
        provider: "google",
        subject,
        email: google.email,
        emailVerified: true,
        name: typeof google.name === "string" ? google.name : null
      };
      const linkToOwner = await signedInOwner();
      const result = await signInWithIdentity(identity, linkToOwner ? { linkToOwner } : {});
      return result.ok;
    }
  },
  logger: { error: code => console.error("auth_error", code), warn: code => console.warn("auth_warning", code), debug: () => {} }
};
export function authConfigured() { return !!(process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_URL && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
