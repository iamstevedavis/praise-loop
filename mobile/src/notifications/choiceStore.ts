import type { SecureStorage } from "../auth/sessionStore";
import type { NotificationChoice } from "./model";

// Same keychain-backed storage as the session token; the preference is not a
// secret, but reusing the existing storage avoids another dependency.
export const NOTIFICATION_CHOICE_KEY = "praiseloop.mobile.notifications";
// A push token whose DELETE failed (for example while offline), kept so it can be retried.
export const PENDING_UNREGISTER_KEY = "praiseloop.mobile.notifications.pending";

export function createNotificationStore(storage: SecureStorage) {
  let cached: NotificationChoice | null | undefined;

  return {
    // undefined means "not read yet"; null means "no choice yet".
    async load(): Promise<NotificationChoice | null> {
      if (cached !== undefined) return cached;
      const stored = await storage.getItemAsync(NOTIFICATION_CHOICE_KEY);
      cached = stored === "on" || stored === "off" ? stored : null;
      return cached;
    },
    async save(choice: NotificationChoice): Promise<void> {
      await storage.setItemAsync(NOTIFICATION_CHOICE_KEY, choice);
      cached = choice;
    },
    async loadPending(): Promise<string | null> {
      return (await storage.getItemAsync(PENDING_UNREGISTER_KEY)) || null;
    },
    async savePending(token: string): Promise<void> {
      await storage.setItemAsync(PENDING_UNREGISTER_KEY, token);
    },
    async clearPending(): Promise<void> {
      await storage.deleteItemAsync(PENDING_UNREGISTER_KEY);
    },
    async clear(): Promise<void> {
      cached = null;
      await storage.deleteItemAsync(NOTIFICATION_CHOICE_KEY);
    }
  };
}

export type NotificationStore = ReturnType<typeof createNotificationStore>;
