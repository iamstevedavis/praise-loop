import * as AppleAuthentication from "expo-apple-authentication";
import {
  AppleSignInCancelledError,
  appleSignInAvailable,
  isAppleSignInCancelled,
  signInWithApple
} from "../src/auth/apple";

// The native module is mocked; the real package needs an iOS development or
// store build and is not available under Jest or Expo Go.
jest.mock("expo-apple-authentication", () => ({
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 }
}));

const isAvailable = AppleAuthentication.isAvailableAsync as jest.Mock;
const signInAsync = AppleAuthentication.signInAsync as jest.Mock;
const scope = AppleAuthentication.AppleAuthenticationScope;
const fakeModule = AppleAuthentication as unknown as Parameters<typeof appleSignInAvailable>[0];

describe("native Apple sign-in", () => {
  beforeEach(() => {
    isAvailable.mockResolvedValue(true);
  });

  it("is available only on iOS with a working native module", async () => {
    expect(await appleSignInAvailable(null, "ios")).toBe(false);
    expect(await appleSignInAvailable(fakeModule, "android")).toBe(false);
    expect(isAvailable).not.toHaveBeenCalled();
    isAvailable.mockResolvedValueOnce(false);
    expect(await appleSignInAvailable(fakeModule, "ios")).toBe(false);
    isAvailable.mockRejectedValueOnce(new Error("unsupported"));
    expect(await appleSignInAvailable(fakeModule, "ios")).toBe(false);
    expect(await appleSignInAvailable(fakeModule, "ios")).toBe(true);
  });

  it("requests name and email and returns the identity token and first-sign-in name", async () => {
    signInAsync.mockResolvedValue({
      identityToken: "apple-id-token",
      fullName: { givenName: "Ada", middleName: null, familyName: "Lovelace" }
    });

    await expect(signInWithApple(fakeModule, "ios")).resolves.toEqual({
      identityToken: "apple-id-token",
      fullName: "Ada Lovelace"
    });
    expect(signInAsync).toHaveBeenCalledWith({
      requestedScopes: [scope.FULL_NAME, scope.EMAIL]
    });
  });

  it("returns no name when Apple sends none after the first sign-in", async () => {
    signInAsync.mockResolvedValue({ identityToken: "apple-id-token", fullName: null });

    await expect(signInWithApple(fakeModule, "ios")).resolves.toEqual({
      identityToken: "apple-id-token",
      fullName: null
    });
  });

  it("turns the native cancellation code into a quiet no-op marker", async () => {
    signInAsync.mockRejectedValue(Object.assign(new Error("cancelled"), { code: "ERR_REQUEST_CANCELED" }));

    const error = await signInWithApple(fakeModule, "ios").catch(cause => cause);
    expect(error).toBeInstanceOf(AppleSignInCancelledError);
    expect(isAppleSignInCancelled(error)).toBe(true);
  });

  it("rejects a success response without a token", async () => {
    signInAsync.mockResolvedValue({ identityToken: null, fullName: null });

    const error = await signInWithApple(fakeModule, "ios").catch(cause => cause);
    expect(error).toBeInstanceOf(Error);
    expect(isAppleSignInCancelled(error)).toBe(false);
    expect((error as Error).message).toMatch(/did not return/i);
  });

  it("refuses to start off iOS", async () => {
    await expect(signInWithApple(fakeModule, "android")).rejects.toThrow(/not available/i);
    expect(signInAsync).not.toHaveBeenCalled();
  });
});
