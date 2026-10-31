import { useEffect, useState } from "react";
import { Linking, StyleSheet, Switch, Text, View } from "react-native";
import { api } from "../api";
import { Banner, Button, Section } from "../ui/components";
import { colors } from "../ui/theme";
import { disableNotifications, enableNotifications } from "./controller";
import { unavailableNote, type NotificationChoice } from "./model";
import { pushAvailability } from "./native";
import { notificationStore } from "./store";

// The profile setting. Turning it off unregisters this device; turning it on is
// the only place besides the first-launch card that asks the OS.
export function NotificationSettings() {
  const [choice, setChoice] = useState<NotificationChoice | null | undefined>(undefined);
  const [availability] = useState(() => pushAvailability());
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    notificationStore
      .load()
      .then(value => { if (!cancelled) setChoice(value); })
      .catch(() => { if (!cancelled) setChoice(null); });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setProblem(null);
    setDenied(false);
    try {
      if (!next) {
        await disableNotifications(api);
        setChoice("off");
        setNotice("Notifications are off. This device is no longer registered.");
        return;
      }

      const result = await enableNotifications(api);
      if (result.status === "on") {
        setChoice("on");
        setNotice("Notifications are on.");
      } else if (result.status === "denied") {
        setChoice("off");
        setDenied(true);
        setProblem("Notifications are off in your phone’s system settings. Turn them on for PraiseLoop to get the weekly reminder.");
      } else if (result.status === "unavailable") {
        setProblem(unavailableNote(result.reason));
      } else {
        setProblem("Couldn’t turn on notifications. Try again.");
      }
    } catch {
      setProblem("Couldn’t update notifications. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Notifications">
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.label}>New posts ready to review</Text>
          <Text style={styles.body}>We’ll tell you when your week of posts is ready.</Text>
        </View>
        <Switch
          accessibilityLabel="Posts ready notifications"
          value={choice === "on"}
          onValueChange={value => { void toggle(value); }}
          disabled={busy || !availability.available}
        />
      </View>
      {!availability.available ? <Text style={styles.hint}>{unavailableNote(availability.reason)}</Text> : null}
      {notice ? <Banner message={notice} tone="success" /> : null}
      {problem ? <Banner message={problem} tone={denied ? "warning" : "danger"} /> : null}
      {denied ? (
        <Button
          label="Open system settings"
          kind="secondary"
          onPress={() => { void Linking.openSettings().catch(() => undefined); }}
        />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: "600", color: colors.ink },
  body: { fontSize: 13, lineHeight: 18, color: colors.muted },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted }
});
