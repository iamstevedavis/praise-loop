import { ownerRoute, currentOwner } from "../../../lib/authorization";
import { entitlementsFor } from "../../../lib/services/entitlements";
import { NextResponse } from "next/server";

// Read-only for owners: plan changes come from this operator script or a
// verified store webhook (#95), never from the app itself.
async function handleGET() {
  return NextResponse.json(await entitlementsFor(currentOwner()));
}

export const GET = ownerRoute(handleGET);
