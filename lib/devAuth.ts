import { query } from "./db";

// Demo sign-in for walking the phone flow with synthetic data. It is deliberately
// hard to turn on: the flag must be set *and* the process must not be a production
// build. `next start` (including the production Compose stack) runs with
// NODE_ENV=production, so a stray MOBILE_DEV_AUTH in a server `.env` still cannot
// mint sessions.
export const DEV_OWNER_ID = "dev-owner";
export const DEV_OWNER_EMAIL = "demo@praiseloop.invalid";
export const DEV_OWNER_NAME = "Demo Owner";

export function devAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MOBILE_DEV_AUTH === "1" && env.NODE_ENV !== "production";
}

// The demo owner is an ordinary auth_users row, so every existing ownership check,
// limit and audit trail applies exactly as it does for a real Google owner.
export async function ensureDevOwner(): Promise<string> {
  await query(
    `INSERT INTO auth_users(id,name,email,"emailVerified") VALUES($1,$2,$3,now())
     ON CONFLICT(id) DO NOTHING`,
    [DEV_OWNER_ID, DEV_OWNER_NAME, DEV_OWNER_EMAIL]
  );
  return DEV_OWNER_ID;
}
