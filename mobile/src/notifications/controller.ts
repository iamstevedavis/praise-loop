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
  // A token whose unregister request failed. The server keeps sending to a registered token no
  // matter what this phone's preference says, so the DELETE is retried until it succeeds.
  loadPending: () => Promise<string | null>;
  savePending: (token: string) => Promise<void>;
  clearPending: () => Promise<void>;
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
  saveChoice: choice => notificationStore.save(choice),
  loadPending: () => notificationStore.loadPending(),
  savePending: token => notificationStore.savePending(token),
  clearPending: () => notificationStore.clearPending()
};

function resolveDeps(deps: Partial<PushDeps>): PushDeps {
  return { ...defaultPushDeps, ...deps };
}

// Retries an unregister that failed earlier. The DELETE is owner-scoped, and the phone may now be
// signed in as a different owner than the one that registered the token, so the token is first
// registered to the current owner (the server's POST moves a token to its caller) and then removed.
// Best effort: if it fails the token stays pending.
export async function retryPendingUnregister(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  const d = resolveDeps(deps);
  try {
    const pending = await d.loadPending();
    if (!pending) return;
    await registerPushToken(client, pending, d.platform());
    await unregisterPushToken(client, pending);
    await d.clearPending();
  } catch {
    // Still pending; the next launch or sign-out tries again.
  }
}

// Unregisters a token and remembers it if the request fails.
async function unregisterOrKeepPending(client: PushApi, d: PushDeps, token: string): Promise<void> {
  try {
    await unregisterPushToken(client, token);
  } catch {
    try { await d.savePending(token); } catch { /* nothing more to do */ }
  }
}

// Registration, the toggle and sign-out all touch the same server-side token, so they run one at a
// time: a launch refresh that is still waiting for the Expo token must not POST after a later
// "off" has already removed the device.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// Only an explicit "Turn on" reaches the OS prompt. A refusal is remembered so
// the app does not ask again on every launch.
async function enableNotificationsNow(client: PushApi, deps: Partial<PushDeps> = {}): Promise<EnableResult> {
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

export function enableNotifications(client: PushApi, deps: Partial<PushDeps> = {}): Promise<EnableResult> {
  return serialized(() => enableNotificationsNow(client, deps));
}

// Launch refresh: sign in, notifications are on, so re-send the current token.
// It never prompts; a revoked permission simply leaves the device unregistered.
async function refreshPushRegistrationNow(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  const d = resolveDeps(deps);
  await retryPendingUnregister(client, d);
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

export function refreshPushRegistration(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  return serialized(() => refreshPushRegistrationNow(client, deps));
}

// Turning the toggle off sticks even when the network or the OS call fails.
async function disableNotificationsNow(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  const d = resolveDeps(deps);
  await d.saveChoice("off");
  try {
    let token = d.cachedToken();
    if (!token) {
      const availability = d.availability();
      if (availability.available) token = await d.token(availability.projectId);
    }
    if (token) await unregisterOrKeepPending(client, d, token);
  } catch {
    // The local preference is already off.
  } finally {
    d.forgetToken();
  }
}

export function disableNotifications(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  return serialized(() => disableNotificationsNow(client, deps));
}

// Sign-out unregisters the device best-effort, like the session revoke. The
// preference itself is kept so the next sign-in can register again.
async function unregisterPushDeviceNow(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  const d = resolveDeps(deps);
  await retryPendingUnregister(client, d);
  try {
    // Notifications off (or never chosen) means there is nothing registered;
    // do not wake the OS just to ask for a token during sign-out.
    if (await d.loadChoice() !== "on") return;
    let token = d.cachedToken();
    if (!token) {
      const availability = d.availability();
      if (availability.available) token = await d.token(availability.projectId);
    }
    if (token) await unregisterOrKeepPending(client, d, token);
  } catch {
    // Sign-out clears the local session regardless.
  } finally {
    d.forgetToken();
  }
}

export function unregisterPushDevice(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  return serialized(() => unregisterPushDeviceNow(client, deps));
}
