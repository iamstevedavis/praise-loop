import { Platform } from "react-native";

// The native module is required lazily: Expo Go and Android do not ship it, and
// the app must still start there. The Apple button is hidden when it is absent.
type AppleAuthenticationModule = typeof import("expo-apple-authentication");

type AppleFullName = {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  namePrefix?: string | null;
  nameSuffix?: string | null;
  nickname?: string | null;
};

export class AppleSignInCancelledError extends Error {
  constructor() {
    super("Apple sign-in was cancelled.");
    this.name = "AppleSignInCancelledError";
  }
}

export function isAppleSignInCancelled(error: unknown): boolean {
  return error instanceof AppleSignInCancelledError;
}

function loadNativeModule(): AppleAuthenticationModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-apple-authentication") as AppleAuthenticationModule;
  } catch {
    return null;
  }
}

// iOS 13+ only, and only when the native module is compiled in. The arguments
// are injectable for tests.
export async function appleSignInAvailable(
  module: AppleAuthenticationModule | null = loadNativeModule(),
  platform: string = Platform.OS
): Promise<boolean> {
  if (module === null || platform !== "ios") return false;
  try {
    return await module.isAvailableAsync();
  } catch {
    return false;
  }
}

function fullNameString(fullName: AppleFullName | null): string | null {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
    .map(part => part?.trim())
    .filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" ") : null;
}

export type AppleSignInResult = { identityToken: string; fullName: string | null };

function cancelledByUser(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "ERR_REQUEST_CANCELED";
}

export async function signInWithApple(
  module: AppleAuthenticationModule | null = loadNativeModule(),
  platform: string = Platform.OS
): Promise<AppleSignInResult> {
  if (!(await appleSignInAvailable(module, platform)) || module === null) {
    throw new Error("Apple sign-in is not available in this build.");
  }

  try {
    const credential = await module.signInAsync({
      requestedScopes: [
        module.AppleAuthenticationScope.FULL_NAME,
        module.AppleAuthenticationScope.EMAIL
      ]
    });
    const identityToken = credential.identityToken;
    if (typeof identityToken !== "string" || identityToken.length === 0) {
      throw new Error("Apple did not return a sign-in token.");
    }
    return { identityToken, fullName: fullNameString(credential.fullName as AppleFullName | null) };
  } catch (error) {
    if (cancelledByUser(error)) throw new AppleSignInCancelledError();
    throw error;
  }
}
