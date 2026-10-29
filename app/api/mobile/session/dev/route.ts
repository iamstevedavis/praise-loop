import { NextResponse } from "next/server";
import { devAuthEnabled, ensureDevOwner } from "../../../../../lib/devAuth";
import { createMobileSession } from "../../../../../lib/mobileSessions";

// Demo-only counterpart to POST /api/mobile/session: no Google token, a fixed
// synthetic owner. Available only in a development process with MOBILE_DEV_AUTH=1
// (see lib/devAuth.ts); otherwise it answers exactly like an unknown route.
export async function POST() {
  if (!devAuthEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const owner = await ensureDevOwner();
    const session = await createMobileSession(owner);
    return NextResponse.json(
      { token: session.token, expires: session.expires, owner },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Sign-in failed; retry" }, { status: 500 });
  }
}
