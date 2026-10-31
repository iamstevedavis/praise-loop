import type { PhotoPermission } from "../posting/saveToPhotosFlow";

type MediaLibraryModule = typeof import("expo-media-library");

// The native module is required lazily: Expo Go and Jest do not ship it, and the
// app must still start there. Save to Photos reports that it is unavailable
// instead of breaking the screen.
function loadNativeModule(): MediaLibraryModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-media-library") as MediaLibraryModule;
  } catch {
    return null;
  }
}

export const photoLibrary = {
  // writeOnly keeps the ask to "add photos": PraiseLoop never reads the library.
  async requestPermission(): Promise<PhotoPermission> {
    const module = loadNativeModule();
    if (!module) return "unavailable";
    try {
      const response = await module.requestPermissionsAsync(true);
      return response.granted ? "granted" : "denied";
    } catch {
      // A missing native module, or a permission API that cannot answer, is not
      // something the owner can fix in Settings.
      return "unavailable";
    }
  },

  async saveImage(uri: string): Promise<void> {
    const module = loadNativeModule();
    if (!module) throw new Error("Saving to Photos is not available in this build.");
    // SDK 58 replaced saveToLibraryAsync in the main entry point with Asset.create.
    await module.Asset.create(uri);
  }
};
