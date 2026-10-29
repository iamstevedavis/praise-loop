import { ApiError } from "../api/client";
import type { Draft } from "../api/drafts";

export type ShareDeps = {
  canShare: () => Promise<boolean>;
  downloadImage: (draft: Draft) => Promise<string>;
  copyCaption: (caption: string) => Promise<void>;
  openShareSheet: (uri: string) => Promise<void>;
  markShared: (draft: Draft) => Promise<Draft>;
  discardImage: (uri: string) => Promise<void>;
};

export type ShareState =
  | { step: "idle" }
  | { step: "preparing" }
  // The share sheet has closed; the owner is answering "Did you post it?".
  | { step: "confirm"; draft: Draft }
  | { step: "saving"; draft: Draft }
  | { step: "done"; draft: Draft }
  | { step: "error"; message: string; reason?: "conflict" | "signedOut" | "generic" };

export const SHARED_HINT = "Caption copied — paste it in Instagram";

// Save the PNG, copy the caption and open the share sheet. Instagram does not
// accept caption text from other apps, so the copy is a separate, explicit step.
// A cancelled share cannot be detected, which is why the owner is asked instead.
export async function prepareShare(draft: Draft, deps: ShareDeps): Promise<ShareState> {
  if (!draft.image_path) {
    return { step: "error", message: "This post has no image to share yet." };
  }
  if (!(await deps.canShare())) {
    return { step: "error", message: "This phone can't open a share sheet." };
  }

  let uri: string;
  try {
    uri = await deps.downloadImage(draft);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "signedOut") {
      return { step: "error", message: "Your session ended. Sign in again.", reason: "signedOut" };
    }
    return { step: "error", message: "Couldn't save the image. Check your connection and try again." };
  }

  try {
    await deps.copyCaption(draft.caption_text);
  } catch {
    await discardQuietly(deps, uri);
    return { step: "error", message: "Couldn't copy the caption to the clipboard." };
  }

  try {
    await deps.openShareSheet(uri);
  } catch {
    await discardQuietly(deps, uri);
    return { step: "error", message: "Couldn't open the share sheet." };
  }

  // The sheet is closed, so the cache copy has done its job.
  await discardQuietly(deps, uri);
  return { step: "confirm", draft };
}

// Only called after the owner says they posted it. Never inferred from the share
// result: the server records `shared` as owner-reported, not verified.
export async function confirmShared(state: ShareState, deps: ShareDeps): Promise<ShareState> {
  if (state.step !== "confirm") return state;
  try {
    const updated = await deps.markShared(state.draft);
    return { step: "done", draft: updated };
  } catch (error) {
    if (error instanceof ApiError && error.kind === "conflict") {
      return { step: "error", message: "This post changed somewhere else. Refresh and try again.", reason: "conflict" };
    }
    if (error instanceof ApiError && error.kind === "signedOut") {
      return { step: "error", message: "Your session ended. Sign in again.", reason: "signedOut" };
    }
    return { step: "error", message: "Couldn't record the post as shared.", reason: "generic" };
  }
}

export function declineShared(): ShareState {
  return { step: "idle" };
}

async function discardQuietly(deps: ShareDeps, uri: string): Promise<void> {
  try {
    await deps.discardImage(uri);
  } catch {
    // Cache cleanup never blocks the flow.
  }
}
