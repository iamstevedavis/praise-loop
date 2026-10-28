import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { BufferSchedulerAdapter, SchedulerAmbiguous, SchedulerAuthError, SchedulerRateLimited, SchedulerRejected } from "../lib/integrations/buffer";
import { decryptCredential, encryptCredential } from "../lib/integrations/credentials";
const NOW = Date.parse("2026-11-01T00:00:00Z");
const payload = { draftPostId: 1, businessId: 1, quoteText: "q", captionText: "Thanks!", imagePath: null, mediaUrl: "https://media.example/cap/abc", scheduledFor: "2026-12-01T10:00:00.000Z" };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function make(responses: (Response | Error)[]) {
  const calls: { body: string; auth: string }[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    calls.push({ body: String(init.body), auth: String((init.headers as Record<string, string>).authorization) });
    const r = responses.shift()!; if (r instanceof Error) throw r; return r;
  }) as unknown as typeof fetch;
  return { calls, a: new BufferSchedulerAdapter({ accessToken: "TOKEN", channelId: "ch1", fetchImpl, now: () => NOW, sleep: async () => {} }) };
}
async function main() {
  const good = { data: { createPost: { post: { id: "p1", status: "scheduled" } } } };
  let t = make([ok(good)]);
  const r = await t.a.schedulePost(payload);
  assert.deepEqual([r.provider, r.confirmed, r.externalId, r.status], ["buffer", true, "p1", "scheduled"]);
  assert.deepEqual(JSON.parse(t.calls[0].body).variables.input.assets, [{ image: { url: payload.mediaUrl } }], "documented AssetInput shape");
  assert.match(t.calls[0].body, /customScheduled/); assert.match(t.calls[0].body, /2026-12-01T10:00:00.000Z/); assert.equal(t.calls[0].auth, "Bearer TOKEN");
  // incomplete or past drafts never reach the network
  t = make([]);
  await assert.rejects(t.a.schedulePost({ ...payload, mediaUrl: undefined }), SchedulerRejected);
  await assert.rejects(t.a.schedulePost({ ...payload, captionText: " " }), SchedulerRejected);
  await assert.rejects(t.a.schedulePost({ ...payload, scheduledFor: "2026-10-01T00:00:00Z" }), SchedulerRejected);
  assert.equal(t.calls.length, 0);
  await assert.rejects(make([new Response("", { status: 401 })]).a.schedulePost(payload), SchedulerAuthError);
  // 429 retried then succeeds; persistent 429 is bounded
  t = make([new Response("", { status: 429, headers: { "retry-after": "2" } }), ok(good)]);
  assert.equal((await t.a.schedulePost(payload)).externalId, "p1"); assert.equal(t.calls.length, 2);
  t = make([429, 429, 429, 429].map(s => new Response("", { status: s })));
  await assert.rejects(t.a.schedulePost(payload), SchedulerRateLimited); assert.equal(t.calls.length, 3);
  // a Retry-After beyond the 60s cap is reported, not shortened and retried
  t = make([new Response("", { status: 429, headers: { "retry-after": "753" } }), ok(good)]);
  await assert.rejects(t.a.schedulePost(payload), (e: unknown) => e instanceof SchedulerRateLimited && e.retryAfterMs === 753000); assert.equal(t.calls.length, 1);
  // timeout after send / 5xx: ambiguous, never resubmitted
  t = make([new Error("timeout"), ok(good)]);
  await assert.rejects(t.a.schedulePost(payload), SchedulerAmbiguous); assert.equal(t.calls.length, 1);
  t = make([new Response("", { status: 502 }), ok(good)]);
  await assert.rejects(t.a.schedulePost(payload), SchedulerAmbiguous); assert.equal(t.calls.length, 1);
  // media failure surfaces as rejection
  await assert.rejects(make([ok({ data: { createPost: { message: "Could not fetch image" } } })]).a.schedulePost(payload), /Could not fetch image/);
  // GraphQL-level errors are classified by code
  const gql = (code: string) => ok({ errors: [{ message: "x", extensions: { code } }] });
  await assert.rejects(make([gql("UNAUTHORIZED")]).a.schedulePost(payload), SchedulerAuthError);
  await assert.rejects(make([gql("FORBIDDEN")]).a.schedulePost(payload), SchedulerAuthError);
  await assert.rejects(make([gql("BAD_USER_INPUT")]).a.schedulePost(payload), SchedulerRejected);
  t = make([gql("UNEXPECTED"), ok(good)]);
  await assert.rejects(t.a.schedulePost(payload), SchedulerAmbiguous); assert.equal(t.calls.length, 1);
  // non-scheduled status is not a confirmed success
  assert.equal((await make([ok({ data: { createPost: { post: { id: "p2", status: "error" } } } })]).a.schedulePost(payload)).confirmed, false);
  // credentials: round trip, AAD binding, tamper detection
  const key = randomBytes(32), c = encryptCredential("secret-token", "owner:1|biz:1|buffer", key);
  assert.doesNotMatch(c, /secret-token/); assert.equal(decryptCredential(c, "owner:1|biz:1|buffer", key), "secret-token");
  assert.throws(() => decryptCredential(c, "owner:2|biz:1|buffer", key));
  assert.throws(() => decryptCredential(c, "owner:1|biz:1|buffer", randomBytes(32)));
  console.log("buffer adapter contract (mocked) and credential encryption tests passed");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
