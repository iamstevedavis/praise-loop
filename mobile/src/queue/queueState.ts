import type { Draft, GenerationSnapshot } from "../api/drafts";

export type QueueSections = {
  awaiting: Draft[];
  approved: Draft[];
  shared: Draft[];
  archived: Draft[];
  failed: Draft[];
};

export type QueueView = QueueSections & {
  progress: { completed: number; target: number } | null;
  readyCount: number;
  // Jobs the worker is actually working on. Remaining quota is not progress:
  // a week can be under target because reviews ran out or retries were used up.
  activeJobs: number;
  reviewsExhausted: boolean;
};

const ACTIVE_STATES = new Set(["pending", "running", "retry"]);

// Pure shaping of the queue response so every list state can be tested without a
// renderer. The server already orders drafts newest first.
export function buildQueue(drafts: Draft[], generation: GenerationSnapshot | null): QueueView {
  const sections: QueueSections = { awaiting: [], approved: [], shared: [], archived: [], failed: [] };
  for (const draft of drafts) {
    if (draft.status === "draft") sections.awaiting.push(draft);
    else if (draft.status === "approved") sections.approved.push(draft);
    else if (draft.status === "shared") sections.shared.push(draft);
    else if (draft.status === "archived") sections.archived.push(draft);
    else if (draft.status === "failed") sections.failed.push(draft);
  }
  const period = generation?.periods[0];
  const activeJobs = (generation?.jobs ?? []).filter(job => ACTIVE_STATES.has(job.state)).length;
  return {
    ...sections,
    progress: period ? { completed: Math.min(period.completed, period.target), target: period.target } : null,
    readyCount: sections.awaiting.length + sections.approved.length,
    activeJobs,
    reviewsExhausted: period?.reason === "reviews_exhausted"
  };
}

// Plain-language headline for the queue banner. "Generating" wins over the
// empty state so the owner does not think the week is lost.
export function queueHeadline(view: QueueView, generating: boolean): string {
  if (view.awaiting.length > 0) {
    return view.awaiting.length === 1 ? "1 post is ready to review" : `${view.awaiting.length} posts are ready to review`;
  }
  if (generating) return "This week's posts are still being made";
  if (view.approved.length > 0) return "Ready to post";
  if (view.shared.length > 0) return "This week is posted";
  if (view.reviewsExhausted) return "No more reviews to post this week";
  return "No posts this week yet";
}

// Only an actually active job means work is in flight; `completed < target`
// stays true for exhausted weeks and for jobs that have permanently failed.
export function isGenerating(view: QueueView): boolean {
  return view.activeJobs > 0;
}

export function queueEmptyMessage(view: QueueView): string {
  if (view.awaiting.length + view.approved.length + view.shared.length === 0) {
    if (view.reviewsExhausted) {
      return "Every review for this week already has a post. New posts appear when more reviews arrive, or import reviews on the web app.";
    }
    return "Posts appear here after the weekly review pick. Use the web app to import reviews or change branding.";
  }
  return "";
}
