import { ApiError } from "../src/api/client";
import {
  createDraftImageLoader,
  draftImageCacheName,
  type CachedImageFile,
  type ImageFileSystem
} from "../src/media/draftImage";

function harness() {
  const files = new Map<string, CachedImageFile>();
  const calls: { url: string; headers: Record<string, string>; target: string }[] = [];

  const fs: ImageFileSystem = {
    cacheFile(name) {
      let file = files.get(name);
      if (!file) {
        file = { uri: `file:///cache/${name}`, exists: false };
        files.set(name, file);
      }
      return file;
    },
    async download(url, target, headers) {
      calls.push({ url, headers, target: target.uri });
      target.exists = true;
      return target;
    },
    listCached() {
      return [...files.entries()]
        .filter(([name]) => name.startsWith("praiseloop-media-"))
        .map(([, file]) => {
          file.delete = () => { file.exists = false; deleted.push(file.uri); };
          return file;
        });
    }
  };
  const deleted: string[] = [];

  return { fs, calls, files, deleted };
}

describe("draft image loader", () => {
  it("downloads the protected PNG with the bearer token and returns the local file", async () => {
    const { fs, calls } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000/", fs });

    await expect(loader.load("mobile-token", "/api/media/draft-1.png"))
      .resolves.toBe("file:///cache/praiseloop-media-draft-1.png");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:3000/api/media/draft-1.png");
    expect(calls[0].headers).toEqual({ authorization: "Bearer mobile-token" });
  });

  it("shares one download between the queue and the draft screen", async () => {
    const { fs, calls } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });

    const [first, second] = await Promise.all([
      loader.load("mobile-token", "/api/media/draft-1.png"),
      loader.load("mobile-token", "/api/media/draft-1.png")
    ]);
    const third = await loader.load("mobile-token", "/api/media/draft-1.png");

    expect(first).toBe("file:///cache/praiseloop-media-draft-1.png");
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("retries after a failed download instead of caching the failure", async () => {
    const { fs, calls } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });
    const realDownload = fs.download;
    fs.download = async () => {
      throw new Error("socket closed");
    };

    await expect(loader.load("mobile-token", "/api/media/draft-2.png")).rejects.toThrow("socket closed");
    fs.download = realDownload;

    await expect(loader.load("mobile-token", "/api/media/draft-2.png"))
      .resolves.toBe("file:///cache/praiseloop-media-draft-2.png");
    expect(calls).toHaveLength(1);
  });

  it("turns an HTTP 401 into the app's signed-out error", async () => {
    const { fs } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });
    fs.download = async () => {
      throw new Error("UnableToDownload: response has status: 401");
    };

    const error = await loader.load("expired-token", "/api/media/draft-3.png").catch(cause => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "signedOut", status: 401 });
  });

  it("redownloads when the OS evicted the cached file", async () => {    const { fs, calls, files } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });

    await loader.load("mobile-token", "/api/media/draft-4.png");
    const cached = files.get(draftImageCacheName("/api/media/draft-4.png"));
    expect(cached?.exists).toBe(true);
    if (cached) cached.exists = false;

    await expect(loader.load("mobile-token", "/api/media/draft-4.png"))
      .resolves.toBe("file:///cache/praiseloop-media-draft-4.png");
    expect(calls).toHaveLength(2);
  });

  it("drops the in-memory cache when a session ends", async () => {
    const { fs, calls } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });

    await loader.load("mobile-token", "/api/media/draft-5.png");
    loader.clear();
    await loader.load("mobile-token", "/api/media/draft-5.png");

    expect(calls).toHaveLength(2);
  });

  it("removes the cached image files when a session ends", async () => {
    const { fs, files, deleted } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });

    await loader.load("mobile-token", "/api/media/draft-6.png");
    await loader.load("mobile-token", "/api/media/draft-7.png");
    loader.clear();

    expect(deleted.sort()).toEqual(["file:///cache/praiseloop-media-draft-6.png", "file:///cache/praiseloop-media-draft-7.png"]);
    expect(files.get(draftImageCacheName("/api/media/draft-6.png"))?.exists).toBe(false);
  });

  it("removes a download that finishes after the session ended", async () => {
    const { fs, files, deleted } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });
    let finish: () => void = () => {};
    fs.download = (_url, target) => new Promise(resolve => {
      finish = () => { target.exists = true; resolve(target); };
    });

    const pending = loader.load("mobile-token", "/api/media/draft-8.png").catch(error => error);
    loader.clear();
    finish();

    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect(deleted).toContain("file:///cache/praiseloop-media-draft-8.png");
    expect(files.get(draftImageCacheName("/api/media/draft-8.png"))?.exists).toBe(false);
  });

  it("leaves a newer session's download alone when an older one finishes late", async () => {
    const { fs, files, deleted } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });
    const finishers: (() => void)[] = [];
    fs.download = (_url, target) => new Promise(resolve => {
      finishers.push(() => { target.exists = true; resolve(target); });
    });

    const stale = loader.load("old-token", "/api/media/draft-9.png").catch(error => error);
    loader.clear();
    const fresh = loader.load("new-token", "/api/media/draft-9.png");
    deleted.length = 0; // clear() itself removed what was cached; only later deletions matter here
    finishers[0]();
    expect(await stale).toBeInstanceOf(Error);
    finishers[1]();

    await expect(fresh).resolves.toBe("file:///cache/praiseloop-media-draft-9.png");
    expect(deleted).toEqual([]);
    expect(files.get(draftImageCacheName("/api/media/draft-9.png"))?.exists).toBe(true);
  });

  it("never throws when the cache cannot be listed or a file cannot be deleted", async () => {
    const { fs } = harness();
    const loader = createDraftImageLoader({ baseUrl: "http://localhost:3000", fs });
    fs.listCached = () => { throw new Error("cache unavailable"); };
    expect(() => loader.clear()).not.toThrow();

    fs.listCached = () => [{ uri: "file:///cache/praiseloop-media-x.png", exists: true, delete: () => { throw new Error("busy"); } }];
    expect(() => loader.clear()).not.toThrow();
  });

  it("keeps a server path from escaping the cache directory", () => {
    expect(draftImageCacheName("../../etc/passwd")).toBe("praiseloop-media-passwd");
    expect(draftImageCacheName("/api/media/../../evil.png")).toBe("praiseloop-media-evil.png");
  });
});
