export type NotificationChoice = "on" | "off";
export type NotificationPermission = "granted" | "denied" | "undetermined";

type PermissionLike = { granted?: boolean; status?: string } | null | undefined;

// Expo reports both a boolean and a status; provisional iOS permission counts as
// granted, and an unknown answer is still "not asked yet".
export function permissionFromStatus(status: PermissionLike): NotificationPermission {
  if (!status) return "undetermined";
  if (status.granted === true) return "granted";
  return status.status === "undetermined" ? "undetermined" : "denied";
}

export function shouldOfferNotifications(input: {
  choice: NotificationChoice | null;
  available: boolean;
  signedIn: boolean;
}): boolean {
  return input.signedIn && input.available && input.choice === null;
}

export type PushUnavailableReason = "native-module" | "expo-go" | "simulator" | "platform" | "project-id";

export type PushAvailability =
  | { available: true; projectId: string }
  | { available: false; reason: PushUnavailableReason };

// Push needs native code, a development or store build on a real device, and an
// EAS project id so Expo can attribute the token. Expo Go and simulators can run
// the app but cannot get a push token.
export function resolvePushAvailability(input: {
  module: unknown;
  isDevice: boolean;
  platform: string;
  projectId: string | null;
  expoGo: boolean;
}): PushAvailability {
  if (!input.module) return { available: false, reason: "native-module" };
  if (input.expoGo) return { available: false, reason: "expo-go" };
  if (input.platform !== "ios" && input.platform !== "android") return { available: false, reason: "platform" };
  if (!input.isDevice) return { available: false, reason: "simulator" };
  if (!input.projectId) return { available: false, reason: "project-id" };
  return { available: true, projectId: input.projectId };
}

export type ConstantsLike = {
  expoConfig?: { extra?: unknown } | null;
  easConfig?: { projectId?: unknown } | null;
  appOwnership?: string | null;
  expoGoConfig?: unknown;
};

// The id is written by `eas init` / EAS Build, or supplied through an update
// manifest's easConfig. There is deliberately no fallback: a build without it
// cannot register a token with Expo.
export function readProjectId(constants: ConstantsLike): string | null {
  const extra = constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const fromExtra = extra?.eas?.projectId;
  const fromEas = constants.easConfig?.projectId;
  const value = typeof fromExtra === "string" && fromExtra.trim().length > 0
    ? fromExtra
    : typeof fromEas === "string" && fromEas.trim().length > 0
      ? fromEas
      : null;
  return value?.trim() ?? null;
}

// appOwnership is deprecated but still the reliable marker inside Expo Go;
// expoGoConfig is also only present there.
export function isExpoGo(constants: ConstantsLike): boolean {
  return constants.appOwnership === "expo" || constants.expoGoConfig != null;
}

export function unavailableNote(reason: PushUnavailableReason): string {
  switch (reason) {
    case "native-module":
      return "Notifications need a development or store build; this build does not include them.";
    case "expo-go":
      return "Notifications need a development or store build on a real phone. Expo Go cannot receive pushes.";
    case "simulator":
      return "Notifications need a real phone; simulators cannot receive push notifications.";
    case "platform":
      return "Notifications are available on iOS and Android only.";
    case "project-id":
      return "Notifications are not configured for this build yet: it has no EAS project ID.";
  }
}
