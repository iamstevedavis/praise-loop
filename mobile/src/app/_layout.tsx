import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../auth/SessionProvider";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
