import { query } from "./db";

// Demo sign-in for walking the phone flow with synthetic data. It is deliberately
// hard to turn on: the flag must be set *and* the process must not be a production
// build. `next start` (including the production Compose stack) runs with
// NODE_ENV=production, so a stray MOBILE_DEV_AUTH in a server `.env` still cannot
// mint sessions.
export const DEV_OWNER_ID = "dev-owner";
export const DEV_OWNER_EMAIL = "demo@praiseloop.invalid";
export const DEV_OWNER_NAME = "Demo Owner";

// The seeder also creates a Free owner so the plan limits and watermark can be seen,
// and an email-only owner so the email-code sign-in (#157) can be walked without a
// mailbox. `pro` is the default demo owner above.
export const DEV_OWNERS = {
  pro: { id: DEV_OWNER_ID, email: DEV_OWNER_EMAIL, name: DEV_OWNER_NAME },
  free: { id: "dev-owner-free", email: "demo-free@praiseloop.invalid", name: "Demo Free Owner" },
  email: { id: "dev-owner-email", email: "demo-email@praiseloop.invalid", name: "Demo Email Owner", provider: "email" as const }
};
export type DevOwnerKey = keyof typeof DEV_OWNERS;

export function devAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MOBILE_DEV_AUTH === "1" && env.NODE_ENV !== "production";
}

// The demo owner is an ordinary auth_users row, so every existing ownership check,
// limit and audit trail applies exactly as it does for a real Google owner.
export async function ensureDevOwner(which: DevOwnerKey = "pro"): Promise<string> {
  const owner = DEV_OWNERS[which];
  await query(
    `INSERT INTO auth_users(id,name,email,"emailVerified") VALUES($1,$2,$3,now())
     ON CONFLICT(id) DO NOTHING`,
    [owner.id, owner.name, owner.email]
  );
  // The email-only owner has the same auth_accounts row a real email sign-in creates.
  if ("provider" in owner && owner.provider === "email") {
    await query(
      "INSERT INTO auth_accounts(provider,provider_account_id,owner_id) VALUES('email',$1,$2) ON CONFLICT DO NOTHING",
      [owner.email, owner.id]
    );
  }
  return owner.id;
}
