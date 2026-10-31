import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { api } from "../api";
import { useSession } from "../auth/SessionProvider";
import { refreshPushRegistration } from "./controller";
import { notificationTargetFromResponse, planNotificationRoute } from "./links";
import { loadNotifications } from "./native";
import { holdNotificationTarget, takePendingNotificationTarget } from "./pending";
import { notificationStore } from "./store";

// Lives inside SessionProvider. It listens for a tapped notification, remembers
// a target that arrives before sign-in, and refreshes the device token on every
// signed-in launch when the owner has notifications on.
export function NotificationRouter() {
  const { status } = useSession();
  const router = useRouter();
  const signedInRef = useRef(status === "signedIn");

  useEffect(() => {
    signedInRef.current = status === "signedIn";
  }, [status]);

  useEffect(() => {
    const native = loadNotifications();
    if (!native) return;

    try {
      native.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false
        })
      });
    } catch {
      // A handler is optional; the notification still opens the app.
    }

    const handle = (response: unknown) => {
      const action = planNotificationRoute(notificationTargetFromResponse(response), signedInRef.current);
      if (action.kind === "navigate") router.push(action.href);
      else if (action.kind === "hold") holdNotificationTarget(action.target);
    };

    const subscription = native.addNotificationResponseReceivedListener(handle);
    // A cold start may deliver the tap before the listener exists. Check once;
    // later taps arrive through the listener.
    try {
      const last = native.getLastNotificationResponse();
      if (last) {
        handle(last);
        native.clearLastNotificationResponse();
      }
    } catch {
      // Nothing to route if the native module cannot report a response.
    }

    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (status !== "signedIn") return;
    let cancelled = false;
    void (async () => {
      const pending = takePendingNotificationTarget();
      const action = planNotificationRoute(pending, true);
      if (!cancelled && action.kind === "navigate") router.push(action.href);

      const choice = await notificationStore.load().catch(() => null);
      if (!cancelled && choice === "on") await refreshPushRegistration(api);
    })();
    return () => { cancelled = true; };
  }, [router, status]);

  return null;
}

