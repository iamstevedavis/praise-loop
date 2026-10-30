import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { databaseFixture } from "./db-fixture";
import { linkIdentityToOwner, listMethods, signInWithIdentity, unlinkMethod } from "../lib/authLinking";
import { createMobileSession } from "../lib/mobileSessions";

const IOS = "ios-client.apps.googleusercontent.com";
const ISS = "https://accounts.google.com";
const google = (subject: string, email: string, name: string | null = null) =>
  ({ provider: "google", subject, email, emailVerified: true, name }) as const;

async function main() {
  process.env.GOOGLE_IOS_CLIENT_ID = IOS;
  const good = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(good.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), "https://www.googleapis.com/oauth2/v3/certs", "unexpected network call");
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json", "cache-control": "max-age=300" } });
  }) as typeof fetch;

  const token = (subject: string, email = "api@example.invalid") =>
    new SignJWT({ email, email_verified: true, name: "API Owner" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setSubject(subject).setIssuer(ISS)
      .setAudience(IOS).setIssuedAt().setExpirationTime("1h").sign(good.privateKey);

  try {
    await databaseFixture(async client => {
      // A new provider identity creates one owner and records the method.
      const first = await signInWithIdentity(google("google-sub-1", "owner@example.invalid", "Synthetic Owner"));
      assert.equal(first.ok, true);
      assert.ok(first.ok);
      const methods = await listMethods(first.ownerId);
      assert.equal(methods.length, 1);
      assert.equal(methods[0].provider, "google");
      assert.equal(methods[0].email, "owner@example.invalid");
      assert.ok(methods[0].addedAt && methods[0].lastUsedAt);
      assert.equal((await client.query("SELECT name FROM auth_users WHERE id=$1", [first.ownerId])).rows[0].name, "Synthetic Owner");

      // A returning subject reuses the owner and refreshes last use, not the count.
      await client.query("UPDATE auth_accounts SET last_used_at=now()-interval '1 day'");
      assert.deepEqual(await signInWithIdentity(google("google-sub-1", "owner@example.invalid")), { ok: true, ownerId: first.ownerId });
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_users")).rows[0].n, 1);
      assert.equal((await client.query("SELECT last_used_at > now()-interval '1 minute' AS used FROM auth_accounts")).rows[0].used, true);

      // A verified Google email may link an owner that has no Google row yet.
      await client.query("INSERT INTO auth_users(id,name,email) VALUES('email-owner','Email owner','email-owner@example.invalid')");
      assert.deepEqual(
        await signInWithIdentity(google("google-sub-2", "email-owner@example.invalid")),
        { ok: true, ownerId: "email-owner" }
      );

      // A different Google subject on an already-linked address is rejected.
      const intruder = await signInWithIdentity(google("google-sub-3", "email-owner@example.invalid"));
      assert.deepEqual(intruder, { ok: false, reason: "provider_already_linked" });
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_accounts WHERE provider_account_id='google-sub-3'")).rows[0].n, 0);

      // The subject is the identity: a changed (or reassigned) email does not move it.
      assert.deepEqual(
        await signInWithIdentity(google("google-sub-1", "moved@example.invalid")),
        { ok: true, ownerId: first.ownerId }
      );
      assert.equal((await client.query("SELECT email FROM auth_accounts WHERE provider_account_id='google-sub-1'")).rows[0].email, "moved@example.invalid");

      // A provider without a guaranteed verified email never links by email. It
      // gets a new owner whose login email stays empty.
      const microsoft = await signInWithIdentity({ provider: "microsoft", subject: "microsoft-sub-1", email: "email-owner@example.invalid", emailVerified: false });
      assert.ok(microsoft.ok);
      assert.notEqual(microsoft.ownerId, "email-owner");
      assert.equal((await client.query("SELECT email FROM auth_users WHERE id=$1", [microsoft.ownerId])).rows[0].email, null);
      assert.equal((await client.query("SELECT email FROM auth_accounts WHERE provider='microsoft'")).rows[0].email, "email-owner@example.invalid");

      // Signed-in linking attaches another method without an email match.
      await client.query("INSERT INTO auth_users(id,name,email) VALUES('link-owner','Link owner','link@example.invalid')");
      await client.query("INSERT INTO auth_accounts(provider,provider_account_id,owner_id,email,created_at) VALUES('google','link-sub','link-owner','link@example.invalid',now())");
      const linked = await linkIdentityToOwner("link-owner", { provider: "email", subject: "code:link@example.invalid", email: "other@example.invalid", emailVerified: true });
      assert.ok(linked.ok);
      assert.deepEqual(linked.methods.map(method => method.provider).sort(), ["email", "google"]);

      // One subject per provider per owner: another Google subject is refused.
      assert.deepEqual(
        await linkIdentityToOwner("link-owner", google("link-other-sub", "link@example.invalid")),
        { ok: false, reason: "provider_already_linked" }
      );
      // A method already attached to another owner cannot be stolen by linking it.
      assert.deepEqual(
        await linkIdentityToOwner("link-owner", google("google-sub-1", "moved@example.invalid")),
        { ok: false, reason: "account_taken" }
      );
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_accounts WHERE owner_id='link-owner'")).rows[0].n, 2);

      // Unlink removes one method but refuses to remove the last one.
      const remaining = await unlinkMethod("link-owner", "email");
      assert.ok(remaining.ok);
      assert.deepEqual(remaining.methods.map(method => method.provider), ["google"]);
      assert.deepEqual(await unlinkMethod("link-owner", "google"), { ok: false, reason: "last_method" });
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_accounts WHERE owner_id='link-owner'")).rows[0].n, 1);
      assert.deepEqual(await unlinkMethod("link-owner", "apple"), { ok: false, reason: "not_found" });

      // The API works with a mobile bearer session and enforces the same rules.
      const session = await createMobileSession("link-owner");
      const methodsRoute = require("../app/api/account/methods/route");
      const request = (method: string, body?: unknown) => new NextRequest("http://localhost/api/account/methods", {
        method,
        headers: { authorization: `Bearer ${session.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const listed = await methodsRoute.GET(request("GET"));
      assert.equal(listed.status, 200);
      assert.deepEqual((await listed.json()).methods.map((method: { provider: string }) => method.provider), ["google"]);
      assert.equal((await methodsRoute.DELETE(request("DELETE", { provider: "google" }))).status, 409);
      assert.equal((await methodsRoute.DELETE(request("DELETE", { provider: "apple" }))).status, 404);
      assert.equal((await methodsRoute.DELETE(request("DELETE", {}))).status, 400);

      await linkIdentityToOwner("link-owner", { provider: "email", subject: "api-email", email: "api-email@example.invalid", emailVerified: true });
      const afterUnlink = await methodsRoute.DELETE(request("DELETE", { provider: "email" }));
      assert.equal(afterUnlink.status, 200);
      assert.deepEqual((await afterUnlink.json()).methods.map((method: { provider: string }) => method.provider), ["google"]);

      // Linking a verified Google token from the signed-in session.
      await client.query("INSERT INTO auth_users(id,name,email) VALUES('api-owner','API owner','api-owner@example.invalid')");
      const apiSession = await createMobileSession("api-owner");
      const apiRequest = (idToken: unknown) => new NextRequest("http://localhost/api/account/methods", {
        method: "POST",
        headers: { authorization: `Bearer ${apiSession.token}`, "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", idToken })
      });
      const linkedByApi = await methodsRoute.POST(apiRequest(await token("api-sub", "api-owner@example.invalid")));
      assert.equal(linkedByApi.status, 200);
      assert.deepEqual((await linkedByApi.json()).methods.map((method: { provider: string }) => method.provider), ["google"]);
      assert.equal((await methodsRoute.POST(apiRequest(await token("api-sub", "api-owner@example.invalid")))).status, 200, "linking is idempotent");
      assert.equal((await methodsRoute.POST(apiRequest(await token("api-other-sub", "api-owner@example.invalid")))).status, 409);
      assert.equal((await methodsRoute.POST(apiRequest("not-a-token"))).status, 400);
      assert.equal((await methodsRoute.POST(apiRequest(await token("api-sub", "api-owner@example.invalid")))).status, 200);

      // Two subjects race for one unlinked address: exactly one links.
      await client.query("INSERT INTO auth_users(id,name,email) VALUES('race-owner','Race owner','race@example.invalid')");
      const raced = await Promise.all([
        signInWithIdentity(google("race-sub-a", "race@example.invalid")),
        signInWithIdentity(google("race-sub-b", "race@example.invalid"))
      ]);
      assert.equal(raced.filter(result => result.ok).length, 1);
      assert.equal(raced.filter(result => !result.ok && result.reason === "provider_already_linked").length, 1);
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_accounts WHERE owner_id='race-owner'")).rows[0].n, 1);

      // Two signed-in link requests race for one provider on one owner: one wins.
      await client.query("INSERT INTO auth_users(id,name,email) VALUES('race-link-owner','Race link owner','race-link@example.invalid')");
      const racedLinks = await Promise.all([
        linkIdentityToOwner("race-link-owner", google("race-link-a", "race-link@example.invalid")),
        linkIdentityToOwner("race-link-owner", google("race-link-b", "race-link@example.invalid"))
      ]);
      assert.equal(racedLinks.filter(result => result.ok).length, 1);
      assert.equal(racedLinks.filter(result => !result.ok && result.reason === "provider_already_linked").length, 1);
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_accounts WHERE owner_id='race-link-owner'")).rows[0].n, 1);

      // The same subject linked twice concurrently stays one method.
      await client.query("INSERT INTO auth_users(id,name,email) VALUES('idem-owner','Idem owner','idem@example.invalid')");
      const same = await Promise.all([
        linkIdentityToOwner("idem-owner", google("idem-sub", "idem@example.invalid")),
        linkIdentityToOwner("idem-owner", google("idem-sub", "idem@example.invalid"))
      ]);
      assert.equal(same.every(result => result.ok), true);
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_accounts WHERE owner_id='idem-owner'")).rows[0].n, 1);

      // The NextAuth callback applies the same policy before a session exists.
      const signIn = require("../lib/auth").authOptions.callbacks.signIn;
      assert.equal(await signIn({
        account: { provider: "google", providerAccountId: "callback-sub" },
        profile: { email: "callback@example.invalid", email_verified: true, name: "Callback Owner" }
      }), true);
      assert.equal(
        (await client.query("SELECT owner_id FROM auth_accounts WHERE provider_account_id='callback-sub'")).rows[0].owner_id,
        (await client.query("SELECT id FROM auth_users WHERE email='callback@example.invalid'")).rows[0].id
      );
      assert.equal(await signIn({
        account: { provider: "google", providerAccountId: "callback-unverified" },
        profile: { email: "callback-unverified@example.invalid", email_verified: false }
      }), false, "unverified Google email is not a sign-in");
      assert.equal(await signIn({
        account: { provider: "github", providerAccountId: "callback-github" },
        profile: { email: "callback@example.invalid" }
      }), false, "an unknown provider fails closed");
      assert.equal((await client.query("SELECT count(*)::int n FROM auth_accounts WHERE provider_account_id='callback-unverified'")).rows[0].n, 0);

      // No provider token or subject is stored in a method row.
      assert.doesNotMatch(JSON.stringify((await client.query("SELECT * FROM auth_accounts")).rows), /eyJ/);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log("sign-in linking policy, link/unlink and race tests passed");
}
main().catch(error => { console.error(error); process.exit(1); });
