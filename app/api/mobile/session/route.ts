import { NextRequest, NextResponse } from "next/server";
import { verifyGoogleIdToken } from "../../../../lib/googleIdToken";
import { findOrCreateGoogleOwner, recordFailure, tooManyFailures } from "../../../../lib/mobileSignIn";
import { createMobileSession } from "../../../../lib/mobileSessions";

// Public by design: this is where a bearer session is born. Exchanges a Google ID
// token from native Google Sign-In for a mobile session. Neither token is logged.
export async function POST(req: NextRequest) {
  const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const client = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (tooManyFailures(client)) return reply(429, { error: "Too many failed sign-in attempts; try again later" });
    const declared = Number(req.headers.get("content-length") ?? 0);
    let idToken: unknown;
    if (declared <= 8192) { try { idToken = (await req.json())?.idToken; } catch { /* handled below */ } }
    const identity = typeof idToken === "string" ? await verifyGoogleIdToken(idToken) : null;
    if (!identity) { recordFailure(client); return reply(401, { error: "Invalid Google sign-in" }); }
    const session = await createMobileSession(await findOrCreateGoogleOwner(identity));
    return reply(200, { token: session.token, expires: session.expires });
  } catch { return reply(500, { error: "Sign-in failed; retry" }); }
}
