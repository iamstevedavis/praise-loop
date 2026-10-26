export type ApiErrorKind = "signedOut" | "conflict" | "limit" | "network" | "timeout" | "http";

const messages: Record<Exclude<ApiErrorKind, "http">, string> = {
  signedOut: "Your session ended. Sign in again.",
  conflict: "This post changed somewhere else. Refresh and try again.",
  limit: "You’ve reached today’s limit. Try again tomorrow.",
  network: "Can’t reach PraiseLoop. Check your connection and try again.",
  timeout: "PraiseLoop took too long to answer. Try again."
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;

  constructor(kind: ApiErrorKind, status?: number, message?: string) {
    super(message ?? (kind === "http" ? "That didn’t work. Try again." : messages[kind]));
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

export type ApiRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export type ApiClientOptions = {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createApiClient({ baseUrl, getToken, fetchImpl = fetch, timeoutMs = 15000 }: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, { method = "GET", body, headers = {} }: ApiRequest = {}): Promise<T> {
    if (!root) throw new ApiError("network", undefined, "API_BASE_URL is not configured for this build.");
    const token = await getToken?.();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${root}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });

      if (response.status === 401) throw new ApiError("signedOut", 401);
      if (response.status === 409) throw new ApiError("conflict", 409);
      if (response.status === 429) throw new ApiError("limit", 429);
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: unknown } | null;
        const message = typeof data?.error === "string" ? data.error : undefined;
        throw new ApiError("http", response.status, message);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError("timeout");
      // Never include the request headers or token in a surfaced error.
      throw new ApiError("network");
    } finally {
      clearTimeout(timer);
    }
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
