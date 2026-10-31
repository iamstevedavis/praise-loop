import { Platform } from "react-native";
import {
  cachedPushToken,
  expoPushToken,
  forgetPushToken,
  loadNotifications,
  permissionStatus,
  pushAvailability,
  requestPermission
} from "../src/notifications/native";

const mockPermissions = jest.fn();
const mockRequest = jest.fn();
const mockToken = jest.fn();
const mockChannel = jest.fn();

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: "project-1" } } },
    easConfig: null,
    appOwnership: null,
    expoGoConfig: null
  }
}));

jest.mock("expo-device", () => ({
  __esModule: true,
  isDevice: true
}));

jest.mock("expo-notifications", () => ({
  __esModule: true,
  getPermissionsAsync: (...args: unknown[]) => mockPermissions(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequest(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockToken(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockChannel(...args),
  AndroidImportance: { DEFAULT: 3 }
}));


describe("native push module", () => {
  beforeEach(() => {
    mockPermissions.mockReset();
    mockRequest.mockReset();
    mockToken.mockReset();
    mockChannel.mockReset();
    forgetPushToken();
  });

  it("loads the native module lazily and reports the EAS project", () => {
    expect(loadNotifications()).not.toBeNull();
    expect(pushAvailability()).toEqual({ available: true, projectId: "project-1" });
  });

  it("maps the OS permission without prompting on a read", async () => {
    mockPermissions.mockResolvedValue({ granted: true, status: "granted" });
    await expect(permissionStatus()).resolves.toBe("granted");
    expect(mockRequest).not.toHaveBeenCalled();

    mockPermissions.mockResolvedValue({ granted: false, status: "undetermined" });
    await expect(permissionStatus()).resolves.toBe("undetermined");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("requests permission only when explicitly asked", async () => {
    mockRequest.mockResolvedValue({ granted: false, status: "denied" });
    await expect(requestPermission()).resolves.toBe("denied");
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("gets an Expo token for the project and caches it for sign-out", async () => {
    mockToken.mockResolvedValue({ type: "expo", data: "ExponentPushToken[abcdefgh1234]" });

    await expect(expoPushToken("project-1")).resolves.toBe("ExponentPushToken[abcdefgh1234]");
    expect(mockToken).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(cachedPushToken()).toBe("ExponentPushToken[abcdefgh1234]");

    forgetPushToken();
    expect(cachedPushToken()).toBeNull();
  });

  it("rejects a response without a token string", async () => {
    mockToken.mockResolvedValue({ type: "expo", data: null });
    await expect(expoPushToken("project-1")).rejects.toThrow(/push token/i);
    expect(cachedPushToken()).toBeNull();
  });

  it("creates the Android channel before the permission prompt and before the token, not on iOS", async () => {
    mockRequest.mockResolvedValue({ granted: true, status: "granted" });
    mockToken.mockResolvedValue({ type: "expo", data: "ExponentPushToken[abcdefgh1234]" });

    await requestPermission();
    await expoPushToken("project-1");
    expect(mockChannel).not.toHaveBeenCalled();

    const restore = jest.replaceProperty(Platform, "OS", "android");
    try {
      const order: string[] = [];
      mockChannel.mockImplementation(async () => { order.push("channel"); });
      mockRequest.mockImplementation(async () => { order.push("permission"); return { granted: true, status: "granted" }; });
      mockToken.mockImplementation(async () => { order.push("token"); return { type: "expo", data: "ExponentPushToken[abcdefgh1234]" }; });
      await requestPermission();
      await expoPushToken("project-1");
      expect(order).toEqual(["channel", "permission", "channel", "token"]);
      expect(mockChannel).toHaveBeenCalledWith("default", expect.objectContaining({ importance: 3 }));
    } finally {
      restore.restore();
    }
  });
});
