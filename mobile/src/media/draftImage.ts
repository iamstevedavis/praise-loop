import { File, Paths } from "expo-file-system";
import { ApiError } from "../api/client";
import { appConfig } from "../config";

export function absoluteMediaUrl(baseUrl: string, imagePath: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  return `${root}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`;
}

// expo-file-system reports a non-2xx as "HTTP 401" / "response has status:
// 401". Surface an expired session as such so the app can return to sign-in
// instead of suggesting the owner check their connection.
export function mapImageDownloadError(error: unknown): unknown {
  if (/\b401\b/.test(error instanceof Error ? error.message : String(error))) {
    return new ApiError("signedOut", 401);
  }
  return error;
}

export type CachedImageFile = {
  uri: string;
  exists: boolean;
};

export type ImageFileSystem = {
  cacheFile: (name: string) => CachedImageFile;
  download: (url: string, target: CachedImageFile, headers: Record<string, string>) => Promise<CachedImageFile>;
};

const nativeFileSystem: ImageFileSystem = {
  cacheFile: name => new File(Paths.cache, name),
  download: (url, target, headers) =>
    File.downloadFileAsync(url, target as File, { headers, idempotent: true })
};

// Keep only the filename from the server's media path. A draft image path is
// content-addressed, so a regenerated post gets a new name and a new cache entry.
export function draftImageCacheName(imagePath: string): string {
  const base = imagePath.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "");
  return `praiseloop-media-${safe || "image"}`;
}

export type DraftImageLoaderOptions = {
  baseUrl?: string;
  fs?: ImageFileSystem;
};

export function createDraftImageLoader({ baseUrl = appConfig.apiBaseUrl, fs = nativeFileSystem }: DraftImageLoaderOptions = {}) {
  // One promise per media path so the queue and the draft screen share a single
  // download. Failures are dropped so the next attempt can retry.
  const downloads = new Map<string, Promise<string>>();

  function cachedFile(imagePath: string): CachedImageFile {
    return fs.cacheFile(draftImageCacheName(imagePath));
  }

  async function load(token: string, imagePath: string): Promise<string> {
    const key = `${baseUrl}\n${imagePath}`;
    const pending = downloads.get(key);
    if (pending) {
      try {
        const uri = await pending;
        // The OS may evict a cache file between screens; redownload instead of
        // handing React Native a URI that no longer exists.
        if (cachedFile(imagePath).exists) return uri;
      } catch {
        // The failed promise is removed below; fall through to a fresh attempt.
      }
      if (downloads.get(key) === pending) downloads.delete(key);
    }

    const promise = (async () => {
      const file = await fs.download(
        absoluteMediaUrl(baseUrl, imagePath),
        cachedFile(imagePath),
        { authorization: `Bearer ${token}` }
      );
      return file.uri;
    })().catch(error => {
      if (downloads.get(key) === promise) downloads.delete(key);
      throw mapImageDownloadError(error);
    });

    downloads.set(key, promise);
    return promise;
  }

  return { load, clear: () => downloads.clear() };
}

export const draftImageLoader = createDraftImageLoader();
