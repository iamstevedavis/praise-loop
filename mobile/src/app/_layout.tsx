import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "../auth/SessionProvider";
import { NotificationRouter } from "../notifications/NotificationRouter";

export default function RootLayout() {
  return (
    <SessionProvider>
      <NotificationRouter />
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
