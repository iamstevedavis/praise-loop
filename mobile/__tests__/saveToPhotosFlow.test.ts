import { ApiError } from "../src/api/client";
import type { Draft } from "../src/api/drafts";
import {
  PHOTO_PERMISSION_HELP,
  saveToPhotos,
  type SaveToPhotosDeps
} from "../src/posting/saveToPhotosFlow";

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

function deps(overrides: Partial<SaveToPhotosDeps> = {}) {
  const calls: string[] = [];
  const base: SaveToPhotosDeps = {
    requestPermission: async () => { calls.push("permission"); return "granted"; },
    downloadImage: async item => { calls.push(`download:${item.id}`); return "file:///cache/draft-12.png"; },
    saveImage: async uri => { calls.push(`save:${uri}`); },
    discardImage: async uri => { calls.push(`discard:${uri}`); }
  };
  return { deps: { ...base, ...overrides }, calls };
}

describe("save to photos flow", () => {
  it("asks for permission, saves the downloaded PNG and removes the cache copy", async () => {
    const { deps: flowDeps, calls } = deps();
    await expect(saveToPhotos(draft, flowDeps)).resolves.toEqual({ step: "done" });
    expect(calls).toEqual([
      "permission",
      "download:12",
      "save:file:///cache/draft-12.png",
      "discard:file:///cache/draft-12.png"
    ]);
  });

  it("explains how to enable Photos access when permission is denied", async () => {
    const { deps: flowDeps, calls } = deps({ requestPermission: async () => "denied" });
    const state = await saveToPhotos(draft, flowDeps);
    expect(state).toEqual({ step: "error", reason: "permission", message: PHOTO_PERMISSION_HELP });
    expect(PHOTO_PERMISSION_HELP).toMatch(/settings/i);
    expect(calls).toEqual([]);
  });

  it("does not download anything when the native module is unavailable", async () => {
    const { deps: flowDeps, calls } = deps({ requestPermission: async () => "unavailable" });
    await expect(saveToPhotos(draft, flowDeps)).resolves.toMatchObject({
      step: "error",
      reason: "unavailable",
      message: expect.stringMatching(/isn't available in this build/i)
    });
    expect(calls).toEqual([]);
  });

  it("reports a download failure without saving or leaving a file behind", async () => {
    const { deps: flowDeps, calls } = deps({
      downloadImage: async () => { throw new Error("offline"); }
    });
    await expect(saveToPhotos(draft, flowDeps)).resolves.toMatchObject({
      step: "error",
      message: expect.stringMatching(/save the image/i)
    });
    expect(calls).toEqual(["permission"]);
  });

  it("flags an expired session when the download is rejected", async () => {
    const { deps: flowDeps } = deps({
      downloadImage: async () => { throw new ApiError("signedOut", 401); }
    });
    await expect(saveToPhotos(draft, flowDeps)).resolves.toMatchObject({ step: "error", reason: "signedOut" });
  });

  it("cleans up the cached image when saving to the library fails", async () => {
    const { deps: flowDeps, calls } = deps({
      saveImage: async () => { throw new Error("library rejected the file"); }
    });
    await expect(saveToPhotos(draft, flowDeps)).resolves.toMatchObject({
      step: "error",
      message: expect.stringMatching(/couldn't save this image/i)
    });
    expect(calls).toEqual([
      "permission",
      "download:12",
      "discard:file:///cache/draft-12.png"
    ]);
  });

  it("still succeeds when cache cleanup fails", async () => {
    const { deps: flowDeps } = deps({ discardImage: async () => { throw new Error("busy"); } });
    await expect(saveToPhotos(draft, flowDeps)).resolves.toEqual({ step: "done" });
  });

  it("asks for nothing when the post has no image", async () => {
    const { deps: flowDeps, calls } = deps();
    await expect(saveToPhotos({ ...draft, image_path: null }, flowDeps)).resolves.toMatchObject({
      step: "error",
      message: expect.stringMatching(/no image/i)
    });
    expect(calls).toEqual([]);
  });
});
