import type { Draft, GenerationJob, GenerationSnapshot } from "../src/api/drafts";
import { buildQueue, isGenerating, queueEmptyMessage, queueHeadline } from "../src/queue/queueState";

function draft(id: number, status: Draft["status"], overrides: Partial<Draft> = {}): Draft {
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
    provider_state: null,
    ...overrides
  };
}

function job(id: number, state: string): GenerationJob {
  return {
    id,
    draft_id: id,
    state,
    attempts: 0,
    manual_retries: 0,
    error_code: state === "failed" ? "generation_failed" : null,
    period_start: "2026-10-26"
  };
}

function generation(target: number, completed: number, jobStates: string[] = [], reason = "queued"): GenerationSnapshot {
  return {
    jobs: jobStates.map((state, index) => job(index + 1, state)),
    periods: [{ period_start: "2026-10-26", target, allocated: target, completed, reason, timezone: "UTC" }],
    current_period: "2026-10-26"
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

  it("keeps unfinished jobs and incomplete drafts out of review-ready", () => {
    const running = draft(6, "draft", { job_state: "running" });
    const noCaption = draft(5, "draft", { caption_text: "   " });
    const noImage = draft(4, "draft", { image_path: null });
    const ready = draft(3, "draft");
    const view = buildQueue([running, noCaption, noImage, ready], generation(4, 0));

    expect(view.awaiting.map(item => item.id)).toEqual([3]);
    expect(view.making.map(item => item.id)).toEqual([6, 5, 4]);
    expect(view.readyCount).toBe(1);
    // The draft rows alone can prove work is in flight even when the capped job
    // list no longer mentions them.
    expect(isGenerating(view)).toBe(true);
    expect(queueHeadline(view, isGenerating(view))).toBe("1 post is ready to review");

    const onlyMaking = buildQueue([running], generation(4, 0));
    expect(queueHeadline(onlyMaking, isGenerating(onlyMaking))).toBe("This week's posts are still being made");
    expect(queueEmptyMessage(onlyMaking)).toBe("");
  });

  it("shows a failed job as needing attention instead of still being made", () => {
    const view = buildQueue([draft(1, "draft", { job_state: "failed" })], generation(4, 0));
    expect(view.failed.map(item => item.id)).toEqual([1]);
    expect(view.making).toEqual([]);
    expect(isGenerating(view)).toBe(false);
  });

  it("derives the generating state from active jobs, not remaining quota", () => {    const running = buildQueue([], generation(4, 1, ["done", "running", "pending"]));
    expect(running.progress).toEqual({ completed: 1, target: 4 });
    expect(running.activeJobs).toBe(2);
    expect(isGenerating(running)).toBe(true);
  });

  it("stops generating when the week is under target but no job is active", () => {
    // Reviews ran out: requestGeneration marks the period reviews_exhausted and
    // `completed < target` stays true forever.
    const exhausted = buildQueue([], generation(4, 1, ["done", "failed"], "reviews_exhausted"));
    expect(exhausted.activeJobs).toBe(0);
    expect(isGenerating(exhausted)).toBe(false);
    expect(exhausted.reviewsExhausted).toBe(true);
  });

  it("stops generating when every job has permanently failed", () => {
    const failed = buildQueue([], generation(4, 0, ["failed", "failed"]));
    expect(isGenerating(failed)).toBe(false);
    expect(failed.reviewsExhausted).toBe(false);
  });

  it("never reports more completed posts than the target", () => {
    expect(buildQueue([], generation(3, 5)).progress).toEqual({ completed: 3, target: 3 });
  });

  it("ignores last week's period before this week's first request", () => {
    const stale: GenerationSnapshot = {
      jobs: [],
      periods: [{ period_start: "2026-10-26", target: 4, allocated: 4, completed: 4, reason: "reviews_exhausted", timezone: "UTC" }],
      current_period: "2026-11-02"
    };
    const view = buildQueue([], stale);
    expect(view.progress).toBeNull();
    expect(view.reviewsExhausted).toBe(false);
    expect(queueHeadline(view, isGenerating(view))).toBe("No posts this week yet");
  });

  it("keeps scheduled and published posts visible instead of reporting an empty week", () => {
    const view = buildQueue([draft(2, "scheduled"), draft(1, "published")], generation(4, 2));
    expect(view.scheduled.map(item => item.id)).toEqual([2, 1]);
    expect(view.awaiting).toEqual([]);
    expect(queueHeadline(view, isGenerating(view))).toBe("This week is scheduled");
    expect(queueEmptyMessage(view)).toBe("");
  });

  it("puts reviewable posts first in the headline, then progress, then the empty state", () => {
    expect(queueHeadline(buildQueue([draft(1, "draft"), draft(2, "draft")], null), false)).toBe("2 posts are ready to review");
    expect(queueHeadline(buildQueue([draft(1, "draft")], null), false)).toBe("1 post is ready to review");
    expect(queueHeadline(buildQueue([], generation(4, 1, ["running"])), true)).toBe("This week's posts are still being made");
    expect(queueHeadline(buildQueue([draft(1, "approved")], generation(4, 4)), false)).toBe("Ready to post");
    expect(queueHeadline(buildQueue([draft(1, "shared")], generation(4, 4)), false)).toBe("This week is posted");
    expect(queueHeadline(buildQueue([], generation(4, 4)), false)).toBe("No posts this week yet");
  });

  it("explains an exhausted week instead of implying posts are coming", () => {
    const exhausted = buildQueue([], generation(4, 1, [], "reviews_exhausted"));
    expect(queueHeadline(exhausted, isGenerating(exhausted))).toBe("No more reviews to post this week");
    expect(queueEmptyMessage(exhausted)).toMatch(/review/i);
  });

  it("explains an empty week only when there is nothing at all", () => {
    expect(queueEmptyMessage(buildQueue([], generation(4, 4)))).toMatch(/web app/i);
    expect(queueEmptyMessage(buildQueue([draft(1, "shared")], generation(4, 4)))).toBe("");
  });
});
