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
};

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
  return {
    ...sections,
    progress: period ? { completed: Math.min(period.completed, period.target), target: period.target } : null,
    readyCount: sections.awaiting.length + sections.approved.length
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
  return "No posts this week yet";
}

export function isGenerating(view: QueueView): boolean {
  return !!view.progress && view.progress.completed < view.progress.target;
}

export function queueEmptyMessage(view: QueueView): string {
  if (view.awaiting.length + view.approved.length + view.shared.length === 0) {
    return "Posts appear here after the weekly review pick. Use the web app to import reviews or change branding.";
  }
  return "";
}
