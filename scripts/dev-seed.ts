import { basename, join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { pool, query } from "../lib/db";
import { DEV_OWNER_ID, devAuthEnabled, ensureDevOwner } from "../lib/devAuth";
import { generationWeek } from "../lib/services/generation";
import { renderDraftImage } from "../lib/services/imageRenderer";
import { mediaRoot } from "../lib/services/media";
import { setOwnerPlan } from "../lib/services/entitlements";
import type { BrandTone } from "../lib/branding";

// Synthetic data for walking the phone flow end to end without OpenAI, Google
// OAuth or a review provider. Refuses to run against a production process, and
// replaces only the demo owner's businesses, so no real owner's data is touched.
type DraftSeed = {
  quote: string;
  caption: string;
  rating: number;
  author: string;
  status: "draft" | "approved" | "shared";
};

const BUSINESS = {
  name: "Demo — Copper Kettle Café",
  timezone: "America/Toronto",
  tone: "friendly" as BrandTone,
  colors: { primary: "#8c3b2e", secondary: "#f3e6d6", template: "quote-card-v1", quoteSize: "standard" },
  weeklyTarget: 4
};

const SECOND_BUSINESS = {
  name: "Demo — Harbour Bike Repair",
  timezone: "America/Toronto",
  tone: "premium" as BrandTone,
  colors: { primary: "#12283a", secondary: "#dfe7ec", template: "quote-card-v1", quoteSize: "standard" },
  weeklyTarget: 3
};

const DRAFTS: DraftSeed[] = [
  {
    quote: "The flat white is the best in the neighbourhood and the staff remember your name.",
    caption: "Best flat white in the neighbourhood ☕ Thanks for saying so, we'll keep the machine warm.",
    rating: 5,
    author: "Priya S.",
    status: "draft"
  },
  {
    quote: "Quiet corner, fast wifi, and the cinnamon buns sell out for a reason.",
    caption: "A quiet corner and a warm bun — our favourite kind of morning. Cinnamon buns back tomorrow at 8.",
    rating: 5,
    author: "Marcus T.",
    status: "draft"
  },
  {
    quote: "Staff sorted out my order mix-up in about a minute, no fuss at all.",
    caption: "Mistakes happen; fixing them fast is the whole job. Thanks for the patience, Devon.",
    rating: 4,
    author: "Devon R.",
    status: "draft"
  },
  {
    quote: "Brought my parents here on Sunday and they haven't stopped talking about the scones.",
    caption: "Scones that impress the parents — high praise. See you next Sunday.",
    rating: 5,
    author: "Ade O.",
    status: "approved"
  },
  {
    quote: "Warm room, warm welcome, and a proper pot of tea.",
    caption: "A proper pot of tea and a warm welcome, every time. Thanks for stopping in, Ruth.",
    rating: 5,
    author: "Ruth K.",
    status: "shared"
  }
];

async function createBusiness(name: string, timezone: string, tone: BrandTone, colors: Record<string, string>, weeklyTarget: number, owner: string) {
  return (await query<{ id: number }>(
    `INSERT INTO businesses(name,timezone,brand_colors,brand_tone,weekly_target,owner_id)
     VALUES($1,$2,$3::jsonb,$4,$5,$6) RETURNING id`,
    [name, timezone, JSON.stringify(colors), tone, weeklyTarget, owner]
  )).rows[0].id;
}

// The weekly worker scans every owned business. Reserving this week's full target
// keeps the demo quiet: no OpenAI key is needed, and no extra drafts appear while
// the flow is being walked.
async function reserveWeek(businessId: number, timezone: string, target: number) {
  const week = generationWeek(new Date(), timezone);
  await query(
    `INSERT INTO generation_periods(business_id,period_start,timezone,target,allocated,completed,reason)
     VALUES($1,$2,$3,$4,$4,$4,'quota_met')
     ON CONFLICT(business_id,period_start) DO UPDATE SET target=$4,allocated=$4,completed=$4,reason='quota_met'`,
    [businessId, week, timezone, target]
  );
}

async function removeDemoMedia(owner: string) {
  const rows = await query<{ image_path: string | null }>(
    `SELECT d.image_path FROM draft_posts d JOIN businesses b ON b.id=d.business_id WHERE b.owner_id=$1`,
    [owner]
  );
  for (const row of rows.rows) {
    if (!row.image_path) continue;
    const file = join(mediaRoot(), basename(row.image_path));
    if (existsSync(file)) unlinkSync(file);
  }
}

async function main() {
  if (!devAuthEnabled()) {
    throw new Error("Refusing to seed: set MOBILE_DEV_AUTH=1 and run in a development process (not a production build)");
  }

  const owner = await ensureDevOwner();
  await setOwnerPlan(owner, "pro", { actor: "dev-seed", reason: "demo data" });
  await removeDemoMedia(owner);
  await query("DELETE FROM businesses WHERE owner_id=$1", [owner]);

  const businessId = await createBusiness(BUSINESS.name, BUSINESS.timezone, BUSINESS.tone, BUSINESS.colors, BUSINESS.weeklyTarget, owner);
  await reserveWeek(businessId, BUSINESS.timezone, BUSINESS.weeklyTarget);

  const draftIds: number[] = [];
  for (const seed of DRAFTS) {
    const reviewId = (await query<{ id: number }>(
      `INSERT INTO reviews(business_id,source,rating,text,reviewed_at,author_name)
       VALUES($1,'manual',$2,$3,now() - ($4 || ' days')::interval,$5) RETURNING id`,
      [businessId, seed.rating, seed.quote, String(DRAFTS.indexOf(seed) + 1), seed.author]
    )).rows[0].id;

    const draftId = (await query<{ id: number }>(
      `INSERT INTO draft_posts(business_id,review_id,quote_text,caption_text,status)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [businessId, reviewId, seed.quote, seed.caption, seed.status]
    )).rows[0].id;
    draftIds.push(draftId);

    const image = await renderDraftImage({
      draftPostId: draftId,
      businessName: BUSINESS.name,
      quoteText: seed.quote,
      rating: seed.rating,
      authorName: seed.author,
      brandHex: BUSINESS.colors.primary,
      secondaryBrandHex: BUSINESS.colors.secondary,
      brandTone: BUSINESS.tone,
      templateConfig: BUSINESS.colors,
      watermark: false
    });
    await query("UPDATE draft_posts SET image_path=$2, updated_at=now() WHERE id=$1", [draftId, image.publicPath]);

    if (seed.status === "shared") {
      await query("UPDATE draft_posts SET shared_at=now() - interval '1 day' WHERE id=$1", [draftId]);
      await query(
        `INSERT INTO draft_events(draft_id,actor_id,action,reason,from_status,to_status,at) VALUES
          ($1,$2,'status','status:approved','draft','approved',now() - interval '2 days'),
          ($1,$2,'status','owner_shared','approved','shared',now() - interval '1 day')`,
        [draftId, owner]
      );
    } else if (seed.status === "approved") {
      await query(
        `INSERT INTO draft_events(draft_id,actor_id,action,reason,from_status,to_status,at)
         VALUES($1,$2,'status','status:approved','draft','approved',now() - interval '1 day')`,
        [draftId, owner]
      );
    }
    // The image_path update above is bookkeeping, not owner history.
    await query("DELETE FROM draft_events WHERE draft_id=$1 AND action='updated'", [draftId]);
  }

  const secondId = await createBusiness(SECOND_BUSINESS.name, SECOND_BUSINESS.timezone, SECOND_BUSINESS.tone, SECOND_BUSINESS.colors, SECOND_BUSINESS.weeklyTarget, owner);
  await reserveWeek(secondId, SECOND_BUSINESS.timezone, SECOND_BUSINESS.weeklyTarget);

  const counts = DRAFTS.reduce<Record<string, number>>((all, draft) => ({ ...all, [draft.status]: (all[draft.status] ?? 0) + 1 }), {});
  console.log(JSON.stringify({
    event: "demo_seed_complete",
    owner: DEV_OWNER_ID,
    businesses: [businessId, secondId],
    drafts: { total: draftIds.length, ...counts }
  }));
  console.log("Sign in on the phone with the demo button (MOBILE_DEV_AUTH=1, development process).");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Demo seed failed");
  process.exitCode = 1;
}).finally(() => pool.end());
