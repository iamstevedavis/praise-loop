import { ApiError, createApiClient } from "../src/api/client";
import { requestEmailCode, signInWithEmailCode } from "../src/auth/email";

function response(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

describe("email sign-in", () => {
  it("requests a code and exchanges it for a bearer session", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.endsWith("/api/mobile/session/email") ? response(200, { token: "a".repeat(43) }) : response(200, { ok: true });
    }) as typeof fetch;
    const client = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fake });

    await requestEmailCode(client, "owner@example.invalid");
    await expect(signInWithEmailCode(client, "owner@example.invalid", "123456")).resolves.toBe("a".repeat(43));

    expect(calls.map(call => new URL(call.url).pathname)).toEqual(["/api/auth/email/request", "/api/mobile/session/email"]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ email: "owner@example.invalid", code: "123456" });
  });

  it("surfaces a rejected code without treating it as an ended session", async () => {
    const fake = (async () => response(400, { error: "That code is invalid or has expired" })) as typeof fetch;
    const client = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fake });
    const error = await signInWithEmailCode(client, "owner@example.invalid", "000000").catch(cause => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("http");
    expect((error as ApiError).message).toBe("That code is invalid or has expired");
  });

  it("rejects an invalid session response", async () => {
    const fake = (async () => response(200, { token: 42 })) as typeof fetch;
    const client = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fake });
    await expect(signInWithEmailCode(client, "owner@example.invalid", "123456")).rejects.toThrow(/invalid/);
  });
});
