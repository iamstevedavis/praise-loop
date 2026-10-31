import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  isExpoGo,
  permissionFromStatus,
  readProjectId,
  resolvePushAvailability,
  type ConstantsLike,
  type NotificationPermission,
  type PushAvailability
} from "./model";
import type { PushPlatform } from "./registration";

type NotificationsModule = typeof import("expo-notifications");
type DeviceModule = typeof import("expo-device");

let cachedToken: string | null = null;

// The native modules are required lazily: Expo Go and Jest can run the app
// without them, and push is simply unavailable there.
export function loadNotifications(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as NotificationsModule;
  } catch {
    return null;
  }
}

function loadDevice(): DeviceModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-device") as DeviceModule;
  } catch {
    return null;
  }
}

export function pushAvailability(): PushAvailability {
  const constants = Constants as unknown as ConstantsLike;
  return resolvePushAvailability({
    module: loadNotifications(),
    isDevice: loadDevice()?.isDevice === true,
    platform: Platform.OS,
    projectId: readProjectId(constants),
    expoGo: isExpoGo(constants)
  });
}

export async function permissionStatus(): Promise<NotificationPermission> {
  const module = loadNotifications();
  if (!module) return "undetermined";
  return permissionFromStatus(await module.getPermissionsAsync());
}

export async function requestPermission(): Promise<NotificationPermission> {
  const module = loadNotifications();
  if (!module) return "denied";
  return permissionFromStatus(await module.requestPermissionsAsync());
}

export async function expoPushToken(projectId: string): Promise<string> {
  const module = loadNotifications();
  if (!module) throw new Error("Notifications are not available in this build.");
  const token = await module.getExpoPushTokenAsync({ projectId });
  if (typeof token.data !== "string" || token.data.length === 0) {
    throw new Error("Expo did not return a push token.");
  }
  cachedToken = token.data;
  return token.data;
}

export function cachedPushToken(): string | null {
  return cachedToken;
}

export function forgetPushToken(): void {
  cachedToken = null;
}

export function currentPlatform(): PushPlatform {
  if (Platform.OS === "ios" || Platform.OS === "android") return Platform.OS;
  throw new Error("Push notifications are only supported on iOS and Android.");
}
