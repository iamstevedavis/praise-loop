import assert from "node:assert/strict";
import { databaseFixture } from "./db-fixture";
import { DEV_OWNER_EMAIL, DEV_OWNER_ID, devAuthEnabled, ensureDevOwner } from "../lib/devAuth";
import { resolveMobileSession } from "../lib/mobileSessions";

// The demo sign-in is the only unauthenticated way to mint an owner session. Its
// gate has to fail closed, so it is tested separately from the route inventory.
async function main() {
  assert.equal(devAuthEnabled({}), false, "off by default");
  assert.equal(devAuthEnabled({ MOBILE_DEV_AUTH: "true", NODE_ENV: "development" }), false, "only the literal 1 enables it");
  assert.equal(devAuthEnabled({ MOBILE_DEV_AUTH: "1", NODE_ENV: "production" }), false, "production builds always answer 404");
  assert.equal(devAuthEnabled({ MOBILE_DEV_AUTH: "1", NODE_ENV: "development" }), true);

  // Disabled: the route must look like an unknown one before it touches the database.
  delete process.env.MOBILE_DEV_AUTH;
  const { POST } = require("../app/api/mobile/session/dev/route");
  assert.equal((await POST()).status, 404);

  if (!process.env.TEST_DATABASE_URL) {
    console.log("Dev auth database tests skipped: set TEST_DATABASE_URL");
    return;
  }

  await databaseFixture(async client => {
    await ensureDevOwner();
    await ensureDevOwner();
    const owners = await client.query("SELECT id,email FROM auth_users WHERE id=$1", [DEV_OWNER_ID]);
    assert.equal(owners.rowCount, 1, "the demo owner is created once");
    assert.equal(owners.rows[0].email, DEV_OWNER_EMAIL);

    process.env.MOBILE_DEV_AUTH = "1";
    try {
      const response = await POST();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json() as { token?: string; owner?: string };
      assert.ok(body.token, "a bearer token is returned");
      assert.equal(body.owner, DEV_OWNER_ID);
      const resolved = await resolveMobileSession(body.token!);
      assert.equal(resolved?.ownerId, DEV_OWNER_ID, "the token resolves to the demo owner");

      // The demo owner is scoped like any other: another owner never sees its data.
      const business = (await client.query("INSERT INTO businesses(name,timezone,owner_id) VALUES('Demo café','UTC',$1) RETURNING id", [DEV_OWNER_ID])).rows[0].id;
      await client.query("INSERT INTO auth_users(id,email) VALUES('other-owner','other@example.invalid') ON CONFLICT DO NOTHING");
      assert.equal((await client.query("SELECT 1 FROM businesses WHERE id=$1 AND owner_id=$2", [business, "other-owner"])).rowCount, 0);
    } finally {
      delete process.env.MOBILE_DEV_AUTH;
    }
  });

  console.log("dev auth gate and demo session tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
