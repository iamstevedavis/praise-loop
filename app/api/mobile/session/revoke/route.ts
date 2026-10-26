import { NextResponse } from "next/server";
import { currentSession, ownerRoute } from "../../../../../lib/authorization";
import { revokeSession } from "../../../../../lib/mobileSessions";

export const POST = ownerRoute(async () => {
  const session = currentSession();
  if (!session) return NextResponse.json({ error: "No session" }, { status: 401 });
  await revokeSession(session.token);
  return NextResponse.json({ revoked: true });
});
