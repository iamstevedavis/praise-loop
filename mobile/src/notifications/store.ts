import * as SecureStore from "expo-secure-store";
import { createNotificationStore } from "./choiceStore";

// The single preference store the app reads. Kept separate so pure modules and
// tests never import the native keychain.
export const notificationStore = createNotificationStore(SecureStore);
