import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { AdapterUser } from "next-auth/adapters";
import { databaseFixture } from "./db-fixture";
import { authAdapter } from "../lib/auth-adapter";
import { createMobileSession } from "../lib/mobileSessions";
import { findOrCreateGoogleOwner } from "../lib/mobileSignIn";
import { initialsFor, normalizeOwnerName } from "../lib/services/profile";

const EMAIL = "ada@example.invalid";

function webRequest(path: string, method = "GET", body?: unknown, token = "profile-session", origin = "http://localhost") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: `next-auth.session-token=${token}`, origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function bearerRequest(path: string, token: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function main() {
  process.env.NEXTAUTH_URL = "http://localhost";

  // Pure helpers, so the rules are testable without Postgres too.
  assert.deepEqual(normalizeOwnerName("  Ada Lovelace  "), { name: "Ada Lovelace" });
  assert.deepEqual(normalizeOwnerName("A".repeat(80)), { name: "A".repeat(80) });
  for (const bad of ["", "   ", "A".repeat(81), "Ada\u0000Lovelace", "Ada\nLovelace", null, 42]) {
    assert.ok("error" in normalizeOwnerName(bad), JSON.stringify(bad));
  }
  assert.equal(initialsFor("Demo Owner", "demo@example.invalid"), "DO");
  assert.equal(initialsFor("Cher", "cher@example.invalid"), "C");
  assert.equal(initialsFor(null, "demo-free@example.invalid"), "DF");
  assert.equal(initialsFor(null, null), "?");

  await databaseFixture(async client => {
    const create = authAdapter.createUser as (u: Omit<AdapterUser, "id">) => Promise<AdapterUser>;
    const named = await create({ name: "Provider Name", email: EMAIL, emailVerified: null });
    const nameless = await create({ name: null, email: "nameless@example.invalid", emailVerified: null });
    const other = await create({ name: "Other Owner", email: "other@example.invalid", emailVerified: null });
    const phoneNameless = await create({ name: null, email: "phone@example.invalid", emailVerified: null });
    const expiry = new Date(Date.now() + 3600000);
    for (const [user, token] of [[named, "profile-session"], [nameless, "nameless-session"], [other, "other-session"]] as const) {
      await authAdapter.createSession!({ userId: user.id, sessionToken: token, expires: expiry });
    }
    for (const [user, sub] of [[named, "google-named"], [nameless, "google-nameless"], [phoneNameless, "google-phone-nameless"]] as const) {
      await authAdapter.linkAccount!({ userId: user.id, type: "oauth", provider: "google", providerAccountId: sub, access_token: "MUST_NOT_STORE", refresh_token: "MUST_NOT_STORE" });
    }

    const route = require("../app/api/profile/route");
    assert.equal(typeof route.GET, "function");
    assert.equal(typeof route.PATCH, "function");
    assert.equal(route.POST, undefined);
    assert.equal(route.DELETE, undefined);

    // A provider-supplied name, with no provider tokens in the response.
    const response = await route.GET(webRequest("/api/profile"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const providerProfile = await response.json();
    assert.deepEqual(providerProfile, {
      name: "Provider Name", email: EMAIL, nameSource: "provider", provider: "google", initials: "PN"
    });
    assert.doesNotMatch(JSON.stringify(providerProfile), /MUST_NOT_STORE|google-named/);

    // A missing name is null, with initials derived from the email.
    const missing = await (await route.GET(webRequest("/api/profile", "GET", undefined, "nameless-session"))).json();
    assert.deepEqual(missing, {
      name: null, email: "nameless@example.invalid", nameSource: null, provider: "google", initials: "N"
    });

    // The session decides whose row is read: another owner's name is never reachable.
    const otherProfile = await (await route.GET(webRequest("/api/profile", "GET", undefined, "other-session"))).json();
    assert.equal(otherProfile.name, "Other Owner");
    assert.equal(otherProfile.email, "other@example.invalid");
    assert.equal((await route.GET(webRequest("/api/profile", "GET", undefined, "other-session", "https://foreign.invalid"))).status, 200, "reads need no origin");

    // The owner sets their name; it is trimmed and recorded as owner-set.
    const patched = await route.PATCH(webRequest("/api/profile", "PATCH", { name: "  Ada Lovelace  " }));
    assert.equal(patched.status, 200);
    assert.deepEqual(await patched.json(), {
      name: "Ada Lovelace", email: EMAIL, nameSource: "owner", provider: "google", initials: "AL"
    });
    assert.deepEqual((await client.query("SELECT name,name_source FROM auth_users WHERE id=$1", [named.id])).rows[0], {
      name: "Ada Lovelace", name_source: "owner"
    });

    // Invalid names are 400 and leave the stored name alone.
    for (const name of ["", "   ", "A".repeat(81), "Ada\u0000Lovelace", "Ada\nLovelace", null, 42]) {
      const bad = await route.PATCH(webRequest("/api/profile", "PATCH", { name }));
      assert.equal(bad.status, 400, JSON.stringify(name));
      assert.ok((await bad.json()).error);
      assert.equal((await client.query("SELECT name FROM auth_users WHERE id=$1", [named.id])).rows[0].name, "Ada Lovelace");
    }
    assert.equal((await route.PATCH(webRequest("/api/profile", "PATCH", undefined))).status, 400, "a name is required");

    // The email is read-only, whether it is sent alone or beside a valid name.
    const emailOnly = await route.PATCH(webRequest("/api/profile", "PATCH", { email: "changed@example.invalid" }));
    assert.equal(emailOnly.status, 400);
    const withEmail = await route.PATCH(webRequest("/api/profile", "PATCH", { name: "Ada L", email: "changed@example.invalid" }));
    assert.equal(withEmail.status, 200);
    assert.equal((await withEmail.json()).email, EMAIL);
    assert.equal((await client.query("SELECT email FROM auth_users WHERE id=$1", [named.id])).rows[0].email, EMAIL);
    await route.PATCH(webRequest("/api/profile", "PATCH", { name: "Ada Lovelace" }));

    // A cookie write still needs the same origin.
    assert.equal((await route.PATCH(webRequest("/api/profile", "PATCH", { name: "Cross Site" }, "profile-session", "https://foreign.invalid"))).status, 403);

    // The next Google sign-in on the web keeps the owner's name.
    await authAdapter.updateUser!({ id: named.id, name: "Provider Override", email: EMAIL, emailVerified: null });
    assert.equal((await client.query("SELECT name FROM auth_users WHERE id=$1", [named.id])).rows[0].name, "Ada Lovelace");
    assert.equal((await client.query("SELECT name_source FROM auth_users WHERE id=$1", [named.id])).rows[0].name_source, "owner");

    // A missing name may still be filled from the provider, on web and phone.
    await authAdapter.updateUser!({ id: nameless.id, name: "Web Filled", email: "nameless@example.invalid", emailVerified: null });
    assert.deepEqual((await client.query("SELECT name,name_source FROM auth_users WHERE id=$1", [nameless.id])).rows[0], {
      name: "Web Filled", name_source: "provider"
    });
    assert.equal(await findOrCreateGoogleOwner({ sub: "google-phone-nameless", email: "phone@example.invalid", name: "Phone Filled" }), phoneNameless.id);
    assert.equal((await client.query("SELECT name FROM auth_users WHERE id=$1", [phoneNameless.id])).rows[0].name, "Phone Filled");
    assert.equal(await findOrCreateGoogleOwner({ sub: "google-named", email: EMAIL, name: "Phone Override" }), named.id);
    assert.equal((await client.query("SELECT name FROM auth_users WHERE id=$1", [named.id])).rows[0].name, "Ada Lovelace");

    // The same guard and shape work for mobile bearer sessions.
    const mobile = await createMobileSession(other.id);
    const mobileGet = await route.GET(bearerRequest("/api/profile", mobile.token));
    assert.equal(mobileGet.status, 200);
    assert.equal(mobileGet.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await mobileGet.json(), {
      name: "Other Owner", email: "other@example.invalid", nameSource: "provider", provider: "google", initials: "OO"
    });
    const mobilePatch = await route.PATCH(bearerRequest("/api/profile", mobile.token, "PATCH", { name: "Other Name" }));
    assert.equal(mobilePatch.status, 200);
    assert.deepEqual(await mobilePatch.json(), {
      name: "Other Name", email: "other@example.invalid", nameSource: "owner", provider: "google", initials: "ON"
    });
    assert.equal((await client.query("SELECT name,name_source FROM auth_users WHERE id=$1", [other.id])).rows[0].name_source, "owner");
  });

  console.log("owner profile read/edit, validation, email read-only and provider precedence tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
