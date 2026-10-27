import { NextResponse } from "next/server";
import { currentSession, ownerRoute } from "../../../../lib/authorization";
import { query } from "../../../../lib/db";
import { PUSH_TOKEN_PATTERN } from "../../../../lib/services/push";

async function body(req: Request) { try { const b = await req.json(); return b && typeof b === "object" ? b as Record<string, unknown> : {}; } catch { return {}; } }
const owner = () => currentSession()!.owner;

// Register or refresh a device. A token re-registered by another owner (shared
// device, new sign-in) moves to that owner so the previous owner stops receiving it.
export const POST = ownerRoute(async req => {
  const { token, platform } = await body(req);
  if (typeof token !== "string" || !PUSH_TOKEN_PATTERN.test(token)) return NextResponse.json({ error: "Valid Expo push token required" }, { status: 400 });
  if (platform !== "ios" && platform !== "android") return NextResponse.json({ error: "platform must be ios or android" }, { status: 400 });
  await query(`INSERT INTO device_push_tokens(owner_id, token, platform) VALUES($1,$2,$3)
    ON CONFLICT(token) DO UPDATE SET owner_id=EXCLUDED.owner_id, platform=EXCLUDED.platform, last_seen_at=now()`, [owner(), token, platform]);
  return NextResponse.json({ registered: true });
});

// Unregister on sign-out. Only the owning account can remove a token.
export const DELETE = ownerRoute(async req => {
  const { token } = await body(req);
  if (typeof token !== "string" || !PUSH_TOKEN_PATTERN.test(token)) return NextResponse.json({ error: "Valid Expo push token required" }, { status: 400 });
  const res = await query("DELETE FROM device_push_tokens WHERE token=$1 AND owner_id=$2", [token, owner()]);
  return NextResponse.json({ removed: !!res.rowCount });
});
