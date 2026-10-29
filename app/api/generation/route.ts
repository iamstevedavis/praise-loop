import { NextResponse } from "next/server";
import { ownerRoute } from "../../../lib/authorization";
import { query } from "../../../lib/db";
import { generationWeek } from "../../../lib/services/generation";
import { validTimezone } from "../../../lib/timezone";
export const GET = ownerRoute(async req => {
  const id = req.nextUrl.searchParams.get("businessId");
  const jobs = await query("SELECT id,draft_id,state,attempts,manual_retries,next_at,error_code,period_start::text FROM generation_jobs WHERE business_id=$1 ORDER BY id DESC LIMIT 50",[id]);
  const periods = await query("SELECT period_start::text,target,allocated,completed,reason,timezone FROM generation_periods WHERE business_id=$1 ORDER BY period_start DESC LIMIT 2",[id]);
  // The latest stored period is not necessarily the current week: before the
  // first request of a week, only last week's row exists. Tell the client which
  // period "this week" means so it never shows last week's progress or reason.
  const business = await query("SELECT timezone FROM businesses WHERE id=$1",[id]);
  const timezone = business.rows[0]?.timezone;
  const currentPeriod = validTimezone(timezone) ? generationWeek(new Date(), timezone) : null;
  return NextResponse.json({jobs:jobs.rows,periods:periods.rows,current_period:currentPeriod});
});
