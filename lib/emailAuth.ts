import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { signInWithIdentity } from "./authLinking";
import { query, transaction } from "./db";
import { EmailError, getEmailTransport, oneTimeCodeEmail, sendEmail } from "./email";

// Sign-in by email one-time code (#157). Codes are short-lived, single use,
// superseded by a newer request, limited in wrong guesses, and stored only as an
// HMAC keyed with NEXTAUTH_SECRET. Responses never reveal whether an address has
// an owner: only a malformed code or an exhausted code is rejected.
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
// Wrong guesses allowed per address across all of its codes before the address is refused for a while.
export const ADDRESS_MAX_FAILURES = 15;
export const ADDRESS_FAILURE_WINDOW_MINUTES = 60;
const CODE_PATTERN = /^\d{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_PER_ADDRESS = 5;
const REQUEST_PER_IP = 20;

export class EmailSignInNotConfiguredError extends Error {
  constructor() { super("Email sign-in is not configured"); this.name = "EmailSignInNotConfiguredError"; }
}

// Missing NEXTAUTH_SECRET, or a transport that cannot send, is a server-wide
// configuration problem: the route may say so without revealing any address.
export function emailSignInConfigured(): boolean {
  if (!secret()) return false;
  try { getEmailTransport(); return true; } catch { return false; }
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function secret(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.NEXTAUTH_SECRET?.trim();
  return value ? value : null;
}

function hashCode(email: string, code: string, key: string): string {
  return createHmac("sha256", key).update(`${email}:${code}`).digest("hex");
}

const requests = new Map<string, number[]>();

function recentRequests(key: string, now: number) {
  const recent = (requests.get(key) ?? []).filter(at => now - at < REQUEST_WINDOW_MS);
  if (recent.length) requests.set(key, recent); else requests.delete(key);
  return recent;
}

function recordRequest(key: string, now: number) {
  requests.set(key, [...recentRequests(key, now), now]);
  if (requests.size > 10000) {
    for (const [name, times] of requests) if (!times.some(at => now - at < REQUEST_WINDOW_MS)) requests.delete(name);
  }
}

export function resetEmailCodeThrottle() { requests.clear(); }

export type EmailCodeRequest = "sent" | "throttled";

// Always resolves the same way for a valid address. A throttled request sends
// nothing and is indistinguishable from a delivered one to the caller.
export async function requestEmailCode(email: string, ip: string, now = Date.now()): Promise<EmailCodeRequest> {
  const key = secret();
  if (!key || !emailSignInConfigured()) throw new EmailSignInNotConfiguredError();
  const addressKey = `address:${email}`, ipKey = `ip:${ip}`;
  const allowed = recentRequests(addressKey, now).length < REQUEST_PER_ADDRESS
    && recentRequests(ipKey, now).length < REQUEST_PER_IP;
  if (!allowed) return "throttled";
  recordRequest(addressKey, now);
  recordRequest(ipKey, now);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = hashCode(email, code, key);

  // Send first. If the message cannot be sent (the transport's own hourly budget, a provider outage),
  // the code that was already delivered must stay valid, so nothing in the database changes. The
  // caller gets the same generic answer either way.
  try {
    await sendEmail({ to: email, ...oneTimeCodeEmail(code, { minutes: CODE_TTL_MS / 60000 }) });
  } catch (error) {
    // Keep only a sanitized code in the log.
    const reason = error instanceof EmailError ? error.code : "email_send_failed";
    console.error(JSON.stringify({ event: "email_send_failed", reason }));
    return "sent";
  }

  await transaction(async () => {
    // Serialize replacement for one address. Without this, two concurrent requests
    // could both see no active row, insert, and leave two unsuperseded codes.
    await query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [email]);
    await query(
      "UPDATE email_sign_in_codes SET superseded_at=now() WHERE email=$1 AND consumed_at IS NULL AND superseded_at IS NULL",
      [email]
    );
    await query(
      "INSERT INTO email_sign_in_codes(email,code_hash,expires_at) VALUES($1,$2,$3)",
      [email, hash, new Date(now + CODE_TTL_MS)]
    );
  });
  return "sent";
}

// Returns the owner on success. Wrong, expired, reused, superseded and exhausted
// codes all return null with no detail for the caller.
export async function verifyEmailCode(email: string, code: string, now = Date.now()): Promise<string | null> {
  const key = secret();
  if (!key || !CODE_PATTERN.test(code)) return null;
  return transaction(async () => {
    const row = (await query<{ id: string; code_hash: string; attempts: number; expires_at: Date }>(
      `SELECT id,code_hash,attempts,expires_at FROM email_sign_in_codes
       WHERE email=$1 AND consumed_at IS NULL AND superseded_at IS NULL
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email]
    )).rows[0];
    if (!row) return null;
    // A fresh code resets its own guess count, so an attacker who keeps requesting codes would get five
    // more guesses each time. Cap the wrong guesses across every code for this address as well. This
    // lives in Postgres, so a restart or a second web replica does not reset it.
    const failed = Number((await query<{ n: string }>(
      "SELECT coalesce(sum(attempts),0) AS n FROM email_sign_in_codes WHERE email=$1 AND created_at > now() - ($2 * interval '1 minute')",
      [email, ADDRESS_FAILURE_WINDOW_MINUTES]
    )).rows[0].n);
    if (failed >= ADDRESS_MAX_FAILURES) return null;
    if (row.expires_at.getTime() <= now || row.attempts >= CODE_MAX_ATTEMPTS) {
      await query("UPDATE email_sign_in_codes SET consumed_at=coalesce(consumed_at,now()) WHERE id=$1", [row.id]);
      return null;
    }
    const expected = Buffer.from(row.code_hash, "hex");
    const actual = Buffer.from(hashCode(email, code, key), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await query("UPDATE email_sign_in_codes SET attempts=attempts+1 WHERE id=$1", [row.id]);
      return null;
    }
    await query("UPDATE email_sign_in_codes SET consumed_at=now() WHERE id=$1", [row.id]);
    return findOrCreateEmailOwner(email);
  });
}

// The linking policy (#156) lives in lib/authLinking.ts and is shared with Google: a code proves
// control of the address, so an owner already known by that address keeps one owner and gains an
// email method (with its added and last-used times), and concurrent first sign-ins are serialized
// there. Returns null when the policy refuses the sign-in.
export async function findOrCreateEmailOwner(email: string): Promise<string | null> {
  const result = await signInWithIdentity({ provider: "email", subject: email, email, emailVerified: true });
  if (!result.ok) return null;
  // The code proved control of the mailbox, so the address now counts as verified.
  await query(`UPDATE auth_users SET "emailVerified"=coalesce("emailVerified",now()) WHERE id=$1`, [result.ownerId]);
  return result.ownerId;
}
