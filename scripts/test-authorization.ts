import assert from "node:assert/strict";
import { readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { databaseFixture } from "./db-fixture";
import { authAdapter, sessionHash } from "../lib/auth-adapter";
import { ownerId, ownerRoute, chargeGeneration } from "../lib/authorization";
import type { AdapterUser } from "next-auth/adapters";
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir,e.name)) : e.name === "route.ts" ? [join(dir,e.name)] : []); }
async function main() {
  process.env.NEXTAUTH_URL = "http://localhost";
  // Exercise every actual API export anonymously, including future additions (fail closed).
  // The mobile config route is the one intentional public exception (#82).
  const publicRoutes = new Set(["app/api/mobile/config/route.ts"]);
  for (const file of files("app/api").filter(f => !f.includes("/auth/") && !publicRoutes.has(f))) {
    const route = require(join("..",file));
    const path = "/" + file.replace(/\/route.ts$/, "").replace("[id]", "999999").replace("[name]", "draft-999999.png");
    for (const method of ["GET","POST","PATCH","DELETE"].filter(m => route[m])) {
      assert.equal((await route[method](new NextRequest(`http://localhost${path}`, { method }), { params: Promise.resolve({ id: "999999", name: "draft-999999.png" }) })).status, 401, `${path} ${method}`);
    }
  }
  const config = require("../app/api/mobile/config/route").GET;
  const defaultConfig = await config(new NextRequest("http://localhost/api/mobile/config"));
  assert.equal(defaultConfig.status, 200);
  assert.equal(defaultConfig.headers.get("set-cookie"), null);
  assert.match(defaultConfig.headers.get("cache-control") ?? "", /max-age=60/);
  assert.deepEqual(await defaultConfig.json(), { minimumVersion: "1.0.0", latestVersion: "1.0.0", features: [] });
  process.env.MOBILE_MINIMUM_VERSION = "1.2.0";
  process.env.MOBILE_LATEST_VERSION = "1.4.0";
  process.env.MOBILE_FEATURES = "queue, sharing, Not Valid,queue,";
  assert.deepEqual(await (await config(new NextRequest("http://localhost/api/mobile/config"))).json(), { minimumVersion: "1.2.0", latestVersion: "1.4.0", features: ["queue", "sharing"] });
  delete process.env.MOBILE_LATEST_VERSION;
  delete process.env.MOBILE_FEATURES;
  process.env.MOBILE_MINIMUM_VERSION = "not-a-version";
  assert.deepEqual(await (await config(new NextRequest("http://localhost/api/mobile/config"))).json(), { minimumVersion: "1.0.0", latestVersion: "1.0.0", features: [] });
  delete process.env.MOBILE_MINIMUM_VERSION;
  await databaseFixture(async client => {
    const create = authAdapter.createUser as (u: Omit<AdapterUser,"id">) => Promise<AdapterUser>;
    const a = await create({ name: "Synthetic A", email: "a@example.invalid", emailVerified: null });
    const b = await create({ name: "Synthetic B", email: "b@example.invalid", emailVerified: null });
    const expiry = new Date(Date.now() + 3600000);
    await authAdapter.createSession!({ userId: a.id, sessionToken: "synthetic-session-a", expires: expiry });
    assert.equal((await client.query("SELECT token_hash FROM auth_sessions")).rows[0].token_hash, sessionHash("synthetic-session-a"));
    await authAdapter.linkAccount!({ userId: a.id, type: "oauth", provider: "google", providerAccountId: "synthetic-google-sub", access_token: "MUST_NOT_STORE", refresh_token: "MUST_NOT_STORE" });
    assert.doesNotMatch(JSON.stringify((await client.query("SELECT * FROM auth_accounts")).rows), /MUST_NOT_STORE/);
    assert.equal((await authAdapter.getUserByAccount!({ provider: "google", providerAccountId: "synthetic-google-sub" }))?.id, a.id);
    const businesses = await client.query("INSERT INTO businesses(name,timezone,owner_id) VALUES('Synthetic A','UTC',$1),('Synthetic B','UTC',$2),('Unclaimed synthetic','UTC',NULL) RETURNING id", [a.id,b.id]);
    const [ba,bb,legacy] = businesses.rows.map(r => r.id);
    const reviews = await client.query("INSERT INTO reviews(business_id,source,rating,text,reviewed_at) VALUES($1,'manual',5,'A synthetic review','2026-10-01'),($2,'manual',5,'B synthetic review','2026-10-01') RETURNING id", [ba,bb]);
    const draft = (await client.query("INSERT INTO draft_posts(business_id,review_id,quote_text,caption_text,image_path) VALUES($1,$2,'Synthetic','Synthetic','/api/media/draft-777.png') RETURNING id", [bb,reviews.rows[1].id])).rows[0].id;
    await assert.rejects(client.query("INSERT INTO draft_posts(business_id,review_id,quote_text,caption_text) VALUES($1,$2,'Synthetic','Synthetic')", [ba,reviews.rows[1].id]));
    const request = (path: string, method = "GET", body?: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${path}`, { method, headers: { cookie: "next-auth.session-token=synthetic-session-a", origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(await ownerId(request("/api/businesses")), a.id);
    const getBusinesses = require("../app/api/businesses/route").GET;
    const listed = await (await getBusinesses(request("/api/businesses"))).json();
    assert.deepEqual(listed.businesses.map((r: {id:string}) => r.id), [ba]);
    for (const id of [bb,legacy]) for (const family of ["reviews","drafts"]) {
      const handler = require(`../app/api/${family}/route`).GET;
      assert.equal((await handler(request(`/api/${family}?businessId=${id}`))).status, 404);
    }
    for (const path of ["drafts/caption","drafts/status","drafts/schedule","captions/generate","images/render"]) {
      const handler = require(`../app/api/${path}/route`).POST;
      assert.equal((await handler(request(`/api/${path}`,"POST",{draftPostId:draft,captionText:"Synthetic",status:"approved"}))).status,404);
    }
    for (const path of ["quotes/select","reviews/import"]) {
      const handler = require(`../app/api/${path}/route`).POST;
      assert.equal((await handler(request(`/api/${path}`,"POST",{businessId:bb}))).status,404);
    }
    assert.equal((await require("../app/api/businesses/[id]/route").PATCH(request(`/api/businesses/${bb}`,"PATCH",{}), {params:Promise.resolve({id:bb})})).status,404);
    const guarded = ownerRoute(async () => new Response("OK"));
    assert.equal((await guarded(request("/api/branding/preview","POST",{},"https://foreign.invalid"))).status,403);
    assert.equal((await guarded(request("/api/branding/preview","POST",{},""))).status,403);
    assert.equal((await guarded(request("/api/branding/preview","POST",{data:"x".repeat(1500001)}))).status,413);
    assert.equal((await guarded(request("/api/future-unrecognized"))).status,403);
    assert.equal((await guarded(request("/api/drafts/status","POST",{}))).status,400);
    process.env.OWNER_GENERATION_DAILY_LIMIT = "2";
    const charged = await Promise.all([chargeGeneration(a.id),chargeGeneration(a.id),chargeGeneration(a.id)]);
    assert.equal(charged.filter(Boolean).length,2);
    let renders = 0;
    const renderGuard = ownerRoute(async () => { renders++; return new Response("OK"); });
    // Ownership is checked first; an exhausted owner cannot dispatch even a valid render.
    await client.query("UPDATE businesses SET owner_id=$1 WHERE id=$2",[a.id,bb]);
    assert.equal((await renderGuard(request("/api/images/render","POST",{draftPostId:draft}))).status,429);
    assert.equal(renders,0);
    await client.query("DELETE FROM owner_usage WHERE owner_id=$1 AND kind='generation'",[a.id]);
    assert.equal((await renderGuard(request("/api/images/render","POST",{draftPostId:draft}))).status,200);
    assert.equal(renders,1);
    await client.query("UPDATE businesses SET owner_id=$1 WHERE id=$2",[b.id,bb]);
    const root = mkdtempSync(join(tmpdir(),"private-media-")); process.env.MEDIA_ROOT = root;
    try {
      writeFileSync(join(root,"draft-777.png"),Buffer.from([137,80,78,71]));
      const media = require("../app/api/media/[name]/route").GET;
      assert.equal((await media(request("/api/media/draft-777.png"),{params:Promise.resolve({name:"draft-777.png"})})).status,404);
      await client.query("UPDATE businesses SET owner_id=$1 WHERE id=$2",[a.id,bb]);
      const response = await media(request("/api/media/draft-777.png"),{params:Promise.resolve({name:"draft-777.png"})});
      assert.equal(response.status,200); assert.equal(response.headers.get("cache-control"),"private, no-store");
    } finally { rmSync(root,{recursive:true,force:true}); }
    await authAdapter.updateSession!({sessionToken:"synthetic-session-a",expires:new Date(0)});
    assert.equal((await guarded(request("/api/businesses"))).status,401);
    await authAdapter.updateSession!({sessionToken:"synthetic-session-a",expires:expiry});
    await authAdapter.deleteSession!("synthetic-session-a");
    assert.equal((await guarded(request("/api/businesses"))).status,401);
    assert.equal((await client.query("SELECT owner_id FROM businesses WHERE id=$1",[legacy])).rows[0].owner_id,null);
  });
  console.log("anonymous route inventory + owner/session/origin/limit/media Postgres tests passed");
}
main().catch(err=>{console.error(err);process.exitCode=1;});
