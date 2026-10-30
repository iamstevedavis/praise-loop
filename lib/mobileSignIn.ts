import type { GoogleIdentity } from "./googleIdToken";
import { signInWithIdentity } from "./authLinking";

// Same identity as the web: auth_accounts(provider='google', provider_account_id=sub).
// The linking policy (including the verified-email fallback and the rejection of a
// different Google subject) lives in lib/authLinking.ts and is shared by web and
// phone. No Google tokens are stored.
export async function findOrCreateGoogleOwner(identity: GoogleIdentity) {
  const result = await signInWithIdentity({
    provider: "google",
    subject: identity.sub,
    email: identity.email,
    emailVerified: true,
    name: identity.name
  });
  return result.ok ? result.ownerId : null;
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
