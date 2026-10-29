import type { ApiClient } from "./client";

export type MobileConfig = {
  minimumVersion: string;
  latestVersion: string;
  features: string[];
  // True only on a development server with MOBILE_DEV_AUTH=1; drives the demo
  // sign-in button. Absent on older servers.
  devAuth?: boolean;
};

const VERSION = /^\d+\.\d+\.\d+$/;

export function compareVersions(left: string, right: string): number {
  if (!VERSION.test(left) || !VERSION.test(right)) return 0;
  const a = left.split(".").map(Number), b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// An invalid current version or minimum never blocks the app; a valid installed
// version below the configured minimum must update.
export function isUpdateRequired(currentVersion: string, minimumVersion: string): boolean {
  return compareVersions(currentVersion, minimumVersion) < 0;
}

function isConfig(value: unknown): value is MobileConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return typeof config.minimumVersion === "string"
    && typeof config.latestVersion === "string"
    && Array.isArray(config.features)
    && config.features.every(feature => typeof feature === "string")
    && (config.devAuth === undefined || typeof config.devAuth === "boolean");
}

export async function fetchMobileConfig(client: ApiClient): Promise<MobileConfig> {
  const config = await client.request<unknown>("/api/mobile/config");
  if (!isConfig(config)) throw new Error("The server returned an invalid mobile config.");
  return config;
}

export function updateRequiredFor(config: MobileConfig, currentVersion: string): boolean {
  return isUpdateRequired(currentVersion, config.minimumVersion);
}
