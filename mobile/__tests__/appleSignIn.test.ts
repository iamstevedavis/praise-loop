import { ApiError } from "../src/api/client";
import { api } from "../src/api";
import { sessionStore } from "../src/auth/store";
import { signInWithAppleToken } from "../src/auth/session";

jest.mock("../src/api", () => ({ api: { request: jest.fn() } }));
jest.mock("../src/auth/store", () => ({ sessionStore: { save: jest.fn() } }));

const request = api.request as jest.Mock;
const save = sessionStore.save as jest.Mock;

describe("Apple session exchange", () => {
  it("posts the identity token and first-sign-in name and saves the bearer session", async () => {
    request.mockResolvedValue({ token: "session-token", expires: "2026-12-01T00:00:00Z" });

    await signInWithAppleToken("apple-id-token", "Ada Lovelace");

    expect(request).toHaveBeenCalledWith("/api/mobile/session/apple", {
      method: "POST",
      body: { idToken: "apple-id-token", fullName: "Ada Lovelace" }
    });
    expect(save).toHaveBeenCalledWith("session-token");
  });

  it("omits the name when Apple did not send one", async () => {
    request.mockResolvedValue({ token: "session-token" });

    await signInWithAppleToken("apple-id-token");

    expect(request).toHaveBeenCalledWith("/api/mobile/session/apple", {
      method: "POST",
      body: { idToken: "apple-id-token" }
    });
  });

  it("rejects an invalid session response without saving anything", async () => {
    request.mockResolvedValue({ token: 42 });

    await expect(signInWithAppleToken("apple-id-token")).rejects.toThrow(/invalid/i);
    expect(save).not.toHaveBeenCalled();
  });

  it("passes a rejected sign-in through as signed out", async () => {
    request.mockRejectedValue(new ApiError("signedOut", 401));

    const error = await signInWithAppleToken("apple-id-token").catch(cause => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("signedOut");
    expect(save).not.toHaveBeenCalled();
  });
});
