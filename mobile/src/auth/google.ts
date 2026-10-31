import { Platform } from "react-native";
import { appConfig } from "../config";

// The native module is required lazily: Expo Go does not ship it, and the app
// must still start there. The Google button is hidden when the module is absent.
type GoogleSignInModule = typeof import("@react-native-google-signin/google-signin");

export class GoogleSignInCancelledError extends Error {
  constructor() {
    super("Google sign-in was cancelled.");
    this.name = "GoogleSignInCancelledError";
  }
}

export function isGoogleSignInCancelled(error: unknown): boolean {
  return error instanceof GoogleSignInCancelledError;
}

function loadNativeModule(): GoogleSignInModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-google-signin/google-signin") as GoogleSignInModule;
  } catch {
    return null;
  }
}

// The arguments are injectable for tests; normal callers use the native module and the
// build's configuration. Android needs only the web client; iOS also needs its own client id
// (there is no GoogleService-Info.plist fallback here), so the button stays hidden without it.
export function googleSignInAvailable(
  module: GoogleSignInModule | null = loadNativeModule(),
  webClientId: string = appConfig.googleWebClientId,
  iosClientId: string = appConfig.googleIosClientId,
  platform: string = Platform.OS
): boolean {
  if (module === null || webClientId.length === 0) return false;
  return platform !== "ios" || iosClientId.length > 0;
}

function cancelledByUser(error: unknown, module: GoogleSignInModule): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === module.statusCodes.SIGN_IN_CANCELLED;
}

export async function signInWithGoogle(): Promise<string> {
  const native = loadNativeModule();
  if (!native || !googleSignInAvailable(native)) {
    throw new Error("Google sign-in is not available in this build.");
  }

  native.GoogleSignin.configure({
    webClientId: appConfig.googleWebClientId,
    ...(appConfig.googleIosClientId ? { iosClientId: appConfig.googleIosClientId } : {})
  });

  try {
    if (Platform.OS === "android") {
      await native.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await native.GoogleSignin.signIn();
    if (response.type === "cancelled") throw new GoogleSignInCancelledError();
    const idToken = response.data?.idToken;
    if (typeof idToken !== "string" || idToken.length === 0) {
      throw new Error("Google did not return a sign-in token.");
    }
    return idToken;
  } catch (error) {
    if (cancelledByUser(error, native)) throw new GoogleSignInCancelledError();
    throw error;
  }
}
