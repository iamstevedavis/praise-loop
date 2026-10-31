import type { ConfigContext, ExpoConfig } from "expo/config";

// APP_VARIANT=development|preview|production. EAS supplies EXPO_PUBLIC_API_BASE_URL
// per environment; development falls back to the local Next server. The app never
// ships provider secrets — it only talks to our API.
const variants = ["development", "preview", "production"] as const;
type Variant = (typeof variants)[number];

const variant: Variant = variants.includes(process.env.APP_VARIANT as Variant)
  ? (process.env.APP_VARIANT as Variant)
  : "development";

const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (variant === "development" ? "http://localhost:3000" : "");

// Native Google Sign-In. The web client ID is the OAuth client the server already
// trusts; the iOS client ID and URL scheme come from issue #78. Empty values keep
// the Google button hidden instead of failing at runtime.
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? "";

// The plugin needs the URL scheme at prebuild, so only add it when it is set;
// otherwise `expo start` and `expo config` still work without Google setup.
const googlePlugins: NonNullable<ExpoConfig["plugins"]> = googleIosUrlScheme
  ? [["@react-native-google-signin/google-signin", { iosUrlScheme: googleIosUrlScheme }]]
  : [];

// Bundle ID / package name must be confirmed by the owner before store setup (#91).
const bundleIdentifier = "ca.visda.praiseloop";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant === "production" ? "PraiseLoop" : `PraiseLoop (${variant})`,
  slug: "praiseloop",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "praiseloop",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier,
    supportsTablet: false
  },
  android: {
    package: bundleIdentifier,
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#123456"
    }
  },
  plugins: ["expo-router", ...googlePlugins],
  experiments: {
    typedRoutes: true
  },
  extra: {
    apiBaseUrl,
    googleWebClientId,
    googleIosClientId,
    appVariant: variant
  }
});
