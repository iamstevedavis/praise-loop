import { useCallback, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../api";
import { Banner, Button } from "../ui/components";
import { colors } from "../ui/theme";
import { disableNotifications, enableNotifications } from "./controller";
import { shouldOfferNotifications, unavailableNote, type NotificationChoice } from "./model";
import { pushAvailability } from "./native";
import { notificationStore } from "./store";

// Shown once after the first signed-in launch. It explains why before the OS
// prompt, and "Not now" is remembered so the card does not nag.
export function NotificationOffer() {
  const [choice, setChoice] = useState<NotificationChoice | null | undefined>(undefined);
  const [availability] = useState(() => pushAvailability());
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-read on every focus: a choice made in Profile (or on another screen) must
  // remove the card without a relaunch.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    notificationStore
      .load()
      .then(value => {
        if (cancelled) return;
        setChoice(value);
        // Profile may have turned notifications on after the OS card was shown.
        if (value === "on") setDenied(false);
      })
      .catch(() => { if (!cancelled) setChoice(null); });
    return () => { cancelled = true; };
  }, []));

  if (choice === undefined || !availability.available) return null;
  const offer = shouldOfferNotifications({ choice, available: availability.available, signedIn: true });
  if (!offer && !denied) return null;

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await enableNotifications(api);
      if (result.status === "on") {
        setChoice("on");
        setDenied(false);
      } else if (result.status === "denied") {
        setChoice("off");
        setDenied(true);
      } else if (result.status === "unavailable") {
        setError(unavailableNote(result.reason));
      } else {
        setError("Couldn’t turn on notifications. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const notNow = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Not now is the same choice as the Profile switch: store "off" and
      // unregister any cached token, rather than only writing the preference.
      await disableNotifications(api);
      setChoice("off");
      setDenied(false);
    } catch {
      setError("Couldn’t save your choice. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (denied) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Notifications are off</Text>
        <Text style={styles.body}>
          Turn them on for PraiseLoop in your phone’s system settings to get the weekly reminder.
        </Text>
        {error ? <Banner message={error} tone="danger" /> : null}
        <View style={styles.actions}>
          <Button label="Open system settings" onPress={() => { void Linking.openSettings().catch(() => undefined); }} />
          <Button label="Not now" kind="secondary" disabled={busy} onPress={() => setDenied(false)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>We’ll tell you when your week of posts is ready</Text>
      <Text style={styles.body}>
        One notification a week, when there are new posts to review. You can turn it off later in Profile.
      </Text>
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.actions}>
        <Button label="Turn on notifications" onPress={() => { void turnOn(); }} loading={busy} />
        <Button label="Not now" kind="secondary" disabled={busy} onPress={() => { void notNow(); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    marginTop: 10,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line
  },
  title: { fontSize: 19, lineHeight: 25, fontWeight: "700", color: colors.ink },
  body: { fontSize: 14, lineHeight: 20, color: colors.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 }
});
