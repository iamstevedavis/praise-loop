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
  plugins: ["expo-router"],
  experiments: {
    typedRoutes: true
  },
  extra: {
    apiBaseUrl,
    appVariant: variant
  }
});
