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

// A pending entry is either a real token whose DELETE failed, or this marker:
// the device wanted to unregister but had no token (a relaunch clears the
// in-memory cache), so the next launch or sign-out has to obtain one first.
export const PENDING_UNREGISTER_ANY_TOKEN = "*";

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

async function rememberPending(d: PushDeps, pending: string): Promise<void> {
  try { await d.savePending(pending); } catch { /* nothing more to do */ }
}

// The marker has no token of its own, so it needs the same lookup the toggle uses.
async function pendingToken(d: PushDeps, pending: string): Promise<string | null> {
  if (pending !== PENDING_UNREGISTER_ANY_TOKEN) return pending;
  const cached = d.cachedToken();
  if (cached) return cached;
  const availability = d.availability();
  if (!availability.available) return null;
  return d.token(availability.projectId);
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
    const token = await pendingToken(d, pending);
    // Still no token: keep the marker for the next launch or sign-out.
    if (!token) return;
    await registerPushToken(client, token, d.platform());
    await unregisterPushToken(client, token);
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
    await rememberPending(d, token);
  }
}

// Unregisters whatever token belongs to this device. A relaunch clears the in-memory
// token, so when the OS cannot produce one the marker keeps the cleanup pending
// instead of leaving the server registration active forever.
async function unregisterCurrentDevice(client: PushApi, d: PushDeps): Promise<void> {
  let token: string | null = null;
  try {
    token = d.cachedToken();
    if (!token) {
      const availability = d.availability();
      if (availability.available) token = await d.token(availability.projectId);
    }
  } catch {
    token = null;
  }
  if (token) await unregisterOrKeepPending(client, d, token);
  else await rememberPending(d, PENDING_UNREGISTER_ANY_TOKEN);
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
    try {
      await registerPushToken(client, token, d.platform());
      await d.saveChoice("on");
    } catch (error) {
      // The POST may have reached the server even though the answer was lost (or saving the choice
      // failed afterwards). Remember the token so the next launch or sign-out removes the
      // registration instead of leaving the device receiving notifications the owner never saw
      // switch on.
      await rememberPending(d, token);
      throw error;
    }
    // Enabled for good: any earlier pending cleanup of this device no longer applies.
    await d.clearPending().catch(() => undefined);
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
  // Only a device that may be registered needs cleaning up: "Not now" on a first-time offer never
  // registered anything, and must not leave a pending marker behind.
  const mayBeRegistered = d.cachedToken() !== null || await d.loadChoice().then(choice => choice === "on", () => false);
  await d.saveChoice("off");
  if (!mayBeRegistered) {
    d.forgetToken();
    return;
  }
  try {
    await unregisterCurrentDevice(client, d);
  } catch {
    // The local preference is already off, but the server may still hold this
    // device; retry once a token can be obtained.
    await rememberPending(d, PENDING_UNREGISTER_ANY_TOKEN);
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
    await unregisterCurrentDevice(client, d);
  } catch {
    // Sign-out clears the local session regardless.
  } finally {
    d.forgetToken();
  }
}

export function unregisterPushDevice(client: PushApi, deps: Partial<PushDeps> = {}): Promise<void> {
  return serialized(() => unregisterPushDeviceNow(client, deps));
}
