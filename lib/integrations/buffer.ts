import type { SchedulePayload, ScheduleReceipt, SchedulerAdapter } from "./scheduler";
// Buffer GraphQL adapter (https://developers.buffer.com, see docs/integrations.md).
// NOT verified against a live account: the mutation shape follows the public docs and
// must be confirmed by the owner-approved live test before #29 can close.
export class SchedulerAuthError extends Error { constructor() { super("Buffer rejected the credentials; reconnect the channel."); } }
export class SchedulerRateLimited extends Error { constructor(public retryAfterMs: number) { super("Buffer rate limit persisted after bounded retries; nothing was submitted."); } }
export class SchedulerRejected extends Error { constructor(m: string) { super(`Buffer rejected the post (${m}); nothing was scheduled.`); } }
// Request may have been accepted. Callers must persist an unknown outcome and reconcile
// manually or via the post-status API; they must NOT resubmit (no provider dedupe).
export class SchedulerAmbiguous extends Error { constructor(m: string) { super(`Buffer outcome unknown (${m}); check the channel before retrying.`); } }
export type BufferOptions = { accessToken: string; channelId: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRateLimitRetries?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; endpoint?: string };
const MUTATION = `mutation($input: CreatePostInput!){ createPost(input:$input){ ... on PostActionSuccess { post { id status dueAt } } ... on MutationError { message } } }`;
export class BufferSchedulerAdapter implements SchedulerAdapter {
  constructor(private o: BufferOptions) {}
  async schedulePost(p: SchedulePayload): Promise<ScheduleReceipt> {
    const now = (this.o.now ?? Date.now)(), due = Date.parse(p.scheduledFor);
    if (!p.captionText.trim() || !p.mediaUrl) throw new SchedulerRejected("incomplete draft: caption and provider-fetchable media required");
    if (!Number.isFinite(due) || due <= now) throw new SchedulerRejected("scheduled time must be in the future");
    const body = JSON.stringify({ query: MUTATION, variables: { input: { channelId: this.o.channelId, text: p.captionText, schedulingType: "automatic", mode: "customScheduled", dueAt: new Date(due).toISOString(), assets: [{ image: { url: p.mediaUrl } }] } } });
    const max = this.o.maxRateLimitRetries ?? 2, sleep = this.o.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await (this.o.fetchImpl ?? fetch)(this.o.endpoint ?? "https://api.buffer.com", { method: "POST", body, signal: AbortSignal.timeout(this.o.timeoutMs ?? 15000), headers: { "content-type": "application/json", authorization: `Bearer ${this.o.accessToken}` } });
      } catch { throw new SchedulerAmbiguous("timeout or network failure after send"); }
      if (res.status === 401 || res.status === 403) throw new SchedulerAuthError();
      if (res.status === 429) { // rejected before processing: safe to retry, bounded
        const wait = Math.max(Number(res.headers.get("retry-after")) || 1, 1) * 1000;
        // A window longer than we are willing to wait is surfaced as-is, not shortened into a retry that cannot succeed.
        if (attempt >= max || wait > 60000) throw new SchedulerRateLimited(wait);
        await sleep(wait); continue;
      }
      if (!res.ok) throw new SchedulerAmbiguous(`HTTP ${res.status}`);
      let json: { data?: { createPost?: { post?: { id?: string; status?: string }; message?: string } }; errors?: { message?: string; extensions?: { code?: string } }[] };
      try { json = await res.json(); } catch { throw new SchedulerAmbiguous("unreadable response"); }
      const r = json.data?.createPost;
      if (r?.post?.id) return { provider: "buffer", confirmed: r.post.status === "scheduled", externalId: r.post.id, status: r.post.status === "scheduled" ? "scheduled" : "simulated" };
      if (r?.message) throw new SchedulerRejected(r.message.slice(0, 120));
      if (json.errors?.length) {
        // GraphQL-level errors: only input/validation codes prove nothing was scheduled. Auth failures map to
        // the auth error; anything else (e.g. UNEXPECTED) may have had side effects, so it stays ambiguous.
        const codes = json.errors.map(e => e.extensions?.code ?? "");
        if (codes.some(c => c === "UNAUTHORIZED" || c === "FORBIDDEN")) throw new SchedulerAuthError();
        if (codes.every(c => c === "BAD_USER_INPUT" || c === "GRAPHQL_VALIDATION_FAILED")) throw new SchedulerRejected((json.errors[0].message ?? "error").slice(0, 120));
        throw new SchedulerAmbiguous(`GraphQL error ${codes[0] || "unknown"}`);
      }
      throw new SchedulerAmbiguous("response without post id");
    }
  }
}
