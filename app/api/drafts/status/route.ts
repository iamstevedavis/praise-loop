import { draftMutation } from "../../../../lib/services/draftLifecycle";
import { ownerRoute } from "../../../../lib/authorization";
import { NextRequest, NextResponse } from "next/server";
import { query } from "../../../../lib/db";

async function handlePOST(req: NextRequest) {
  const body = await req.json();
  const draftPostId = Number(body?.draftPostId);
  const status = String(body?.status ?? "").trim();
  const auditNote = String(body?.auditNote ?? "").trim() || null;

  if (!Number.isInteger(draftPostId) || draftPostId <= 0) {
    return NextResponse.json({ error: "valid draftPostId is required" }, { status: 400 });
  }

  if (!["draft", "approved", "archived", "shared"].includes(status)) {
    return NextResponse.json({ error: "status must be draft, approved, archived or shared" }, { status: 400 });
  }

  const result = await query<{
    id: number;
    status: string;
    audit_note: string | null;
    shared_at: string | null;
    updated_at: string;
  }>(
    `UPDATE draft_posts
     SET status = $2,
         audit_note = $3,
         shared_at = CASE WHEN $2 = 'shared' THEN NOW() ELSE shared_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, status, audit_note, shared_at::text, updated_at::text`,
    [draftPostId, status, auditNote]
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: "draft post not found" }, { status: 404 });
  }

  return NextResponse.json({ draft: result.rows[0] });
}

export const POST = ownerRoute(draftMutation("status", handlePOST));
