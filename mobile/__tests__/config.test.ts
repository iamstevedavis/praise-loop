import { ApiError, createApiClient } from "../src/api/client";
import { compareVersions, fetchMobileConfig, isUpdateRequired, updateRequiredFor, type MobileConfig } from "../src/api/config";

const config: MobileConfig = { minimumVersion: "1.2.0", latestVersion: "1.4.0", features: ["queue"] };

function fakeFetch(status: number, body: unknown) {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }) as unknown as Response) as typeof fetch;
}

describe("version gate", () => {
  it("compares semantic versions numerically", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("not-a-version", "1.0.0")).toBe(0);
  });

  it("requires an update only below the minimum", () => {
    expect(isUpdateRequired("1.1.9", "1.2.0")).toBe(true);
    expect(isUpdateRequired("1.2.0", "1.2.0")).toBe(false);
    expect(isUpdateRequired("1.10.0", "1.2.0")).toBe(false);
    expect(updateRequiredFor(config, "1.0.0")).toBe(true);
    expect(updateRequiredFor(config, "1.4.0")).toBe(false);
  });

  it("fetches the public config from the expected route", async () => {
    let url = "";
    const fetchImpl = (async (input: string) => {
      url = input;
      return { ok: true, status: 200, json: async () => config } as unknown as Response;
    }) as typeof fetch;
    const client = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl });

    await expect(fetchMobileConfig(client)).resolves.toEqual(config);
    expect(url).toBe("http://localhost:3000/api/mobile/config");
  });

  it("rejects a malformed config instead of guessing", async () => {
    const client = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fakeFetch(200, { minimumVersion: 1 }) });
    await expect(fetchMobileConfig(client)).rejects.toThrow(/invalid mobile config/i);
  });

  it("reads the demo sign-in flag only when the server reports it", async () => {
    const demo = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fakeFetch(200, { ...config, devAuth: true }) });
    await expect(fetchMobileConfig(demo)).resolves.toMatchObject({ devAuth: true });

    const production = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fakeFetch(200, { ...config, devAuth: false }) });
    await expect(fetchMobileConfig(production)).resolves.toMatchObject({ devAuth: false });

    const absent = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fakeFetch(200, config) });
    expect((await fetchMobileConfig(absent)).devAuth).toBeUndefined();

    const malformed = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fakeFetch(200, { ...config, devAuth: "yes" }) });
    await expect(fetchMobileConfig(malformed)).rejects.toThrow(/invalid mobile config/i);
  });

  it("propagates auth and limit errors from the config route", async () => {
    const limited = createApiClient({ baseUrl: "http://localhost:3000", fetchImpl: fakeFetch(429, {}) });
    await expect(fetchMobileConfig(limited)).rejects.toBeInstanceOf(ApiError);
    await expect(fetchMobileConfig(limited)).rejects.toMatchObject({ kind: "limit" });
  });
});
