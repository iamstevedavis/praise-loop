import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: unknown; appVariant?: unknown } | undefined;

export const appConfig = {
  apiBaseUrl: typeof extra?.apiBaseUrl === "string" ? extra.apiBaseUrl : "",
  variant: typeof extra?.appVariant === "string" ? extra.appVariant : "development",
  version: Constants.expoConfig?.version ?? "1.0.0"
};
