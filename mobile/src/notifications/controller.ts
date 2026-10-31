import type { NotificationChoice, NotificationPermission, PushAvailability, PushUnavailableReason } from "./model";
import {
  cachedPushToken,
  currentPlatform,
  expoPushToken,
  forgetPushToken,
  permissionStatus,
  pushAvailability,
  requestPermission
} from "./native";
import { registerPushToken, unregisterPushToken, type PushApi, type PushPlatform } from "./registration";
import { notificationStore } from "./store";

export type EnableResult =
  | { status: "on" }
  | { status: "denied" }
  | { status: "unavailable"; reason: PushUnavailableReason }
  | { status: "failed" };

// Injectable so tests can describe the OS and the keychain without a device.
export type PushDeps = {
  availability: () => PushAvailability;
  permission: () => Promise<NotificationPermission>;
  requestPermission: () => Promise<NotificationPermission>;
  token: (projectId: string) => Promise<string>;
  cachedToken: () => string | null;
  forgetToken: () => void;
  platform: () => PushPlatform;
  loadChoice: () => Promise<NotificationChoice | null>;
  saveChoice: (choice: NotificationChoice) => Promise<void>;
};

export const defaultPushDeps: PushDeps = {
  availability: pushAvailability,
  permission: permissionStatus,
  requestPermission,
  token: expoPushToken,
  cachedToken: cachedPushToken,
  forgetToken: forgetPushToken,
  platform: currentPlatform,
  loadChoice: () => notificationStore.load(),
  saveChoice: choice => notificationStore.save(choice)
};

function resolveDeps(deps: Partial<PushDeps>): PushDeps {
  return { ...defaultPushDeps, ...deps };
}

// Only an explicit "Turn on" reaches the OS prompt. A refusal is remembered so
// the app does not ask again on every launch.
export async function enableNotifications(client: PushApi, deps: Partial<PushDeps> = {}): Promise<EnableResult> {
  const d = resolveDeps(deps);
  const availability = d.availability();
  if (!availability.available) return { status: "unavailable", reason: availability.reason };

  try {
    let permission = await d.permission();
    if (permission !== "granted") permission = await d.requestPermission();
    if (permission !== "granted") {
      await d.saveChoice("off");
      return { status: "denied" };
    }
    const token = await d.token(availability.projectId);
    await registerPushToken(client, token, d.platform());
    await d.saveChoice("on");
    return { status: "on" };
  } catch {
    return { status: "failed" };
  }
}

// Launch refresh: sign in, notifications are on, so re-send the current token.
// It never prompts; a revoked permission simply leaves the device unregistered.
export async function refreshPushRegistration(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  const d = resolveDeps(deps);
  try {
    if (await d.loadChoice() !== "on") return;
    const availability = d.availability();
    if (!availability.available) return;
    if (await d.permission() !== "granted") return;
    const token = await d.token(availability.projectId);
    await registerPushToken(client, token, d.platform());
  } catch {
    // Best effort: a failed refresh must not block the queue.
  }
}

// Turning the toggle off sticks even when the network or the OS call fails.
export async function disableNotifications(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  const d = resolveDeps(deps);
  await d.saveChoice("off");
  try {
    let token = d.cachedToken();
    if (!token) {
      const availability = d.availability();
      if (availability.available) token = await d.token(availability.projectId);
    }
    if (token) await unregisterPushToken(client, token);
  } catch {
    // The local preference is already off.
  } finally {
    d.forgetToken();
  }
}

// Sign-out unregisters the device best-effort, like the session revoke. The
// preference itself is kept so the next sign-in can register again.
export async function unregisterPushDevice(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  const d = resolveDeps(deps);
  try {
    // Notifications off (or never chosen) means there is nothing registered;
    // do not wake the OS just to ask for a token during sign-out.
    if (await d.loadChoice() !== "on") return;
    let token = d.cachedToken();
    if (!token) {
      const availability = d.availability();
      if (availability.available) token = await d.token(availability.projectId);
    }
    if (token) await unregisterPushToken(client, token);
  } catch {
    // Sign-out clears the local session regardless.
  } finally {
    d.forgetToken();
  }
}
