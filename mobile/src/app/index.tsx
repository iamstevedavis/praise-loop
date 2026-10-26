import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { api } from "../api";
import { fetchMobileConfig, updateRequiredFor } from "../api/config";
import { appConfig } from "../config";

type State =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "update" }
  | { status: "error"; message: string };

export default function HomeScreen() {
  const [state, setState] = useState<State>({ status: "loading" });

  const check = useCallback(async () => {
    try {
      const config = await fetchMobileConfig(api);
      setState(updateRequiredFor(config, appConfig.version) ? { status: "update" } : { status: "ready" });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Something went wrong." });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMobileConfig(api)
      .then(config => {
        if (!cancelled) setState(updateRequiredFor(config, appConfig.version) ? { status: "update" } : { status: "ready" });
      })
      .catch(error => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Something went wrong." });
      });
    return () => { cancelled = true; };
  }, []);

  if (state.status === "update") return <Redirect href="/update" />;
  if (state.status === "loading") {
    return (
      <View style={styles.screen}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Checking your app…</Text>
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Can’t open PraiseLoop yet</Text>
        <Text style={styles.muted}>{state.message}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => { setState({ status: "loading" }); void check(); }}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>PraiseLoop</Text>
      <Text style={styles.title}>Your weekly posts will appear here.</Text>
      <Text style={styles.muted}>
        Sign-in and the approval queue arrive in the next updates. Set up your business on the web for now.
      </Text>
      <Text style={styles.small}>Build: {appConfig.variant}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 28, backgroundColor: "#f7f5f0" },
  eyebrow: { fontSize: 13, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase", color: "#5b6b7a" },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center", color: "#12283a" },
  muted: { fontSize: 16, lineHeight: 23, textAlign: "center", color: "#52616d" },
  small: { fontSize: 12, color: "#8a969f", marginTop: 8 },
  button: { marginTop: 8, backgroundColor: "#12283a", borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" }
});
