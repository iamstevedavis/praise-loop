import { ApiError, createApiClient } from "../src/api/client";

function response(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

function client(fetchImpl: typeof fetch, options: { token?: string | null; timeoutMs?: number } = {}) {
  return createApiClient({
    baseUrl: "http://localhost:3000/",
    fetchImpl,
    timeoutMs: options.timeoutMs,
    getToken: () => options.token ?? null
  });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

describe("api client", () => {
  it("sends the bearer token and JSON body to the configured base URL", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return response(200, { ok: true });
    }) as typeof fetch;

    await expect(client(fake, { token: "mobile-token" }).request("/api/drafts", { method: "POST", body: { status: "approved" } }))
      .resolves.toEqual({ ok: true });

    expect(calls[0].url).toBe("http://localhost:3000/api/drafts");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer mobile-token");
    expect(headers["content-type"]).toBe("application/json");
    expect(calls[0].init?.body).toBe(JSON.stringify({ status: "approved" }));
  });

  it("omits the Authorization header without a token", async () => {
    let headers: Record<string, string> = {};
    const fake = (async (_url: string, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return response(200, {});
    }) as typeof fetch;

    await client(fake).request("/api/mobile/config");
    expect(headers.authorization).toBeUndefined();
  });

  it("maps 401, 409 and 429 to actionable errors", async () => {
    expect((await failure(client((async () => response(401)) as typeof fetch).request("/api/businesses"))).kind).toBe("signedOut");
    const conflict = await failure(client((async () => response(409)) as typeof fetch).request("/api/drafts/status"));
    expect(conflict.kind).toBe("conflict");
    expect(conflict.message).toMatch(/refresh/i);
    const limit = await failure(client((async () => response(429)) as typeof fetch).request("/api/images/render"));
    expect(limit.kind).toBe("limit");
    expect(limit.message).toMatch(/limit/i);
  });

  it("surfaces the server message for other failures", async () => {
    const error = await failure(client((async () => response(400, { error: "valid draftPostId is required" })) as typeof fetch).request("/api/drafts/status"));
    expect(error.kind).toBe("http");
    expect(error.status).toBe(400);
    expect(error.message).toBe("valid draftPostId is required");
  });

  it("maps transport failures and timeouts without leaking the token", async () => {
    const network = await failure(client((async () => { throw new Error("socket closed for mobile-token"); }) as typeof fetch, { token: "mobile-token" }).request("/api/businesses"));
    expect(network.kind).toBe("network");
    expect(network.message).not.toContain("mobile-token");

    const slow = (async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch;
    const timeout = await failure(client(slow, { timeoutMs: 5 }).request("/api/businesses"));
    expect(timeout.kind).toBe("timeout");
  });

  it("rejects a build with no API base URL", async () => {
    const error = await failure(createApiClient({ baseUrl: "" }).request("/api/mobile/config"));
    expect(error.kind).toBe("network");
    expect(error.message).toMatch(/API_BASE_URL/);
  });
});
