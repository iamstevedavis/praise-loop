import { ApiError } from "../src/api/client";
import type { Draft } from "../src/api/drafts";
import { confirmShared, declineShared, PASTE_HINT, prepareShare, SHARED_HINT, type ShareDeps, type ShareState } from "../src/posting/shareFlow";

const draft: Draft = {
  id: 12,
  version: 3,
  quote_text: "Best flat white in the neighbourhood.",
  caption_text: "Thanks for saying so.",
  image_path: "/api/media/draft-12.png",
  status: "approved",
  shared_at: null,
  scheduled_for: null,
  created_at: "2026-10-27T12:00:00Z",
  rating: 5,
  author_name: "Priya S.",
  reviewed_at: null,
  source: "manual",
  job_state: null,
  error_code: null,
  provider_state: null
};

function deps(overrides: Partial<ShareDeps> = {}) {
  const calls: string[] = [];
  const base: ShareDeps = {
    canShare: async () => true,
    downloadImage: async item => { calls.push(`download:${item.id}`); return "file:///cache/draft-12.png"; },
    copyCaption: async text => { calls.push(`copy:${text}`); },
    openShareSheet: async uri => { calls.push(`share:${uri}`); },
    markShared: async item => { calls.push(`mark:${item.id}`); return { ...item, status: "shared", version: item.version + 1, shared_at: "2026-10-28T12:00:00Z" }; },
    discardImage: async uri => { calls.push(`discard:${uri}`); }
  };
  return { deps: { ...base, ...overrides }, calls };
}

async function prepared(overrides: Partial<ShareDeps> = {}) {
  const harness = deps(overrides);
  const state = await prepareShare(draft, harness.deps);
  return { ...harness, state };
}

describe("share flow", () => {
  it("saves the image, copies the caption and opens the sheet before asking", async () => {
    const { state, calls } = await prepared();
    expect(state).toEqual({ step: "confirm", draft });
    expect(calls).toEqual([
      "download:12",
      "copy:Thanks for saying so.",
      "share:file:///cache/draft-12.png",
      "discard:file:///cache/draft-12.png"
    ]);
    expect(SHARED_HINT).toMatch(/paste/i);
  });

  it("tells the owner to paste the caption before the sheet opens", () => {
    // The confirmation modal is only reached after sharing, so the same
    // instruction has to be on screen next to the Post button.
    expect(PASTE_HINT).toMatch(/paste/i);
    expect(PASTE_HINT).toMatch(/instagram/i);
  });

  it("never opens the sheet when sharing is unavailable", async () => {
    const { state, calls } = await prepared({ canShare: async () => false });
    expect(state).toMatchObject({ step: "error" });
    expect(calls).toEqual([]);
  });

  it("reports a download failure without copying or sharing", async () => {
    const { state, calls } = await prepared({ downloadImage: async () => { throw new Error("offline"); } });
    expect(state).toMatchObject({ step: "error", message: expect.stringMatching(/save the image/i) });
    expect(calls).toEqual([]);
  });

  it("flags an expired session when the image download is rejected", async () => {
    const { state, calls } = await prepared({ downloadImage: async () => { throw new ApiError("signedOut", 401); } });
    expect(state).toMatchObject({ step: "error", reason: "signedOut", message: expect.stringMatching(/sign in/i) });
    expect(calls).toEqual([]);
  });

  it("cleans up the cached image when the caption copy fails", async () => {
    const { state, calls } = await prepared({ copyCaption: async () => { throw new Error("clipboard"); } });
    expect(state).toMatchObject({ step: "error", message: expect.stringMatching(/caption/i) });
    expect(calls).toEqual(["download:12", "discard:file:///cache/draft-12.png"]);
  });

  it("cleans up and reports when the share sheet cannot open", async () => {
    const { state, calls } = await prepared({ openShareSheet: async () => { throw new Error("no activity"); } });
    expect(state).toMatchObject({ step: "error", message: expect.stringMatching(/share sheet/i) });
    expect(calls).toContain("discard:file:///cache/draft-12.png");
  });

  it("treats a cancelled share as 'not posted' and records nothing", async () => {
    const { state } = await prepared();
    expect(state.step).toBe("confirm");
    expect(declineShared()).toEqual({ step: "idle" });
  });

  it("marks the post shared only after the owner confirms", async () => {
    const confirm: ShareState = { step: "confirm", draft };
    const { deps: shareDeps, calls } = deps();
    const result = await confirmShared(confirm, shareDeps);
    expect(result.step).toBe("done");
    expect(result).toMatchObject({ draft: { status: "shared", version: 4 } });
    expect(calls).toEqual(["mark:12"]);
  });

  it("does not mark anything when confirmation is skipped", async () => {
    const { deps: shareDeps, calls } = deps();
    await expect(confirmShared({ step: "idle" }, shareDeps)).resolves.toEqual({ step: "idle" });
    expect(calls).toEqual([]);
  });

  it("explains a version conflict instead of pretending the post was recorded", async () => {
    const { deps: shareDeps } = deps({ markShared: async () => { throw new ApiError("conflict", 409); } });
    const result = await confirmShared({ step: "confirm", draft }, shareDeps);
    expect(result).toMatchObject({ step: "error", reason: "conflict" });
  });

  it("flags an expired session so the app can return to sign-in", async () => {
    const { deps: shareDeps } = deps({ markShared: async () => { throw new ApiError("signedOut", 401); } });
    const result = await confirmShared({ step: "confirm", draft }, shareDeps);
    expect(result).toMatchObject({ step: "error", reason: "signedOut" });
  });
});
