import { ApiError, createApiClient, isSignedOut } from "../src/api/client";
import { listBusinesses } from "../src/api/businesses";
import { fetchGeneration, listDrafts, saveCaption, setDraftStatus, type Draft } from "../src/api/drafts";

// Every call the queue and draft screens make, so an expired or revoked token is
// seen as "signed out" whichever one hits it.
const draft = { id: 12, version: 3 } as Draft;
const calls: [string, (client: ReturnType<typeof createApiClient>) => Promise<unknown>][] = [
  ["listBusinesses", client => listBusinesses(client)],
  ["listDrafts", client => listDrafts(client, 4)],
  ["fetchGeneration", client => fetchGeneration(client, 4)],
  ["saveCaption", client => saveCaption(client, draft, "A caption long enough to be valid.")],
  ["setDraftStatus", client => setDraftStatus(client, draft, "approved")]
];

function clientAnswering(status: number) {
  return createApiClient({
    baseUrl: "http://localhost:3000",
    getToken: () => "revoked-or-expired-token",
    fetchImpl: (async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({ error: "Sign in to access your business" }) }) as unknown as Response) as typeof fetch
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error) { return error; }
  throw new Error("expected the request to fail");
}

describe("an ended session on the phone", () => {
  it.each(calls)("%s reports a 401 as signedOut so handleError returns to sign-in", async (_name, call) => {
    const error = await rejection(call(clientAnswering(401)));
    expect(error).toBeInstanceOf(ApiError);
    expect(isSignedOut(error)).toBe(true);
    expect((error as ApiError).message).toBe("Your session ended. Sign in again.");
  });

  it.each([403, 404, 409, 429, 500, 503])("a %i never counts as a session ending", async status => {
    for (const [, call] of calls) {
      expect(isSignedOut(await rejection(call(clientAnswering(status))))).toBe(false);
    }
  });

  it("does not treat network failures or ordinary errors as a session ending", () => {
    expect(isSignedOut(new ApiError("network"))).toBe(false);
    expect(isSignedOut(new ApiError("timeout"))).toBe(false);
    expect(isSignedOut(new Error("signedOut"))).toBe(false);
    expect(isSignedOut(null)).toBe(false);
  });
});
