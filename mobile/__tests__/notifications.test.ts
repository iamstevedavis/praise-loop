import { createNotificationStore, NOTIFICATION_CHOICE_KEY } from "../src/notifications/choiceStore";
import {
  disableNotifications,
  enableNotifications,
  PENDING_UNREGISTER_ANY_TOKEN,
  refreshPushRegistration,
  unregisterPushDevice,
  type PushDeps
} from "../src/notifications/controller";
import {
  parseBusinessId,
  parseDeepLink,
  parseNotificationData,
  notificationTargetFromResponse,
  planNotificationRoute,
  queueHref
} from "../src/notifications/links";
import { permissionFromStatus, readProjectId, resolvePushAvailability, shouldOfferNotifications, unavailableNote } from "../src/notifications/model";
import { clearPendingNotificationTarget, holdNotificationTarget, takePendingNotificationTarget } from "../src/notifications/pending";
import {
  buildRegistrationBody,
  buildUnregistrationBody,
  registerPushToken,
  unregisterPushToken,
  type PushApi
} from "../src/notifications/registration";
import type { SecureStorage } from "../src/auth/sessionStore";

const TOKEN = "ExponentPushToken[abcdefgh1234]";
const OTHER_TOKEN = "ExpoPushToken[zyxwvu9876]";

function apiMock() {
  const request = jest.fn().mockResolvedValue({});
  return { client: { request } as unknown as PushApi, request };
}

function deps(overrides: Partial<PushDeps> = {}): PushDeps {
  return {
    availability: () => ({ available: true, projectId: "project-1" }),
    permission: async () => "undetermined",
    requestPermission: async () => "granted",
    token: async () => TOKEN,
    cachedToken: () => null,
    forgetToken: jest.fn(),
    platform: () => "ios",
    loadChoice: async () => "on",
    saveChoice: jest.fn().mockResolvedValue(undefined),
    loadPending: async () => null,
    savePending: jest.fn().mockResolvedValue(undefined),
    clearPending: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage: SecureStorage = {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); }
  };
  return { storage, values };
}

describe("notification permission model", () => {
  it("reads granted, denied and not-asked from Expo's permission response", () => {
    expect(permissionFromStatus({ granted: true, status: "granted" })).toBe("granted");
    expect(permissionFromStatus({ granted: false, status: "denied" })).toBe("denied");
    expect(permissionFromStatus({ granted: false, status: "undetermined" })).toBe("undetermined");
    expect(permissionFromStatus(null)).toBe("undetermined");
  });

  it("offers the explanation only once, after sign-in, when push is available", () => {
    expect(shouldOfferNotifications({ choice: null, available: true, signedIn: true })).toBe(true);
    expect(shouldOfferNotifications({ choice: "on", available: true, signedIn: true })).toBe(false);
    expect(shouldOfferNotifications({ choice: "off", available: true, signedIn: true })).toBe(false);
    expect(shouldOfferNotifications({ choice: null, available: false, signedIn: true })).toBe(false);
    expect(shouldOfferNotifications({ choice: null, available: true, signedIn: false })).toBe(false);
  });

  it("hides the offer once a focus re-read sees a choice made in Profile", () => {
    // The queue card re-reads the stored choice on every focus.
    expect(shouldOfferNotifications({ choice: null, available: true, signedIn: true })).toBe(true);
    expect(shouldOfferNotifications({ choice: "on", available: true, signedIn: true })).toBe(false);
    expect(shouldOfferNotifications({ choice: "off", available: true, signedIn: true })).toBe(false);
  });

  it("treats Expo Go, simulators and a missing project id as unavailable", () => {
    const base = { module: {}, isDevice: true, platform: "ios", projectId: "project-1", expoGo: false };
    expect(resolvePushAvailability(base)).toEqual({ available: true, projectId: "project-1" });
    expect(resolvePushAvailability({ ...base, module: null })).toEqual({ available: false, reason: "native-module" });
    expect(resolvePushAvailability({ ...base, expoGo: true })).toEqual({ available: false, reason: "expo-go" });
    expect(resolvePushAvailability({ ...base, isDevice: false })).toEqual({ available: false, reason: "simulator" });
    expect(resolvePushAvailability({ ...base, platform: "web" })).toEqual({ available: false, reason: "platform" });
    expect(resolvePushAvailability({ ...base, projectId: null })).toEqual({ available: false, reason: "project-id" });
    expect(unavailableNote("expo-go")).toMatch(/development or store build/i);
  });

  it("reads the EAS project id from the config or the update manifest", () => {
    expect(readProjectId({ expoConfig: { extra: { eas: { projectId: " config-id " } } } })).toBe("config-id");
    expect(readProjectId({ easConfig: { projectId: "manifest-id" } })).toBe("manifest-id");
    expect(readProjectId({ expoConfig: { extra: {} }, easConfig: null })).toBeNull();
  });
});

describe("notification deep links", () => {
  it("parses only our queue scheme and a positive integer business id", () => {
    expect(parseDeepLink("praiseloop://queue?businessId=42")).toEqual({ businessId: 42 });
    expect(parseDeepLink("praiseloop://queue/?businessId=7#frag")).toEqual({ businessId: 7 });
    expect(parseDeepLink("praiseloop://queue?businessId=0")).toBeNull();
    expect(parseDeepLink("praiseloop://queue?businessId=-2")).toBeNull();
    expect(parseDeepLink("praiseloop://queue?businessId=1.5")).toBeNull();
    expect(parseDeepLink("praiseloop://draft?businessId=2")).toBeNull();
    expect(parseDeepLink("https://praiseloop.invalid/queue?businessId=2")).toBeNull();
    expect(parseDeepLink(undefined)).toBeNull();
  });

  it("accepts the worker's data object and its numeric fallback", () => {
    expect(parseNotificationData({ url: "praiseloop://queue?businessId=3", businessId: 3 })).toEqual({ businessId: 3 });
    expect(parseNotificationData({ url: "not-a-link", businessId: "9" })).toEqual({ businessId: 9 });
    expect(parseNotificationData({ businessId: "x" })).toBeNull();
    expect(parseNotificationData(null)).toBeNull();
    expect(notificationTargetFromResponse({ notification: { request: { content: { data: { businessId: 8 } } } } })).toEqual({ businessId: 8 });
  });

  it("validates ids before building a queue route", () => {
    expect(parseBusinessId("12")).toBe(12);
    expect(parseBusinessId(12)).toBe(12);
    expect(parseBusinessId(" 12 ")).toBe(12);
    expect(parseBusinessId("0")).toBeNull();
    expect(parseBusinessId("12x")).toBeNull();
    expect(queueHref({ businessId: 12 })).toEqual({ pathname: "/queue", params: { businessId: "12" } });
  });

  it("navigates with a session and holds the target without one", () => {
    const target = { businessId: 5 };
    expect(planNotificationRoute(target, true)).toEqual({
      kind: "navigate",
      href: { pathname: "/queue", params: { businessId: "5" } }
    });
    expect(planNotificationRoute(target, false)).toEqual({ kind: "hold", target });
    expect(planNotificationRoute(null, true)).toEqual({ kind: "ignore" });
  });

  it("keeps a pre-sign-in target in memory only until it is used", () => {
    clearPendingNotificationTarget();
    expect(takePendingNotificationTarget()).toBeNull();
    holdNotificationTarget({ businessId: 4 });
    expect(takePendingNotificationTarget()).toEqual({ businessId: 4 });
    expect(takePendingNotificationTarget()).toBeNull();
  });
});

describe("push registration API", () => {
  it("builds the server's body and rejects a malformed token or platform", () => {
    expect(buildRegistrationBody(TOKEN, "ios")).toEqual({ token: TOKEN, platform: "ios" });
    expect(buildUnregistrationBody(OTHER_TOKEN)).toEqual({ token: OTHER_TOKEN });
    expect(() => buildRegistrationBody("not-a-token", "ios")).toThrow(/valid Expo push token/i);
    expect(() => buildRegistrationBody(TOKEN, "web")).toThrow(/iOS or Android/i);
    expect(() => buildUnregistrationBody("")).toThrow(/valid Expo push token/i);
  });

  it("POSTs the token and DELETE removes it", async () => {
    const { client, request } = apiMock();

    await registerPushToken(client, TOKEN, "android");
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", {
      method: "POST",
      body: { token: TOKEN, platform: "android" }
    });

    await unregisterPushToken(client, TOKEN);
    expect(request).toHaveBeenLastCalledWith("/api/mobile/push-tokens", {
      method: "DELETE",
      body: { token: TOKEN }
    });
  });

  it("does not call the server with an invalid token", async () => {
    const { client, request } = apiMock();
    await expect(registerPushToken(client, "bad", "ios")).rejects.toThrow(/valid Expo push token/i);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("notification toggle and launch refresh", () => {
  it("asks for permission and registers when the owner turns notifications on", async () => {
    const { client, request } = apiMock();
    const saveChoice = jest.fn().mockResolvedValue(undefined);
    const d = deps({ permission: async () => "undetermined", requestPermission: async () => "granted", saveChoice });

    await expect(enableNotifications(client, d)).resolves.toEqual({ status: "on" });
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", {
      method: "POST",
      body: { token: TOKEN, platform: "ios" }
    });
    expect(saveChoice).toHaveBeenCalledWith("on");
  });

  it("remembers a refusal and does not register when permission is denied", async () => {
    const { client, request } = apiMock();
    const saveChoice = jest.fn().mockResolvedValue(undefined);
    const requestPermission = jest.fn().mockResolvedValue("denied");
    const d = deps({ permission: async () => "denied", requestPermission, saveChoice });

    await expect(enableNotifications(client, d)).resolves.toEqual({ status: "denied" });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(saveChoice).toHaveBeenCalledWith("off");
  });

  it("does not prompt when push is unavailable", async () => {
    const { client, request } = apiMock();
    const permission = jest.fn();
    const requestPermission = jest.fn();
    const d = deps({
      availability: () => ({ available: false, reason: "expo-go" }),
      permission,
      requestPermission
    });

    await expect(enableNotifications(client, d)).resolves.toEqual({ status: "unavailable", reason: "expo-go" });
    expect(permission).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the switch off when the server rejects the registration", async () => {
    const request = jest.fn().mockRejectedValue(new Error("offline"));
    const client = { request } as unknown as PushApi;
    const saveChoice = jest.fn().mockResolvedValue(undefined);
    const d = deps({ saveChoice });

    await expect(enableNotifications(client, d)).resolves.toEqual({ status: "failed" });
    expect(saveChoice).not.toHaveBeenCalledWith("on");
  });

  it("unregisters this device but keeps the preference when turned off", async () => {
    const { client, request } = apiMock();
    const saveChoice = jest.fn().mockResolvedValue(undefined);
    const forgetToken = jest.fn();
    const d = deps({ cachedToken: () => TOKEN, saveChoice, forgetToken });

    await disableNotifications(client, d);
    expect(saveChoice).toHaveBeenCalledWith("off");
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", {
      method: "DELETE",
      body: { token: TOKEN }
    });
    expect(forgetToken).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed unregister pending and retries it on the next launch, even with notifications off", async () => {
    const failing = jest.fn().mockRejectedValue(new Error("offline"));
    const savePending = jest.fn().mockResolvedValue(undefined);
    await disableNotifications({ request: failing } as unknown as PushApi, deps({ cachedToken: () => TOKEN, savePending }));
    expect(savePending).toHaveBeenCalledWith(TOKEN);

    const { client, request } = apiMock();
    const clearPending = jest.fn().mockResolvedValue(undefined);
    await refreshPushRegistration(client, deps({ loadChoice: async () => "off", loadPending: async () => TOKEN, clearPending }));
    // Registered to the current owner first (the server moves the token to its caller), then removed,
    // so the DELETE works even when a different owner is signed in now.
    expect(request.mock.calls.map(call => `${call[1].method}`)).toEqual(["POST", "DELETE"]);
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", { method: "POST", body: { token: TOKEN, platform: "ios" } });
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", { method: "DELETE", body: { token: TOKEN } });
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  it("remembers the device without a token when notifications are turned off offline", async () => {
    const savePending = jest.fn().mockResolvedValue(undefined);
    const token = jest.fn().mockRejectedValue(new Error("offline"));
    const { client } = apiMock();
    await disableNotifications(client, deps({ cachedToken: () => null, token, savePending }));

    expect(token).toHaveBeenCalledWith("project-1");
    expect(savePending).toHaveBeenCalledWith(PENDING_UNREGISTER_ANY_TOKEN);
  });

  it("unregisters the pending marker on a later launch once a token is available", async () => {
    const { client, request } = apiMock();
    const clearPending = jest.fn().mockResolvedValue(undefined);
    const token = jest.fn().mockResolvedValue(TOKEN);

    await refreshPushRegistration(client, deps({
      loadChoice: async () => "off",
      loadPending: async () => PENDING_UNREGISTER_ANY_TOKEN,
      cachedToken: () => null,
      token,
      clearPending
    }));

    expect(token).toHaveBeenCalledWith("project-1");
    expect(request.mock.calls.map(call => call[1].method)).toEqual(["POST", "DELETE"]);
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", { method: "POST", body: { token: TOKEN, platform: "ios" } });
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", { method: "DELETE", body: { token: TOKEN } });
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  it("leaves the marker pending when a retry still cannot get a token", async () => {
    const { client, request } = apiMock();
    const clearPending = jest.fn().mockResolvedValue(undefined);
    const savePending = jest.fn().mockResolvedValue(undefined);
    const token = jest.fn().mockRejectedValue(new Error("offline"));

    await refreshPushRegistration(client, deps({
      loadChoice: async () => "off",
      loadPending: async () => PENDING_UNREGISTER_ANY_TOKEN,
      cachedToken: () => null,
      token,
      clearPending,
      savePending
    }));

    expect(token).toHaveBeenCalledWith("project-1");
    expect(request).not.toHaveBeenCalled();
    expect(clearPending).not.toHaveBeenCalled();
    expect(savePending).not.toHaveBeenCalled();
  });

  it("leaves the token pending when the retry fails again, and retries it on sign-out", async () => {
    const clearPending = jest.fn().mockResolvedValue(undefined);
    const failing = jest.fn().mockRejectedValue(new Error("offline"));
    await refreshPushRegistration({ request: failing } as unknown as PushApi, deps({ loadChoice: async () => "off", loadPending: async () => TOKEN, clearPending }));
    expect(clearPending).not.toHaveBeenCalled();

    const { client, request } = apiMock();
    await unregisterPushDevice(client, deps({ loadChoice: async () => "off", loadPending: async () => TOKEN, clearPending }));
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", { method: "DELETE", body: { token: TOKEN } });
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  it("does not let a slow launch refresh register the device after notifications were turned off", async () => {
    const { client, request } = apiMock();
    let release: (token: string) => void = () => undefined;
    const slowToken = () => new Promise<string>(resolve => { release = resolve; });
    const d = deps({ loadChoice: async () => "on", permission: async () => "granted", token: slowToken, cachedToken: () => TOKEN });

    const refresh = refreshPushRegistration(client, d);
    const disable = disableNotifications(client, d);
    await new Promise(resolve => setTimeout(resolve, 0));
    release(TOKEN);
    await Promise.all([refresh, disable]);

    expect(request.mock.calls.map(call => call[1].method)).toEqual(["POST", "DELETE"]);
  });

  it("does not leave a pending marker when notifications were never on (Not now)", async () => {
    const { client, request } = apiMock();
    const savePending = jest.fn().mockResolvedValue(undefined);
    const saveChoice = jest.fn().mockResolvedValue(undefined);
    const token = jest.fn().mockRejectedValue(new Error("no permission"));
    await disableNotifications(client, deps({ loadChoice: async () => null, cachedToken: () => null, savePending, saveChoice, token }));
    expect(saveChoice).toHaveBeenCalledWith("off");
    expect(savePending).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the token pending when enabling fails after the registration may have reached the server", async () => {
    const failing = jest.fn().mockRejectedValue(new Error("response lost"));
    const savePending = jest.fn().mockResolvedValue(undefined);
    const result = await enableNotifications({ request: failing } as unknown as PushApi, deps({ permission: async () => "granted", savePending }));
    expect(result).toEqual({ status: "failed" });
    expect(savePending).toHaveBeenCalledWith(TOKEN);

    const { client, request } = apiMock();
    const clearPending = jest.fn().mockResolvedValue(undefined);
    await unregisterPushDevice(client, deps({ loadChoice: async () => null, loadPending: async () => TOKEN, clearPending }));
    expect(request.mock.calls.map(call => call[1].method)).toEqual(["POST", "DELETE"]);
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  it("clears an earlier pending cleanup once enabling succeeds", async () => {
    const { client } = apiMock();
    const clearPending = jest.fn().mockResolvedValue(undefined);
    await expect(enableNotifications(client, deps({ permission: async () => "granted", clearPending }))).resolves.toEqual({ status: "on" });
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  it("refreshes the token on launch only when notifications are on and permission is granted", async () => {
    const { client, request } = apiMock();

    await refreshPushRegistration(client, deps({ loadChoice: async () => "off" }));
    expect(request).not.toHaveBeenCalled();

    await refreshPushRegistration(client, deps({ loadChoice: async () => "on", permission: async () => "denied" }));
    expect(request).not.toHaveBeenCalled();

    await refreshPushRegistration(client, deps({ loadChoice: async () => "on", permission: async () => "granted" }));
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", {
      method: "POST",
      body: { token: TOKEN, platform: "ios" }
    });
  });

  it("unregisters best-effort on sign-out without changing the preference", async () => {
    const { client, request } = apiMock();
    const saveChoice = jest.fn().mockResolvedValue(undefined);
    const d = deps({ cachedToken: () => TOKEN, saveChoice });

    await unregisterPushDevice(client, d);
    expect(request).toHaveBeenCalledWith("/api/mobile/push-tokens", {
      method: "DELETE",
      body: { token: TOKEN }
    });
    expect(saveChoice).not.toHaveBeenCalled();
  });

  it("skips the sign-out request when notifications were never on", async () => {
    const { client, request } = apiMock();
    const forgetToken = jest.fn();
    await unregisterPushDevice(client, deps({ loadChoice: async () => "off", cachedToken: () => TOKEN, forgetToken }));
    expect(request).not.toHaveBeenCalled();
    expect(forgetToken).toHaveBeenCalledTimes(1);
  });
});

describe("notification choice store", () => {
  it("remembers on and off in the existing keychain storage", async () => {
    const { storage, values } = memoryStorage();
    const store = createNotificationStore(storage);

    await expect(store.load()).resolves.toBeNull();
    await store.save("on");
    expect(values.get(NOTIFICATION_CHOICE_KEY)).toBe("on");
    await expect(store.load()).resolves.toBe("on");
    await store.save("off");
    await expect(store.load()).resolves.toBe("off");
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it("ignores a value it does not recognise", async () => {
    const { storage } = memoryStorage({ [NOTIFICATION_CHOICE_KEY]: "maybe" });
    await expect(createNotificationStore(storage).load()).resolves.toBeNull();
  });
});
