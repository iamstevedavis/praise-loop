import type { ApiClient } from "../api/client";

export type PushPlatform = "ios" | "android";
export type PushApi = Pick<ApiClient, "request">;

// Mirrors the server's PUSH_TOKEN_PATTERN in lib/services/push.ts.
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;

export type RegistrationBody = { token: string; platform: PushPlatform };

export function buildRegistrationBody(token: unknown, platform: unknown): RegistrationBody {
  if (typeof token !== "string" || !EXPO_PUSH_TOKEN_PATTERN.test(token)) {
    throw new Error("A valid Expo push token is required.");
  }
  if (platform !== "ios" && platform !== "android") {
    throw new Error("The device platform must be iOS or Android.");
  }
  return { token, platform };
}

export function buildUnregistrationBody(token: unknown): { token: string } {
  if (typeof token !== "string" || !EXPO_PUSH_TOKEN_PATTERN.test(token)) {
    throw new Error("A valid Expo push token is required.");
  }
  return { token };
}

export async function registerPushToken(client: PushApi, token: unknown, platform: unknown): Promise<void> {
  await client.request("/api/mobile/push-tokens", { method: "POST", body: buildRegistrationBody(token, platform) });
}

export async function unregisterPushToken(client: PushApi, token: unknown): Promise<void> {
  await client.request("/api/mobile/push-tokens", { method: "DELETE", body: buildUnregistrationBody(token) });
}
