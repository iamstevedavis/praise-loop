import { NextResponse } from "next/server";
import { ownerRoute,currentOwner } from "../../../lib/authorization";
import { query } from "../../../lib/db";
import { entitlementsFor } from "../../../lib/services/entitlements";
export const GET=ownerRoute(async req=>{
  const id=req.nextUrl.searchParams.get("businessId");
  if(id!==null && (!Number.isSafeInteger(Number(id))||Number(id)<=0))return NextResponse.json({error:"Valid business ID required"},{status:400});
  const business=(await query("SELECT id,name,timezone,brand_colors,brand_tone,weekly_target FROM businesses WHERE owner_id=$1 AND ($2::bigint IS NULL OR id=$2) ORDER BY (onboarding_key IS NOT NULL) DESC,id DESC LIMIT 1",[currentOwner(),id])).rows[0]??null;
  if(!business)return NextResponse.json({business:null,reviews:0,drafts:[]},{status:id?404:200});
  const reviews=Number((await query("SELECT count(*) n FROM reviews WHERE business_id=$1 AND duplicate_of IS NULL",[business.id])).rows[0].n);
  const drafts=(await query("SELECT d.id,d.version,d.quote_text,d.caption_text,d.image_path,d.status,j.state AS job_state,j.error_code FROM draft_posts d LEFT JOIN generation_jobs j ON j.draft_id=d.id WHERE d.business_id=$1 AND d.duplicate_of IS NULL ORDER BY d.id DESC LIMIT 5",[business.id])).rows;
  const period=(await query("SELECT reason,target,allocated,completed FROM generation_periods WHERE business_id=$1 ORDER BY period_start DESC LIMIT 1",[business.id])).rows[0];
  const postsPerWeek=(await entitlementsFor(currentOwner())).limits.postsPerWeek;
  return NextResponse.json({business,reviews,drafts,period,postsPerWeek});
});
