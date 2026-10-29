import { File, Paths } from "expo-file-system";
import { ApiError } from "../api/client";
import { appConfig } from "../config";

export function absoluteMediaUrl(baseUrl: string, imagePath: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  return `${root}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`;
}

type DownloadOptions = {
  baseUrl?: string;
  token: string;
  draftId: number;
  imagePath: string;
};

// The media route is owner-protected, so the PNG is fetched with the bearer token
// into the app cache and handed to the share sheet as a local file. Nothing is
// made public for a provider to fetch.
export async function downloadDraftImage({ baseUrl = appConfig.apiBaseUrl, token, draftId, imagePath }: DownloadOptions): Promise<string> {
  const target = new File(Paths.cache, `praiseloop-draft-${draftId}.png`);
  try {
    const file = await File.downloadFileAsync(absoluteMediaUrl(baseUrl, imagePath), target, {
      headers: { authorization: `Bearer ${token}` },
      idempotent: true
    });
    return file.uri;
  } catch (error) {
    // expo-file-system reports a non-2xx as "HTTP 401" / "response has status:
    // 401". Surface an expired session as such so the app can return to sign-in
    // instead of suggesting the owner check their connection.
    if (/\b401\b/.test(error instanceof Error ? error.message : String(error))) {
      throw new ApiError("signedOut", 401);
    }
    throw error;
  }
}

export async function discardDraftImage(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A missing cache file is not worth surfacing.
  }
}
