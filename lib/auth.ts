import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { authAdapter } from "./auth-adapter";
export const authOptions: NextAuthOptions = {
  adapter: authAdapter, secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "database", maxAge: 8 * 60 * 60 },
  providers: [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" })],
  logger: { error: code => console.error("auth_error", code), warn: code => console.warn("auth_warning", code), debug: () => {} }
};
export function authConfigured() { return !!(process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_URL && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
