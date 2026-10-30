import { ownerRoute, currentOwner } from "../../../lib/authorization";
import { profileFor, setOwnerName } from "../../../lib/services/profile";
import { NextRequest, NextResponse } from "next/server";

// The signed-in owner's own profile. Read-only data for both clients, with a
// PATCH for the display name only: the email is the verified Google identity.
// No provider tokens are stored, so none are returned, and no other owner's
// row is reachable because the id comes from the session.
async function handleGET() {
  return NextResponse.json(await profileFor(currentOwner()));
}

async function handlePATCH(req: NextRequest) {
  const body = await req.json().catch(() => null) as { name?: unknown } | null;
  const result = await setOwnerName(currentOwner(), body?.name);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}

export const GET = ownerRoute(handleGET);
export const PATCH = ownerRoute(handlePATCH);
