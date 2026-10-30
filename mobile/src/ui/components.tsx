import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  kind?: "primary" | "secondary" | "danger";
};

export function Button({ label, onPress, disabled = false, loading = false, kind = "primary" }: ButtonProps) {
  const inert = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={onPress}
      style={[styles.button, kind === "primary" && styles.primary, kind === "secondary" && styles.secondary, kind === "danger" && styles.danger, inert && styles.inert]}
    >
      {loading ? <ActivityIndicator color={kind === "primary" ? "#ffffff" : colors.ink} /> : (
        <Text style={[styles.buttonText, kind === "primary" ? styles.primaryText : styles.secondaryText]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Chip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" | "danger" }) {
  return (
    <View style={[styles.chip, tone === "success" && styles.chipSuccess, tone === "warning" && styles.chipWarning, tone === "danger" && styles.chipDanger]}>
      <Text style={[styles.chipText, tone === "success" && styles.chipSuccessText, tone === "warning" && styles.chipWarningText, tone === "danger" && styles.chipDangerText]}>{label}</Text>
    </View>
  );
}

export function Banner({ message, tone = "info" }: { message: string; tone?: "info" | "success" | "warning" | "danger" }) {
  return (
    <View style={[styles.banner, tone === "success" && styles.bannerSuccess, tone === "warning" && styles.bannerWarning, tone === "danger" && styles.bannerDanger]}>
      <Text style={[styles.bannerText, tone === "success" && styles.bannerSuccessText, tone === "warning" && styles.bannerWarningText, tone === "danger" && styles.bannerDangerText]}>{message}</Text>
    </View>
  );
}

export function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

// The initials avatar that opens the profile screen. It carries no image: Google's
// picture is not stored yet, so initials are the deliberate placeholder.
export function Avatar({ initials, onPress, accessibilityLabel, size = "small" }: {
  initials: string;
  onPress: () => void;
  accessibilityLabel: string;
  size?: "small" | "large";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[styles.avatar, size === "large" && styles.avatarLarge]}
    >
      <Text style={[styles.avatarText, size === "large" && styles.avatarTextLarge]}>{initials}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 999, paddingHorizontal: 22, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  primary: { backgroundColor: colors.ink },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: colors.dangerSoft },
  inert: { opacity: 0.45 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  primaryText: { color: "#ffffff" },
  secondaryText: { color: colors.ink },
  chip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#eef1f3" },
  chipSuccess: { backgroundColor: colors.successSoft },
  chipWarning: { backgroundColor: colors.warningSoft },
  chipDanger: { backgroundColor: colors.dangerSoft },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 0.3 },
  chipSuccessText: { color: colors.success },
  chipWarningText: { color: colors.warning },
  chipDangerText: { color: colors.danger },
  banner: { borderRadius: 12, padding: 12, backgroundColor: "#eef1f3" },
  bannerSuccess: { backgroundColor: colors.successSoft },
  bannerWarning: { backgroundColor: colors.warningSoft },
  bannerDanger: { backgroundColor: colors.dangerSoft },
  bannerText: { fontSize: 14, lineHeight: 20, color: colors.ink },
  bannerSuccessText: { color: colors.success },
  bannerWarningText: { color: colors.warning },
  bannerDangerText: { color: colors.danger },
  section: { gap: 10, marginTop: 22 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: colors.ink },
  sectionHint: { fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: -4 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  avatarLarge: { width: 64, height: 64, borderRadius: 32 },
  avatarText: { fontSize: 15, fontWeight: "700", letterSpacing: 0.3, color: "#ffffff" },
  avatarTextLarge: { fontSize: 22 }
});
