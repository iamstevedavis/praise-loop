import { File, Paths } from "expo-file-system";
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
  const file = await File.downloadFileAsync(absoluteMediaUrl(baseUrl, imagePath), target, {
    headers: { authorization: `Bearer ${token}` },
    idempotent: true
  });
  return file.uri;
}

export async function discardDraftImage(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A missing cache file is not worth surfacing.
  }
}
