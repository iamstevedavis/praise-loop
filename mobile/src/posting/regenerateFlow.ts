import { ApiError } from "../api/client";
import { REGENERATE_EXHAUSTED, type Draft } from "../api/drafts";

export type RegenerateDeps = {
  regenerate: (draft: Draft) => Promise<void>;
};

export type RegenerateState =
  | { step: "idle" }
  | { step: "working" }
  // The server queued a job; the queue shows the progress from GET /api/generation.
  | { step: "queued" }
  | {
      step: "error";
      message: string;
      reason?: "conflict" | "active" | "exhausted" | "limit" | "signedOut" | "generic";
      // A 409 that is not an exhausted retry budget means the screen's snapshot is
      // stale, so reload it before the owner tries again.
      reload?: boolean;
    };

// Shown in the confirmation dialog. The owner needs to know the old caption and
// image are replaced and that approval is cleared, not just that a request happens.
export const REGENERATE_CONFIRM =
  "Make a new version? PraiseLoop will write a fresh caption and design a new image for this quote, clear its approval, and use one of this post's new-version attempts. The current version is replaced.";

function conflictDetail(error: ApiError): string {
  return `${error.detail ?? ""} ${error.message}`.trim();
}

// Pure state handling for the Regenerate button so the server's refusals are
// tested without a renderer, like the share flow.
export async function requestRegenerate(draft: Draft, deps: RegenerateDeps): Promise<RegenerateState> {
  try {
    await deps.regenerate(draft);
    return { step: "queued" };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.kind === "signedOut") {
        return { step: "error", message: "Your session ended. Sign in again.", reason: "signedOut" };
      }
      if (error.kind === "limit") {
        return { step: "error", message: "You've reached today's limit. Try again tomorrow.", reason: "limit" };
      }
      if (error.kind === "conflict" || (error.kind === "http" && error.status === 409)) {
        const detail = conflictDetail(error);
        if (error.message === REGENERATE_EXHAUSTED || /retry budget|no recoverable job/i.test(detail)) {
          return { step: "error", message: REGENERATE_EXHAUSTED, reason: "exhausted" };
        }
        if (/generation is still active/i.test(detail)) {
          return {
            step: "error",
            message: "PraiseLoop is still making this post. Wait for it to finish before making a new version.",
            reason: "active",
            reload: true
          };
        }
        return {
          step: "error",
          message: "This post changed somewhere else. Reload and try again.",
          reason: "conflict",
          reload: true
        };
      }
    }
    return { step: "error", message: "Couldn't start a new version. Try again.", reason: "generic" };
  }
}
