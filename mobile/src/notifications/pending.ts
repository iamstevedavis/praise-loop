import type { NotificationTarget } from "./links";

// A notification opened before sign-in keeps its target in memory only. There
// is nothing to persist: if the app is killed, the owner can tap the
// notification again.
let pending: NotificationTarget | null = null;

export function holdNotificationTarget(target: NotificationTarget): void {
  pending = target;
}

export function takePendingNotificationTarget(): NotificationTarget | null {
  const target = pending;
  pending = null;
  return target;
}

export function clearPendingNotificationTarget(): void {
  pending = null;
}
