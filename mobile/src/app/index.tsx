import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { api } from "../api";
import { fetchMobileConfig, updateRequiredFor } from "../api/config";
import { useSession } from "../auth/SessionProvider";
import { appConfig } from "../config";

type Gate = { status: "loading" } | { status: "ready" } | { status: "update" } | { status: "error"; message: string };

// Launch gate: the version check comes first, then the session decides whether
// the owner lands on sign-in or the signed-in confirmation.
export default function HomeScreen() {
  const { status } = useSession();
  const [gate, setGate] = useState<Gate>({ status: "loading" });

  const check = useCallback(async () => {
    setGate({ status: "loading" });
    try {
      const config = await fetchMobileConfig(api);
      setGate(updateRequiredFor(config, appConfig.version) ? { status: "update" } : { status: "ready" });
    } catch (error) {
      setGate({ status: "error", message: error instanceof Error ? error.message : "Something went wrong." });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMobileConfig(api)
      .then(config => {
        if (!cancelled) setGate(updateRequiredFor(config, appConfig.version) ? { status: "update" } : { status: "ready" });
      })
      .catch(error => {
        if (!cancelled) setGate({ status: "error", message: error instanceof Error ? error.message : "Something went wrong." });
      });
    return () => { cancelled = true; };
  }, []);

  if (gate.status === "update") return <Redirect href="/update" />;

  if (gate.status === "error") {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Can’t open PraiseLoop yet</Text>
        <Text style={styles.muted}>{gate.message}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => { void check(); }}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (gate.status === "loading" || status === "loading") {
    return (
      <View style={styles.screen}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Checking your app…</Text>
      </View>
    );
  }

  if (status === "signedOut") return <Redirect href="/sign-in" />;

  // The queue screen lands with #86; until then this confirms the session works.
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>You’re signed in</Text>
      <Text style={styles.muted}>The weekly queue arrives with the next update.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 28, backgroundColor: "#f7f5f0" },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: "#12283a" },
  muted: { fontSize: 16, lineHeight: 23, textAlign: "center", color: "#52616d" },
  button: { marginTop: 8, backgroundColor: "#12283a", borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" }
});
