import type { ApiClient } from "./client";

export type WeeklyUsage = {
  businessId: number;
  name: string;
  timezone: string;
  resetsOn: string;
  allocated: number;
  target: number;
  weeklyTarget: number;
  quotaMet: boolean;
};

// Read-only mirror of GET /api/entitlements. The server owns every limit; the
// app only displays what comes back.
export type Entitlements = {
  plan: "free" | "pro";
  source: "default" | "manual" | "store";
  expiresAt: string | null;
  expired: boolean;
  limits: { postsPerWeek: number; templates: number; watermark: boolean; reviewSync: boolean; aiReplies: boolean; businesses: number };
  usage: WeeklyUsage[];
};

export async function fetchEntitlements(client: ApiClient): Promise<Entitlements> {
  const data = await client.request<Partial<Entitlements>>("/api/entitlements");
  if (!data || (data.plan !== "free" && data.plan !== "pro") || !data.limits || !Array.isArray(data.usage)) {
    throw new Error("The server returned an invalid plan.");
  }
  return data as Entitlements;
}
