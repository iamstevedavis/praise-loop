import { NextRequest, NextResponse } from "next/server";
import { EmailSignInNotConfiguredError, normalizeEmail, requestEmailCode } from "../../../../../lib/emailAuth";
import { clientIp } from "../../../../../lib/requestIp";

// Public by design: the first half of email sign-in. It always answers the same
// way for a valid address, whether or not it belongs to an owner.
export const dynamic = "force-dynamic";

async function readLimited(req: NextRequest, max: number) {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error("body too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function crossSite(req: NextRequest) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  const expected = process.env.NEXTAUTH_URL;
  // Native apps and curl send no Origin; a browser that does must match the site.
  return !!origin && (!expected || origin !== new URL(expected).origin);
}

const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  if (crossSite(req)) return reply(403, { error: "Same-origin request required" });
  let body: { email?: unknown };
  try { body = JSON.parse(await readLimited(req, 4096)) ?? {}; } catch { return reply(400, { error: "Enter a valid email address" }); }
  const email = normalizeEmail(body.email);
  if (!email) return reply(400, { error: "Enter a valid email address" });
  try {
    await requestEmailCode(email, clientIp(req));
  } catch (error) {
    if (error instanceof EmailSignInNotConfiguredError) return reply(503, { error: "Email sign-in is not configured" });
    return reply(500, { error: "Could not send a code; retry" });
  }
  return reply(200, { ok: true, message: "If that address can sign in, we’ve sent a code." });
}
