import { File, Paths } from "expo-file-system";
import { appConfig } from "../config";
import { absoluteMediaUrl, mapImageDownloadError } from "../media/draftImage";

export { absoluteMediaUrl } from "../media/draftImage";

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
  // Share keeps its own filename so discarding it after the share sheet closes
  // cannot remove the file the queue and draft screen are showing.
  const target = new File(Paths.cache, `praiseloop-draft-${draftId}.png`);
  try {
    const file = await File.downloadFileAsync(absoluteMediaUrl(baseUrl, imagePath), target, {
      headers: { authorization: `Bearer ${token}` },
      idempotent: true
    });
    return file.uri;
  } catch (error) {
    throw mapImageDownloadError(error);
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
