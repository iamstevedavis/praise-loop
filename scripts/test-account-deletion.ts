import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { databaseFixture } from "./db-fixture";
import { sessionHash } from "../lib/auth-adapter";
import { createMobileSession } from "../lib/mobileSessions";
import { mediaFilename, removeMediaFiles } from "../lib/services/accountDeletion";

const PERIOD = "2026-10-26";

type Seeded = {
  owner: string;
  businessId: number;
  reviewId: number;
  draftIds: number[];
  webToken: string;
  mobileToken: string;
  emails: string[];
};

async function seedOwner(client: PoolClient, owner: string, label: string, withDirectory = false): Promise<Seeded> {
  const email = `${owner}@example.invalid`;
  const alias = `alias-${owner}@example.invalid`;
  const webToken = `${owner}-web-session`;
  await client.query("INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)", [owner, `Synthetic ${label}`, email]);
  await client.query(
    "INSERT INTO auth_accounts(provider,provider_account_id,owner_id,email) VALUES('google',$1,$2,$3)",
    [`sub-${owner}`, owner, alias]
  );
  await client.query(
    "INSERT INTO auth_sessions(token_hash,owner_id,expires,kind) VALUES($1,$2,now()+interval '1 hour','web')",
    [sessionHash(webToken), owner]
  );
  const mobile = await createMobileSession(owner);
  await client.query("INSERT INTO owner_usage(owner_id,day,kind,calls) VALUES($1,current_date,'generation',2)", [owner]);
  await client.query("INSERT INTO owner_plans(owner_id,plan) VALUES($1,'free')", [owner]);
  await client.query(
    "INSERT INTO owner_plan_events(owner_id,plan,source,actor,reason) VALUES($1,'free','manual','test','Synthetic event')",
    [owner]
  );
  await client.query(
    "INSERT INTO device_push_tokens(owner_id,token,platform) VALUES($1,$2,'ios')",
    [owner, `ExponentPushToken[${owner}]`]
  );
  const business = (await client.query(
    "INSERT INTO businesses(name,timezone,owner_id,logo_url) VALUES($1,'UTC',$2,$3) RETURNING id",
    [`Synthetic ${label}`, owner, `/api/media/logo-${owner}.png`]
  )).rows[0].id;
  const review = (await client.query(
    "INSERT INTO reviews(business_id,source,rating,text,reviewed_at) VALUES($1,'manual',5,'Synthetic deletion review','2026-10-01') RETURNING id",
    [business]
  )).rows[0].id;
  const draft = (await client.query(
    "INSERT INTO draft_posts(business_id,review_id,quote_text,caption_text,image_path) VALUES($1,$2,'Synthetic quote','Synthetic caption',$3) RETURNING id",
    [business, review, `/api/media/draft-${owner}.png`]
  )).rows[0].id;
  const extra = (await client.query(
    "INSERT INTO draft_posts(business_id,quote_text,caption_text,image_path) VALUES($1,'Synthetic extra','Synthetic extra',$2) RETURNING id",
    [business, `/api/media/../outside-${owner}.png`]
  )).rows[0].id;
  const draftIds = [draft, extra];
  if (withDirectory) {
    draftIds.push((await client.query(
      "INSERT INTO draft_posts(business_id,quote_text,caption_text,image_path) VALUES($1,'Synthetic dir','Synthetic dir',$2) RETURNING id",
      [business, `/api/media/draft-dir-${owner}.png`]
    )).rows[0].id);
  }
  await client.query(
    "INSERT INTO generation_periods(business_id,period_start,timezone,target,allocated,completed) VALUES($1,$2,'UTC',3,1,1)",
    [business, PERIOD]
  );
  await client.query(
    "INSERT INTO generation_jobs(business_id,period_start,draft_id,state) VALUES($1,$2,$3,'complete')",
    [business, PERIOD, draft]
  );
  await client.query(
    "INSERT INTO draft_events(draft_id,actor_id,action,reason,from_status,to_status) VALUES($1,$2,'approve','Synthetic','draft','approved')",
    [draft, owner]
  );
  await client.query(
    "INSERT INTO posting_slot_claims(business_id,instant,draft_id,state) VALUES($1,'2026-11-02T10:00:00Z',$2,'pending')",
    [business, draft]
  );
  await client.query(
    "INSERT INTO google_connections(business_id,owner_id,location_name) VALUES($1,$2,'accounts/1/locations/2')",
    [business, owner]
  );
  await client.query(
    "INSERT INTO push_deliveries(business_id,period_start,token,count) VALUES($1,$2,$3,1)",
    [business, PERIOD, `ExponentPushToken[delivery-${owner}]`]
  );
  await client.query(
    "INSERT INTO email_sign_in_codes(email,code_hash,expires_at) VALUES($1,'hash-a',now()+interval '10 minutes'),($2,'hash-b',now()+interval '10 minutes')",
    [email, alias]
  );
  return { owner, businessId: business, reviewId: review, draftIds, webToken, mobileToken: mobile.token, emails: [email, alias] };
}

// Every table an owner or their businesses can own. Scanning information_schema
// makes a table added later fail this test instead of silently keeping rows.
async function ownershipCounts(client: PoolClient, owner: string, businessIds: number[]) {
  const columns = (await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema=current_schema() AND column_name IN ('owner_id','business_id')`
  )).rows;
  const tables = new Map<string, Set<string>>();
  for (const row of columns) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
    tables.get(row.table_name)!.add(row.column_name);
  }
  const counts: Record<string, number> = {};
  for (const [table, cols] of tables) {
    const byOwner = cols.has("owner_id");
    const result = await client.query(
      `SELECT count(*) FROM "${table}" WHERE ${byOwner ? "owner_id=$1" : "business_id = ANY($1::bigint[])"}`,
      [byOwner ? owner : businessIds]
    );
    counts[table] = Number(result.rows[0].count);
  }
  return counts;
}

async function codeCount(client: PoolClient, emails: string[]) {
  return Number((await client.query(
    "SELECT count(*) FROM email_sign_in_codes WHERE lower(email) = ANY($1::text[])",
    [emails.map(email => email.toLowerCase())]
  )).rows[0].count);
}

function cookieRequest(token: string, method = "GET", body?: unknown, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/account", {
    method,
    headers: {
      cookie: `next-auth.session-token=${token}`,
      origin,
      "content-type": "application/json"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function bearerRequest(token: string, method = "GET", body?: unknown) {
  return new NextRequest("http://localhost/api/account", {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function main() {
  process.env.NEXTAUTH_URL = "http://localhost";
  const root = mkdtempSync(join(tmpdir(), "account-deletion-media-"));
  const outside = resolve(root, "..", "outside-delete-a.png");
  process.env.MEDIA_ROOT = root;
  try {
    await databaseFixture(async client => {
      const a = await seedOwner(client, "delete-a", "A", true);
      const b = await seedOwner(client, "delete-b", "B");
      const d = await seedOwner(client, "delete-d", "D");

      // Owner A's media, plus a traversal target outside MEDIA_ROOT. The directory
      // named like an image makes the real cleanup fail for one file.
      for (const name of ["draft-delete-a.png", "logo-delete-a.png"]) writeFileSync(join(root, name), Buffer.from([137, 80, 78, 71]));
      mkdirSync(join(root, "draft-dir-delete-a.png"));
      writeFileSync(outside, Buffer.from([137, 80, 78, 71]));
      for (const name of ["draft-delete-b.png", "logo-delete-b.png"]) writeFileSync(join(root, name), Buffer.from([137, 80, 78, 71]));

      // A file that both A and B reference (images are content-addressed, so identical posts share one).
      writeFileSync(join(root, "shared-delete.png"), Buffer.from([137, 80, 78, 71]));
      for (const owner of [a, b]) {
        await client.query(
          "INSERT INTO draft_posts(business_id,quote_text,caption_text,image_path) VALUES($1,'Synthetic shared','Synthetic shared','/api/media/shared-delete.png')",
          [owner.businessId]
        );
      }

      const route = require("../app/api/account/route");
      const businesses = require("../app/api/businesses/route").GET;

      const beforeA = await ownershipCounts(client, a.owner, [a.businessId]);
      const beforeB = await ownershipCounts(client, b.owner, [b.businessId]);
      for (const table of [
        "auth_accounts", "auth_sessions", "owner_usage", "owner_plans",
        "owner_plan_events", "device_push_tokens", "businesses", "google_connections",
        "reviews", "draft_posts", "generation_periods", "generation_jobs",
        "posting_slot_claims", "push_deliveries"
      ]) {
        assert.ok(beforeA[table] > 0, `${table} has owner A data before deletion`);
      }
      assert.equal(await codeCount(client, a.emails), 2);
      assert.equal(await codeCount(client, b.emails), 2);
      assert.equal((await client.query(
        "SELECT count(*) FROM draft_events WHERE draft_id = ANY($1::bigint[])", [a.draftIds]
      )).rows[0].count, "1");

      // A wrong or missing confirmation changes nothing, for either session kind.
      assert.equal((await route.DELETE(cookieRequest(b.webToken, "DELETE", { confirm: "delete" }))).status, 400);
      assert.equal((await route.DELETE(cookieRequest(b.webToken, "DELETE"))).status, 400);
      assert.equal((await route.DELETE(bearerRequest(b.mobileToken, "DELETE", { confirm: "DELETE " }))).status, 400);
      assert.equal((await route.DELETE(cookieRequest(b.webToken, "DELETE", { confirm: "DELETE" }, "https://foreign.invalid"))).status, 403);
      assert.deepEqual(await ownershipCounts(client, b.owner, [b.businessId]), beforeB);
      assert.equal(await codeCount(client, b.emails), 2);
      assert.ok(existsSync(join(root, "draft-delete-b.png")));

      // Cookie session deletion: 200, cookie cleared, everything of A gone.
      const deleted = await route.DELETE(cookieRequest(a.webToken, "DELETE", { confirm: "DELETE" }));
      assert.equal(deleted.status, 200);
      assert.deepEqual(await deleted.json(), { ok: true });
      const cleared = deleted.headers.get("set-cookie") ?? "";
      assert.match(cleared, /next-auth\.session-token=/);
      assert.match(cleared, /Expires=Thu, 01 Jan 1970/);

      const afterA = await ownershipCounts(client, a.owner, [a.businessId]);
      for (const [table, count] of Object.entries(afterA)) assert.equal(count, 0, `${table} still has owner A rows`);
      assert.equal((await client.query("SELECT count(*) FROM auth_users WHERE id=$1", [a.owner])).rows[0].count, "0");
      assert.equal((await client.query(
        "SELECT count(*) FROM draft_events WHERE draft_id = ANY($1::bigint[])", [a.draftIds]
      )).rows[0].count, "0");
      assert.equal(await codeCount(client, a.emails), 0);
      assert.equal((await route.DELETE(cookieRequest(a.webToken, "DELETE", { confirm: "DELETE" }))).status, 401);

      // B is untouched: same rows, same code, same media, still signed in.
      assert.deepEqual(await ownershipCounts(client, b.owner, [b.businessId]), beforeB);
      assert.equal(await codeCount(client, b.emails), 2);
      for (const name of ["draft-delete-b.png", "logo-delete-b.png", "shared-delete.png"]) assert.ok(existsSync(join(root, name)), `${name} remains`);
      assert.equal((await businesses(cookieRequest(b.webToken))).status, 200);
      assert.equal((await businesses(bearerRequest(b.mobileToken))).status, 200);

      // A's files are gone; the failed directory removal did not fail the request,
      // and the traversal target outside MEDIA_ROOT was never touched.
      for (const name of ["draft-delete-a.png", "logo-delete-a.png"]) assert.equal(existsSync(join(root, name)), false, `${name} removed`);
      assert.ok(existsSync(join(root, "draft-dir-delete-a.png")), "unremovable path left the request successful");
      assert.ok(existsSync(outside), "path traversal target remains");
      rmSync(join(root, "draft-dir-delete-a.png"), { recursive: true, force: true });
      await removeMediaFiles(["draft-dir-delete-a.png"]);

      // The deleted owner's bearer token stops working immediately, as does the cookie.
      assert.equal((await businesses(bearerRequest(a.mobileToken))).status, 401);
      assert.equal((await businesses(cookieRequest(a.webToken))).status, 401);
      assert.equal((await client.query("SELECT count(*) FROM auth_sessions WHERE owner_id=$1", [a.owner])).rows[0].count, "0");

      // Bearer deletion works too and sends no cookie.
      const bearerDeleted = await route.DELETE(bearerRequest(d.mobileToken, "DELETE", { confirm: "DELETE" }));
      assert.equal(bearerDeleted.status, 200);
      assert.equal(bearerDeleted.headers.get("set-cookie"), null);
      assert.equal((await businesses(cookieRequest(d.webToken))).status, 401);
      assert.equal((await businesses(bearerRequest(d.mobileToken))).status, 401);

      // The cleanup helper is idempotent and safe to retry after a half failure.
      const retryRoot = mkdtempSync(join(tmpdir(), "account-deletion-retry-"));
      const previous = process.env.MEDIA_ROOT;
      process.env.MEDIA_ROOT = retryRoot;
      try {
        for (const name of ["retry-1.png", "retry-2.png"]) writeFileSync(join(retryRoot, name), Buffer.from([137, 80, 78, 71]));
        let calls = 0;
        await removeMediaFiles(["retry-1.png", "retry-2.png"], async file => {
          calls += 1;
          if (calls === 1) throw new Error("synthetic halfway failure");
          rmSync(file, { force: true });
        });
        assert.ok(existsSync(join(retryRoot, "retry-1.png")), "failed file remains for retry");
        assert.equal(existsSync(join(retryRoot, "retry-2.png")), false, "later file still removed");
        await removeMediaFiles(["retry-1.png", "retry-2.png"]);
        assert.equal(existsSync(join(retryRoot, "retry-1.png")), false, "retry completes");
        await removeMediaFiles(["retry-1.png"]);
      } finally {
        process.env.MEDIA_ROOT = previous;
        rmSync(retryRoot, { recursive: true, force: true });
      }

      // Collector rules: only one owned media name, never a traversal path.
      assert.equal(mediaFilename("/api/media/draft-1.png"), "draft-1.png");
      assert.equal(mediaFilename("/api/media/../outside.png"), null);
      assert.equal(mediaFilename("data:image/png;base64,AAAA"), null);
    });
    console.log("account deletion Postgres, session, isolation and media tests passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
