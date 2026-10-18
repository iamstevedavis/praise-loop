import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authConfigured, authOptions } from "../../../../lib/auth";
const handler = NextAuth(authOptions);
async function auth(req: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  if (!authConfigured()) return NextResponse.json({ error: "Owner login needs NEXTAUTH_URL/SECRET and Google OAuth client configuration" }, { status: 503 });
  return handler(req, { params: await context.params });
}
export { auth as GET, auth as POST };
