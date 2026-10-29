import type { Draft, GenerationSnapshot } from "../src/api/drafts";
import { buildQueue, isGenerating, queueEmptyMessage, queueHeadline } from "../src/queue/queueState";

function draft(id: number, status: Draft["status"]): Draft {
  return {
    id,
    version: 0,
    quote_text: `Quote ${id}`,
    caption_text: `Caption ${id}`,
    image_path: `/api/media/draft-${id}.png`,
    status,
    shared_at: null,
    scheduled_for: null,
    created_at: "2026-10-27T12:00:00Z",
    rating: 5,
    author_name: "Reviewer",
    reviewed_at: null,
    source: "manual",
    job_state: null,
    error_code: null,
    provider_state: null
  };
}

function generation(target: number, completed: number): GenerationSnapshot {
  return {
    jobs: [],
    periods: [{ period_start: "2026-10-26", target, allocated: target, completed, reason: "queued", timezone: "UTC" }]
  };
}

describe("queue shaping", () => {
  it("groups drafts by lifecycle state without reordering them", () => {
    const view = buildQueue([draft(5, "draft"), draft(4, "approved"), draft(3, "draft"), draft(2, "shared"), draft(1, "archived")], null);
    expect(view.awaiting.map(item => item.id)).toEqual([5, 3]);
    expect(view.approved.map(item => item.id)).toEqual([4]);
    expect(view.shared.map(item => item.id)).toEqual([2]);
    expect(view.archived.map(item => item.id)).toEqual([1]);
    expect(view.readyCount).toBe(3);
    expect(view.progress).toBeNull();
  });

  it("derives the generating state from the first period only", () => {
    const view = buildQueue([], generation(4, 2));
    expect(view.progress).toEqual({ completed: 2, target: 4 });
    expect(isGenerating(view)).toBe(true);

    const done = buildQueue([], generation(4, 4));
    expect(isGenerating(done)).toBe(false);
  });

  it("never reports more completed posts than the target", () => {
    expect(buildQueue([], generation(3, 5)).progress).toEqual({ completed: 3, target: 3 });
  });

  it("puts reviewable posts first in the headline, then progress, then the empty state", () => {
    expect(queueHeadline(buildQueue([draft(1, "draft"), draft(2, "draft")], null), false)).toBe("2 posts are ready to review");
    expect(queueHeadline(buildQueue([draft(1, "draft")], null), false)).toBe("1 post is ready to review");
    expect(queueHeadline(buildQueue([], generation(4, 1)), true)).toBe("This week's posts are still being made");
    expect(queueHeadline(buildQueue([draft(1, "approved")], generation(4, 4)), false)).toBe("Ready to post");
    expect(queueHeadline(buildQueue([draft(1, "shared")], generation(4, 4)), false)).toBe("This week is posted");
    expect(queueHeadline(buildQueue([], generation(4, 4)), false)).toBe("No posts this week yet");
  });

  it("explains an empty week only when there is nothing at all", () => {
    expect(queueEmptyMessage(buildQueue([], generation(4, 4)))).toMatch(/web app/i);
    expect(queueEmptyMessage(buildQueue([draft(1, "shared")], generation(4, 4)))).toBe("");
  });
});
