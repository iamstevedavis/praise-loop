import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authConfigured, authOptions } from "../../../../lib/auth";
const handler = NextAuth(authOptions);
async function auth(req: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  if (!authConfigured()) return NextResponse.json({ error: "Owner sign-in needs NEXTAUTH_URL and NEXTAUTH_SECRET" }, { status: 503 });
  return handler(req, { params: await context.params });
}
export { auth as GET, auth as POST };
