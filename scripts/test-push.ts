import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { databaseFixture } from "./db-fixture";
import { createMobileSession } from "../lib/mobileSessions";
import { generationWeek } from "../lib/services/generation";
import * as tokens from "../app/api/mobile/push-tokens/route";
import { checkReceipts, enqueuePostsReady, pushTick, type PushMessage, type PushTransport } from "../lib/services/push";

const A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]", A2 = "ExponentPushToken[a2a2a2a2a2a2a2a2a2a2a2]", B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
function fake(overrides: { ticket?: (m: PushMessage) => any; fail?: boolean; receipt?: any } = {}) {
  const sent: PushMessage[] = [];
  const transport: PushTransport = {
    async send(ms) { if (overrides.fail) throw new Error("down"); sent.push(...ms); return ms.map((m, i) => overrides.ticket?.(m) ?? { status: "ok", id: `t-${sent.length}-${i}` }); },
    async receipts(ids) { return Object.fromEntries(ids.map(id => [id, overrides.receipt?.(id) ?? { status: "ok" }])); },
  };
  return { sent, transport };
}
async function main() {
  process.env.NEXTAUTH_URL = "http://localhost";
  await databaseFixture(async client => {
    for (const [id, email] of [["push-a", "a@example.invalid"], ["push-b", "b@example.invalid"]]) await client.query("INSERT INTO auth_users(id,email) VALUES($1,$2)", [id, email]);
    const biz = async (owner: string, name: string) => (await client.query("INSERT INTO businesses(name,timezone,owner_id) VALUES($1,'UTC',$2) RETURNING id", [name, owner])).rows[0].id;
    const ba = await biz("push-a", "Synthetic A"), bb = await biz("push-b", "Synthetic B");
    // A minute ahead keeps the test independent of the database clock (rows default
    // next_at to now()) and of the day it runs, while still using this week.
    const now = new Date(Date.now() + 60_000);
    const week = generationWeek(now, "UTC");
    const period = async (b: number, n: number, jobState = "complete") => {
      await client.query("INSERT INTO generation_periods(business_id,period_start,timezone,target,allocated,completed) VALUES($1,$2,'UTC',$3,$3,$3)", [b, week, n]);
      for (let i = 0; i < n; i++) {
        const d = (await client.query("INSERT INTO draft_posts(business_id,quote_text,caption_text,image_path,status) VALUES($1,'SECRET REVIEW QUOTE','SECRET CAPTION','/api/media/x.png','draft') RETURNING id", [b])).rows[0].id;
        await client.query("INSERT INTO generation_jobs(business_id,period_start,draft_id,state) VALUES($1,$2,$3,$4)", [b, week, d, jobState]);
      }
    };
    await period(ba, 3); await period(bb, 2, "running");

    // Token endpoints: validation, ownership, refresh.
    const sa = (await createMobileSession("push-a")).token, sb = (await createMobileSession("push-b")).token;
    const call = (fn: any, method: string, token: string, body: unknown) => fn(new NextRequest("http://localhost/api/mobile/push-tokens", { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal((await call(tokens.POST, "POST", sa, { token: "nope", platform: "ios" })).status, 400);
    assert.equal((await call(tokens.POST, "POST", sa, { token: A, platform: "web" })).status, 400);
    assert.equal((await call(tokens.POST, "POST", sa, { token: A, platform: "ios" })).status, 200);
    assert.equal((await call(tokens.POST, "POST", sa, { token: A, platform: "ios" })).status, 200);
    assert.equal((await call(tokens.POST, "POST", sa, { token: A2, platform: "android" })).status, 200);
    assert.equal((await call(tokens.POST, "POST", sb, { token: B, platform: "ios" })).status, 200);
    assert.equal((await client.query("SELECT count(*) FROM device_push_tokens WHERE owner_id='push-a'")).rows[0].count, "2");
    assert.equal((await (await call(tokens.DELETE, "DELETE", sb, { token: A })).json()).removed, false, "another owner cannot unregister");
    assert.equal((await client.query("SELECT count(*) FROM device_push_tokens")).rows[0].count, "3");

    // Period for B is still generating: only A's two devices are notified, once each.
    const first = fake();
    assert.equal((await pushTick(first.transport, now)).enqueued, 2);
    assert.equal(first.sent.length, 2);
    assert.deepEqual(first.sent.map(m => m.to).sort(), [A2, A]);
    for (const m of first.sent) {
      assert.equal(m.title, "Synthetic A"); assert.equal(m.body, "3 posts are ready to review.");
      assert.equal(m.data.url, `praiseloop://queue?businessId=${ba}`);
      assert.doesNotMatch(JSON.stringify(m), /SECRET/);
    }
    // A restarted worker (new transport, same database) sends nothing again.
    const again = fake();
    await pushTick(again.transport, now); await pushTick(again.transport, new Date(now.getTime() + 3600000));
    assert.equal(again.sent.length, 0);
    assert.equal(await enqueuePostsReady(now), 0);

    // B's period completes later: B gets its own, A's devices get nothing new.
    await client.query("UPDATE generation_jobs SET state='complete' WHERE business_id=$1", [bb]);
    const second = fake();
    await pushTick(second.transport, now);
    assert.deepEqual(second.sent.map(m => m.to), [B]); assert.equal(second.sent[0].body, "2 posts are ready to review.");

    // Receipts remove tokens Expo no longer recognises; others become delivered.
    await client.query("UPDATE push_deliveries SET state='sent' WHERE ticket_id IS NOT NULL"); // earlier ticks already acknowledged them
    const receipts = fake({ receipt: (id: string) => id === "t-2-0" ? { status: "error", error: "DeviceNotRegistered" } : { status: "ok" } });
    await checkReceipts(receipts.transport, new Date(now.getTime() + 20 * 60000));
    assert.equal((await client.query("SELECT count(*) FROM device_push_tokens WHERE token=$1", [first.sent[0].to])).rows[0].count, "0");
    assert.equal((await client.query("SELECT count(*) FROM push_deliveries WHERE state='delivered'")).rows[0].count, "2");

    // Invalid tokens in a ticket are removed; provider errors are recorded, retried, then fail without losing the job.
    await client.query("INSERT INTO device_push_tokens(owner_id,token,platform) VALUES('push-a','ExponentPushToken[cccccccccccccccccccccc]','ios')");
    await client.query("DELETE FROM push_deliveries WHERE business_id=$1", [ba]);
    const bad = fake({ ticket: () => ({ status: "error", error: "DeviceNotRegistered" }) });
    await pushTick(bad.transport, now);
    assert.equal((await client.query("SELECT count(*) FROM device_push_tokens WHERE owner_id='push-a'")).rows[0].count, "0");
    await client.query("INSERT INTO device_push_tokens(owner_id,token,platform) VALUES('push-a',$1,'ios')", [A]);
    await client.query("DELETE FROM push_deliveries WHERE business_id=$1", [ba]);
    const down = fake({ fail: true });
    let t = now.getTime();
    for (let i = 0; i < 5; i++) { await pushTick(down.transport, new Date(t)); t += 3600000; }
    const row = (await client.query("SELECT state,attempts,error_code FROM push_deliveries WHERE business_id=$1", [ba])).rows[0];
    assert.deepEqual(row, { state: "failed", attempts: 3, error_code: "provider_error" });
    assert.equal((await client.query("SELECT count(*) FROM device_push_tokens WHERE token=$1", [A])).rows[0].count, "1");
    assert.equal((await client.query("SELECT count(*) FROM generation_jobs WHERE state='complete'")).rows[0].count, "5");

    // A queued notification is never delivered to a device that has since moved to another owner.
    const D = "ExponentPushToken[dddddddddddddddddddddd]";
    await client.query("INSERT INTO device_push_tokens(owner_id,token,platform) VALUES('push-b',$1,'ios')", [D]);
    await client.query("INSERT INTO push_deliveries(business_id,period_start,token,count) VALUES($1,$2,$3,3)", [ba, week, D]);
    const moved = fake();
    await pushTick(moved.transport, new Date(now.getTime() + 24 * 3600000));
    assert.ok(moved.sent.every(m => m.to !== D || m.data.businessId !== ba), "previous owner's notification must not reach the new owner's device");
    assert.equal((await client.query("SELECT state FROM push_deliveries WHERE token=$1", [D])).rows[0].state, "pending");

    // Tokens are deleted with the owner.
    await client.query("DELETE FROM businesses WHERE owner_id='push-a'"); await client.query("DELETE FROM auth_users WHERE id='push-a'");
    assert.equal((await client.query("SELECT count(*) FROM device_push_tokens WHERE owner_id='push-a'")).rows[0].count, "0");
    console.log("push token ownership, per-period dedupe, receipts and error handling tests passed");
  });
}
main().catch(err => { console.error(err); process.exitCode = 1; });
