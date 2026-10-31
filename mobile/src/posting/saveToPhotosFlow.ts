import { ApiError } from "../api/client";
import type { Draft } from "../api/drafts";

export type PhotoPermission = "granted" | "denied" | "unavailable";

export type SaveToPhotosDeps = {
  // Called only after the owner taps Save to Photos, never on screen mount.
  requestPermission: () => Promise<PhotoPermission>;
  downloadImage: (draft: Draft) => Promise<string>;
  saveImage: (uri: string) => Promise<void>;
  discardImage: (uri: string) => Promise<void>;
};

export type SaveToPhotosState =
  | { step: "idle" }
  | { step: "saving" }
  | { step: "done" }
  | { step: "error"; message: string; reason?: "permission" | "signedOut" | "unavailable" };

export const PHOTO_PERMISSION_HELP =
  "PraiseLoop can't save to your photos. Allow Photos access for PraiseLoop in your phone's settings, then try again.";

// Save the approved PNG to the device photo library. The image is downloaded
// through the same owner-protected media route as sharing and the cache copy is
// removed afterwards, whether or not saving worked.
export async function saveToPhotos(draft: Draft, deps: SaveToPhotosDeps): Promise<SaveToPhotosState> {
  if (!draft.image_path) {
    return { step: "error", message: "This post has no image to save yet." };
  }

  let permission: PhotoPermission;
  try {
    permission = await deps.requestPermission();
  } catch {
    permission = "denied";
  }
  if (permission === "unavailable") {
    return {
      step: "error",
      reason: "unavailable",
      message: "Saving to Photos isn't available in this build. Use Post to share the image instead."
    };
  }
  if (permission !== "granted") {
    return { step: "error", reason: "permission", message: PHOTO_PERMISSION_HELP };
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
    await deps.saveImage(uri);
    return { step: "done" };
  } catch {
    return { step: "error", message: "Couldn't save this image to your photos. Try again." };
  } finally {
    await discardQuietly(deps, uri);
  }
}

async function discardQuietly(deps: SaveToPhotosDeps, uri: string): Promise<void> {
  try {
    await deps.discardImage(uri);
  } catch {
    // Cache cleanup never blocks the flow.
  }
}
