import { ApiError } from "../src/api/client";
import { REGENERATE_EXHAUSTED, type Draft } from "../src/api/drafts";
import { REGENERATE_CONFIRM, requestRegenerate, type RegenerateDeps } from "../src/posting/regenerateFlow";

const draft: Draft = {
  id: 12,
  version: 3,
  quote_text: "Best flat white in the neighbourhood.",
  caption_text: "Thanks for saying so.",
  image_path: "/api/media/draft-12.png",
  status: "draft",
  shared_at: null,
  scheduled_for: null,
  created_at: "2026-10-27T12:00:00Z",
  rating: 5,
  author_name: "Priya S.",
  reviewed_at: null,
  source: "manual",
  job_state: "complete",
  error_code: null,
  provider_state: null
};

function deps(overrides: Partial<RegenerateDeps> = {}) {
  const calls: string[] = [];
  const base: RegenerateDeps = {
    regenerate: async item => { calls.push(`regenerate:${item.id}:${item.version}`); }
  };
  return { deps: { ...base, ...overrides }, calls };
}

describe("regenerate flow", () => {
  it("queues a new version with the post's current version", async () => {
    const { deps: flowDeps, calls } = deps();
    await expect(requestRegenerate(draft, flowDeps)).resolves.toEqual({ step: "queued" });
    expect(calls).toEqual(["regenerate:12:3"]);
  });

  it("tells the owner what a new version does before it starts", () => {
    expect(REGENERATE_CONFIRM).toMatch(/fresh caption/i);
    expect(REGENERATE_CONFIRM).toMatch(/new image/i);
    expect(REGENERATE_CONFIRM).toMatch(/clear its approval/i);
    expect(REGENERATE_CONFIRM).toMatch(/new-version attempts/i);
  });

  it("reloads and explains a stale version instead of retrying against it", async () => {
    const { deps: flowDeps } = deps({
      regenerate: async () => { throw new ApiError("conflict", 409, undefined, "Draft changed; refresh and retry"); }
    });
    const state = await requestRegenerate(draft, flowDeps);
    expect(state).toMatchObject({ step: "error", reason: "conflict", reload: true });
    expect(state).toMatchObject({ message: expect.stringMatching(/changed somewhere else/i) });
  });

  it("explains a generation that is still active and reloads the progress", async () => {
    const { deps: flowDeps } = deps({
      regenerate: async () => { throw new ApiError("conflict", 409, undefined, "Generation is still active; wait for completion or archive"); }
    });
    const state = await requestRegenerate(draft, flowDeps);
    expect(state).toMatchObject({ step: "error", reason: "active", reload: true });
    expect(state).toMatchObject({ message: expect.stringMatching(/still making this post/i) });
  });

  it("keeps the exhausted new-version message without offering a pointless reload", async () => {
    const { deps: flowDeps } = deps({
      regenerate: async () => { throw new ApiError("http", 409, REGENERATE_EXHAUSTED); }
    });
    await expect(requestRegenerate(draft, flowDeps)).resolves.toEqual({
      step: "error",
      message: REGENERATE_EXHAUSTED,
      reason: "exhausted"
    });
  });

  it("also recognises the server's retry-budget wording from a raw conflict", async () => {
    const { deps: flowDeps } = deps({
      regenerate: async () => {
        throw new ApiError("conflict", 409, undefined, "Generation retry budget exhausted or no recoverable job");
      }
    });
    await expect(requestRegenerate(draft, flowDeps)).resolves.toMatchObject({ reason: "exhausted", message: REGENERATE_EXHAUSTED });
  });

  it("maps the daily generation limit to plain language", async () => {
    const { deps: flowDeps } = deps({
      regenerate: async () => { throw new ApiError("limit", 429); }
    });
    await expect(requestRegenerate(draft, flowDeps)).resolves.toMatchObject({
      step: "error",
      reason: "limit",
      message: expect.stringMatching(/today's limit/i)
    });
  });

  it("flags an expired session so the app can return to sign-in", async () => {
    const { deps: flowDeps } = deps({
      regenerate: async () => { throw new ApiError("signedOut", 401); }
    });
    await expect(requestRegenerate(draft, flowDeps)).resolves.toMatchObject({ step: "error", reason: "signedOut" });
  });

  it("offers a retry when the request fails for an unknown reason", async () => {
    const { deps: flowDeps } = deps({
      regenerate: async () => { throw new Error("offline"); }
    });
    await expect(requestRegenerate(draft, flowDeps)).resolves.toMatchObject({
      step: "error",
      reason: "generic",
      message: expect.stringMatching(/try again/i)
    });
  });
});
