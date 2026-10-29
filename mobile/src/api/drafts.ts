import type { ApiClient } from "./client";

export type DraftStatus = "draft" | "approved" | "archived" | "shared" | "failed" | "scheduled" | "published";

export type Draft = {
  id: number;
  version: number;
  quote_text: string;
  caption_text: string;
  image_path: string | null;
  status: DraftStatus;
  shared_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  rating: number | null;
  author_name: string | null;
  reviewed_at: string | null;
  source: string | null;
  job_state: string | null;
  error_code: string | null;
  provider_state: string | null;
};

export type GenerationJob = {
  id: number;
  draft_id: number;
  state: string;
  attempts: number;
  manual_retries: number;
  error_code: string | null;
  period_start: string;
};

export type GenerationPeriod = {
  period_start: string;
  target: number;
  allocated: number;
  completed: number;
  reason: string;
  timezone: string;
};

export type GenerationSnapshot = {
  jobs: GenerationJob[];
  periods: GenerationPeriod[];
  // The week the server considers current for this business's timezone. Without
  // it, periods[0] can still be last week before this week's first request.
  current_period: string | null;
};

const STATUSES: DraftStatus[] = ["draft", "approved", "archived", "shared", "failed", "scheduled", "published"];

// node-postgres returns bigint columns as strings, so every ID is coerced here
// instead of trusting the JSON shape at each call site.
function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeDraft(row: Record<string, unknown>): Draft {
  const status = String(row.status ?? "");
  if (!STATUSES.includes(status as DraftStatus)) throw new Error("The server returned an unknown draft status.");
  return {
    id: integer(row.id),
    version: integer(row.version),
    quote_text: typeof row.quote_text === "string" ? row.quote_text : "",
    caption_text: typeof row.caption_text === "string" ? row.caption_text : "",
    image_path: text(row.image_path),
    status: status as DraftStatus,
    shared_at: text(row.shared_at),
    scheduled_for: text(row.scheduled_for),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    rating: row.rating === null || row.rating === undefined ? null : integer(row.rating),
    author_name: text(row.author_name),
    reviewed_at: text(row.reviewed_at),
    source: text(row.source),
    job_state: text(row.job_state),
    error_code: text(row.error_code),
    provider_state: text(row.provider_state)
  };
}

function responseDraft(data: { draft?: unknown }): Draft {
  if (!data?.draft || typeof data.draft !== "object") {
    throw new Error("The server returned an invalid draft.");
  }
  return normalizeDraft(data.draft as Record<string, unknown>);
}

export async function listDrafts(client: ApiClient, businessId: number): Promise<Draft[]> {
  const data = await client.request<{ drafts?: unknown }>(`/api/drafts?businessId=${businessId}`);
  if (!data || !Array.isArray(data.drafts)) throw new Error("The server returned an invalid draft list.");
  return data.drafts.map(row => normalizeDraft(row as Record<string, unknown>));
}

export async function fetchGeneration(client: ApiClient, businessId: number): Promise<GenerationSnapshot> {
  const data = await client.request<{ jobs?: unknown; periods?: unknown; current_period?: unknown }>(`/api/generation?businessId=${businessId}`);
  return {
    current_period: text(data?.current_period),
    jobs: Array.isArray(data?.jobs)
      ? (data.jobs as Record<string, unknown>[]).map(job => ({
          id: integer(job.id),
          draft_id: integer(job.draft_id),
          state: String(job.state ?? ""),
          attempts: integer(job.attempts),
          manual_retries: integer(job.manual_retries),
          error_code: text(job.error_code),
          period_start: typeof job.period_start === "string" ? job.period_start : ""
        }))
      : [],
    periods: Array.isArray(data?.periods)
      ? (data.periods as Record<string, unknown>[]).map(period => ({
          period_start: typeof period.period_start === "string" ? period.period_start : "",
          target: integer(period.target),
          allocated: integer(period.allocated),
          completed: integer(period.completed),
          reason: String(period.reason ?? ""),
          timezone: String(period.timezone ?? "")
        }))
      : []
  };
}

export async function saveCaption(client: ApiClient, draft: Draft, captionText: string): Promise<Draft> {
  const data = await client.request<{ draft?: unknown }>("/api/drafts/caption", {
    method: "POST",
    body: { draftPostId: draft.id, captionText, version: draft.version }
  });
  return responseDraft(data);
}

export async function setDraftStatus(
  client: ApiClient,
  draft: Draft,
  status: "approved" | "archived" | "shared"
): Promise<Draft> {
  const data = await client.request<{ draft?: unknown }>("/api/drafts/status", {
    method: "POST",
    body: { draftPostId: draft.id, status, version: draft.version }
  });
  return responseDraft(data);
}

// Mirrors the server's caption rule so the button explains the problem before
// a round trip.
export function captionProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Add a caption before saving.";
  if (trimmed.length > 200) return "Keep the caption to 200 characters or fewer.";
  return null;
}
