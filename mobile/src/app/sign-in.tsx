import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { api } from "../api";
import { fetchMobileConfig, type MobileConfig } from "../api/config";
import { useSession } from "../auth/SessionProvider";
import { appConfig } from "../config";
import { Banner, Button } from "../ui/components";
import { colors } from "../ui/theme";

export default function SignInScreen() {
  const { status, signInDemo } = useSession();
  const [config, setConfig] = useState<MobileConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMobileConfig(api)
      .then(value => { if (!cancelled) setConfig(value); })
      .catch(() => { if (!cancelled) setConfigError("Can’t reach the PraiseLoop server. Check that it is running and that the app points at your machine."); });
    return () => { cancelled = true; };
  }, []);

  const demo = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInDemo();
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo sign-in failed.");
    } finally {
      setBusy(false);
    }
  }, [signInDemo]);

  if (status === "signedIn") return <Redirect href="/" />;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>PraiseLoop</Text>
      <Text style={styles.title}>Your week of posts, ready to approve.</Text>
      <Text style={styles.body}>
        Review this week’s drafts, approve them and post from your phone. Setup and branding stay on
        the web app for now.
      </Text>

      {configError ? <Banner message={configError} tone="danger" /> : null}
      {error ? <Banner message={error} tone="danger" /> : null}
      {config === null && !configError ? <ActivityIndicator /> : null}

      {config?.devAuth ? (
        <View style={styles.actions}>
          <Banner message="Demo mode: this server signs in a synthetic owner with seeded posts. No Google account is involved." tone="warning" />
          <Button label="Sign in as demo owner" onPress={() => { void demo(); }} loading={busy} />
        </View>
      ) : config ? (
        <Banner message="Google sign-in arrives with the next app update. Set MOBILE_DEV_AUTH=1 on a development server to try the demo owner." />
      ) : null}

      {appConfig.variant !== "production" ? (
        <Text style={styles.small}>API: {appConfig.apiBaseUrl || "not configured"}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: "center", gap: 14, padding: 28, backgroundColor: colors.background },
  eyebrow: { fontSize: 13, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase", color: colors.muted },
  title: { fontSize: 34, lineHeight: 40, fontWeight: "700", color: colors.ink },
  body: { fontSize: 16, lineHeight: 23, color: colors.muted },
  actions: { gap: 12, marginTop: 8 },
  small: { fontSize: 12, color: colors.faint, marginTop: 12 }
});
