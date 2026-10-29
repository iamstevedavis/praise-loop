import { createApiClient } from "../src/api/client";
import { captionProblem, fetchGeneration, listDrafts, saveCaption, setDraftStatus, type Draft } from "../src/api/drafts";

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "12",
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
    reviewed_at: "2026-10-26T12:00:00Z",
    source: "manual",
    job_state: "complete",
    error_code: null,
    provider_state: null,
    ...overrides
  };
}

function client(status: number, body: unknown = {}, calls: { url: string; body?: unknown }[] = []) {
  return createApiClient({
    baseUrl: "http://localhost:3000",
    getToken: () => "mobile-token",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
    }) as typeof fetch
  });
}

describe("draft API", () => {
  it("coerces bigint IDs and keeps the queue ordered as the server sent it", async () => {
    const rows = [draftRow({ id: "12" }), draftRow({ id: "9", status: "approved" })];
    const drafts = await listDrafts(client(200, { drafts: rows }), 4);
    expect(drafts.map(draft => draft.id)).toEqual([12, 9]);
    expect(drafts[0]).toMatchObject({ version: 3, status: "draft", rating: 5 });
  });

  it("rejects a draft list with an unknown status instead of rendering it", async () => {
    const bad = client(200, { drafts: [draftRow({ status: "mystery" })] });
    await expect(listDrafts(bad, 4)).rejects.toThrow(/unknown draft status/i);
  });

  it("sends the version with a caption save and returns the new version", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const draft = { id: 12, version: 3 } as Draft;
    const updated = await saveCaption(client(200, { draft: draftRow({ version: 4, caption_text: "New" }) }, calls), draft, "New");
    expect(calls[0].url).toBe("http://localhost:3000/api/drafts/caption");
    expect(calls[0].body).toEqual({ draftPostId: 12, captionText: "New", version: 3 });
    expect(updated.version).toBe(4);
  });

  it("marks a post shared with the current version", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const draft = { id: 12, version: 7 } as Draft;
    const updated = await setDraftStatus(client(200, { draft: draftRow({ version: 8, status: "shared", shared_at: "2026-10-28T12:00:00Z" }) }, calls), draft, "shared");
    expect(calls[0].body).toEqual({ draftPostId: 12, status: "shared", version: 7 });
    expect(updated.status).toBe("shared");
  });

  it("surfaces a version conflict as a conflict error", async () => {
    const draft = { id: 12, version: 3 } as Draft;
    await expect(setDraftStatus(client(409), draft, "approved")).rejects.toMatchObject({ kind: "conflict" });
  });

  it("reads generation progress for the queue banner", async () => {
    const generation = await fetchGeneration(client(200, {
      jobs: [{ id: "1", draft_id: "12", state: "complete", attempts: 1, manual_retries: 0, error_code: null, period_start: "2026-10-26" }],
      periods: [{ period_start: "2026-10-26", target: 4, allocated: 3, completed: 2, reason: "queued", timezone: "America/Toronto" }]
    }), 4);
    expect(generation.periods[0]).toMatchObject({ target: 4, completed: 2 });
    expect(generation.jobs[0].draft_id).toBe(12);
  });

  it("mirrors the server's caption rule", () => {
    expect(captionProblem("   ")).toMatch(/add a caption/i);
    expect(captionProblem("x".repeat(201))).toMatch(/200/);
    expect(captionProblem("x".repeat(200))).toBeNull();
    expect(captionProblem("  A short caption  ")).toBeNull();
  });
});
