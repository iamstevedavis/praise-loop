import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { databaseFixture } from "./db-fixture";
import { sessionHash } from "../lib/auth-adapter";
import { PLAN_LIMITS, entitlementsFor, entitlementsForPlan, setOwnerPlan } from "../lib/services/entitlements";
import { processGeneration, requestGeneration, type GenerationDeps } from "../lib/services/generation";
import { renderDraftImage } from "../lib/services/imageRenderer";

async function main() {
  process.env.NEXTAUTH_URL = "http://localhost";
  const root = mkdtempSync(join(tmpdir(), "entitlements-"));
  process.env.MEDIA_ROOT = root;

  try {
    // Pure plan resolution: default free, configured pro, and expired pro.
    assert.deepEqual(entitlementsForPlan("free", "default", null), { plan: "free", source: "default", expiresAt: null, limits: PLAN_LIMITS.free });
    assert.equal(entitlementsForPlan("pro", "manual", null).limits.postsPerWeek, 5);
    const expiredPlan = entitlementsForPlan("pro", "manual", "2020-01-01T00:00:00Z", new Date("2026-01-01T00:00:00Z"));
    assert.equal(expiredPlan.plan, "free");
    assert.equal(expiredPlan.limits.watermark, true);

    await databaseFixture(async (c) => {
      await c.query(`INSERT INTO auth_users(id,email) VALUES
        ('free-owner','free@example.invalid'),('pro-owner','pro@example.invalid'),
        ('expired-owner','expired@example.invalid'),('api-owner','api@example.invalid')`);
      await c.query(`INSERT INTO auth_sessions VALUES
        ($1,'api-owner',now()+interval '1 hour')`, [sessionHash("entitlements-api-session")]);

      // No row means the default free plan; nothing needs to be seeded.
      assert.equal((await entitlementsFor("free-owner")).plan, "free");
      assert.equal((await entitlementsFor("free-owner")).source, "default");

      const pro = await setOwnerPlan("pro-owner", "pro", { actor: "operators@example.invalid", reason: "Synthetic pilot upgrade" });
      assert.equal(pro.plan, "pro");
      assert.equal(pro.limits.postsPerWeek, 5);
      assert.equal(pro.limits.watermark, false);
      const audit = (await c.query("SELECT plan,source,actor,reason FROM owner_plan_events WHERE owner_id='pro-owner'")).rows;
      assert.deepEqual(audit, [{ plan: "pro", source: "manual", actor: "operators@example.invalid", reason: "Synthetic pilot upgrade" }]);

      await setOwnerPlan("expired-owner", "pro", { expiresAt: "2020-01-01T00:00:00Z", reason: "Expired synthetic subscription" });
      const expired = await entitlementsFor("expired-owner");
      assert.equal(expired.plan, "free");
      assert.equal(expired.limits.postsPerWeek, 1);
      assert.equal((await c.query("SELECT plan FROM owner_plans WHERE owner_id='expired-owner'")).rows[0].plan, "pro", "expiry keeps the stored plan for renewal");

      const business = async (owner: string, name: string) =>
        (await c.query("INSERT INTO businesses(name,timezone,owner_id) VALUES($1,'UTC',$2) RETURNING id", [name, owner])).rows[0].id;
      const reviews = async (businessId: number) => c.query(
        "INSERT INTO reviews(business_id,source,source_review_id,rating,text,reviewed_at) SELECT $1,'manual',n::text,5,'A wonderful synthetic experience with friendly staff '||n,now() FROM generate_series(1,20) n",
        [businessId]
      );

      const now = new Date();
      const freeBusiness = await business("free-owner", "Free synthetic");
      await reviews(freeBusiness);
      const freeRequest = await requestGeneration(freeBusiness, 5, now);
      assert.equal(freeRequest.inserted, 1, "free plans reserve one weekly draft");
      assert.equal(freeRequest.target, 1);
      assert.equal((await requestGeneration(freeBusiness, 5, now)).reason, "quota_met");

      const proBusiness = await business("pro-owner", "Pro synthetic");
      await c.query("UPDATE businesses SET weekly_target=5 WHERE id=$1", [proBusiness]);
      await reviews(proBusiness);
      const proRequest = await requestGeneration(proBusiness, 5, now);
      assert.equal(proRequest.inserted, 5, "pro plans reserve the configured weekly target");
      assert.equal(proRequest.target, 5);

      // Upgrading mid-week raises the existing period's cap without losing its allocation.
      await setOwnerPlan("free-owner", "pro", { reason: "Synthetic mid-week upgrade" });
      await c.query("UPDATE businesses SET weekly_target=3 WHERE id=$1", [freeBusiness]);
      const upgraded = await requestGeneration(freeBusiness, 5, now);
      assert.equal(upgraded.target, 3);
      assert.equal(upgraded.inserted, 2, "the upgrade unlocks the remaining weekly drafts");
      await setOwnerPlan("free-owner", "free", { reason: "Synthetic downgrade" });

      let renderedWatermark: boolean | undefined;
      const generationDeps: GenerationDeps = {
        clock: () => now,
        captions: async () => ({ friendly: "Synthetic", premium: "Synthetic premium", playful: "Synthetic playful" }),
        render: async (params) => {
          renderedWatermark = params.watermark;
          return { publicPath: "/api/media/synthetic.png", fileSystemPath: "/tmp/synthetic.png" };
        }
      };
      const freeJob = (await c.query("SELECT id FROM generation_jobs WHERE business_id=$1 ORDER BY id LIMIT 1", [freeBusiness])).rows[0].id;
      assert.equal(await processGeneration(Number(freeJob), generationDeps), true);
      assert.equal(renderedWatermark, true, "the worker applies the free-plan watermark");
      renderedWatermark = undefined;
      const proJob = (await c.query("SELECT id FROM generation_jobs WHERE business_id=$1 ORDER BY id LIMIT 1", [proBusiness])).rows[0].id;
      assert.equal(await processGeneration(Number(proJob), generationDeps), true);
      assert.equal(renderedWatermark, false, "pro renders have no watermark");

      const apiBusiness = await business("api-owner", "API synthetic");
      const onboardingKey = "11111111-2222-3333-4444-555555555555";
      await c.query("UPDATE businesses SET onboarding_key=$2 WHERE id=$1", [apiBusiness, onboardingKey]);
      const request = (path: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${path}`, {
        method,
        headers: { cookie: "next-auth.session-token=entitlements-api-session", origin: "http://localhost", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });

      const entitlementsRoute = require("../app/api/entitlements/route");
      assert.equal(typeof entitlementsRoute.GET, "function");
      assert.equal(entitlementsRoute.POST, undefined);
      assert.equal(entitlementsRoute.PATCH, undefined);
      assert.equal(entitlementsRoute.PUT, undefined);
      const response = await entitlementsRoute.GET(request("/api/entitlements?plan=pro"));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.plan, "free", "the app can read but not change its own plan");
      assert.equal(body.limits.postsPerWeek, 1);
      assert.equal(response.headers.get("cache-control"), "private, no-store");

      const businessesRoute = require("../app/api/businesses/route");
      const retried = await businessesRoute.POST(request("/api/businesses", "POST", { name: "Retried synthetic", timezone: "UTC", onboardingKey }));
      assert.equal(retried.status, 201);
      assert.equal((await retried.json()).business.id, apiBusiness, "a repeated onboarding key returns the original business");
      const limited = await businessesRoute.POST(request("/api/businesses", "POST", { name: "Second synthetic", timezone: "UTC" }));
      assert.equal(limited.status, 403);
      assert.equal((await limited.json()).code, "business_limit_reached");
      assert.equal((await c.query("SELECT count(*) n FROM businesses WHERE owner_id='api-owner'")).rows[0].n, "1");
    });

    // The watermark is part of the deterministic render input and sits below
    // the card content, so it is visible without covering names or the logo.
    const base = { draftPostId: 950, businessName: "Synthetic Café", quoteText: "A warm and welcoming synthetic visit", brandHex: "#1f2937", rating: 5, authorName: "Synthetic reviewer" };
    const marked = await renderDraftImage({ ...base, watermark: true });
    const clean = await renderDraftImage({ ...base, watermark: false });
    const markedBytes = readFileSync(marked.fileSystemPath), cleanBytes = readFileSync(clean.fileSystemPath);
    assert.notDeepEqual(markedBytes, cleanBytes);
    const brightest = async (bytes: Buffer) => {
      const { data } = await sharp(bytes).extract({ left: 420, top: 1008, width: 240, height: 40 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return data.reduce((max, value) => Math.max(max, value), 0);
    };
    assert.ok(await brightest(markedBytes) > 200, "the watermark is visible in the bottom margin");
    assert.ok(await brightest(cleanBytes) < 100, "no mark for a pro/free-omitted render");
    const repeated = await renderDraftImage({ ...base, watermark: true });
    assert.deepEqual(readFileSync(repeated.fileSystemPath), markedBytes, "the watermark render is deterministic");

    console.log("plan limits, weekly cap, watermark, business limit, read-only API and audit tests passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
