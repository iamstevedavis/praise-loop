import { randomUUID } from "node:crypto";
import { query } from "./db";
import type { GoogleIdentity } from "./googleIdToken";

// Same identity as the web: auth_accounts(provider='google', provider_account_id=sub).
// A web owner who signed in with the same verified Google email but has no account
// row yet is linked rather than duplicated. No Google tokens are stored.
export async function findOrCreateGoogleOwner(identity: GoogleIdentity) {
  const existing = (await query<{ owner_id: string }>("SELECT owner_id FROM auth_accounts WHERE provider='google' AND provider_account_id=$1", [identity.sub])).rows[0];
  if (existing) return existing.owner_id;
  const owner = (await query<{ id: string }>(
    `INSERT INTO auth_users(id,name,email,"emailVerified") VALUES($1,$2,$3,now())
     ON CONFLICT(email) DO UPDATE SET email = auth_users.email RETURNING id`,
    [randomUUID(), identity.name, identity.email]
  )).rows[0].id;
  // The email fallback only links an owner that has no Google account yet. A different subject presenting
  // an already-linked email (a reassigned address) must not inherit that owner's data.
  const linked = await query("SELECT 1 FROM auth_accounts WHERE provider='google' AND owner_id=$1 AND provider_account_id<>$2", [owner, identity.sub]);
  if (linked.rowCount) return null;
  await query("INSERT INTO auth_accounts(provider,provider_account_id,owner_id) VALUES('google',$1,$2) ON CONFLICT DO NOTHING", [identity.sub, owner]);
  // A concurrent first sign-in may have linked the sub to a different row; the account row wins.
  return (await query<{ owner_id: string }>("SELECT owner_id FROM auth_accounts WHERE provider='google' AND provider_account_id=$1", [identity.sub])).rows[0].owner_id;
}

// Failed-attempt limiter, per client key, in process memory. Resets on restart and
// is not shared between web replicas; fine for a single-instance pilot (docs/auth.md).
const FAIL_LIMIT = 10, FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();
export function tooManyFailures(key: string, now = Date.now()) {
  const recent = (failures.get(key) ?? []).filter(t => now - t < FAIL_WINDOW_MS);
  if (recent.length) failures.set(key, recent); else failures.delete(key);
  return recent.length >= FAIL_LIMIT;
}
export function recordFailure(key: string, now = Date.now()) {
  if (failures.size > 10000) failures.clear();
  failures.set(key, [...(failures.get(key) ?? []), now]);
}
export function resetFailures() { failures.clear(); }
