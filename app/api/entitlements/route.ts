import { ownerRoute, currentOwner } from "../../../lib/authorization";
import { entitlementsWithUsage } from "../../../lib/services/planUsage";
import { NextResponse } from "next/server";

// Read-only for owners: plan changes come from this operator script or a
// verified store webhook (#95), never from the app itself. Usage is this week's
// generation period per owned business, so the apps never recompute limits.
async function handleGET() {
  return NextResponse.json(await entitlementsWithUsage(currentOwner()));
}

export const GET = ownerRoute(handleGET);
