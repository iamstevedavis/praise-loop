import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { authAdapter } from "./auth-adapter";

// Google is optional: an owner can sign in by email even when an organisation has
// no Google credentials. NextAuth still handles sessions and sign-out with an empty
// provider list, which keeps the email session's sign-out button working.
const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  adapter: authAdapter, secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "database", maxAge: 8 * 60 * 60 },
  providers: googleConfigured ? [GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
  })] : [],
  logger: { error: code => console.error("auth_error", code), warn: code => console.warn("auth_warning", code), debug: () => {} }
};

// Session and sign-out endpoints only need the session machinery. Google sign-in
// additionally needs its own client, checked by googleSignInConfigured below.
export function authConfigured() { return !!(process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_URL); }
export function googleSignInConfigured() { return googleConfigured; }
