import type { ApiClient } from "./client";

export type Business = {
  id: number;
  name: string;
  timezone: string;
  logo_url: string | null;
  brand_tone: string;
  weekly_target: number;
  brand_colors: {
    primary: string;
    secondary: string;
    template: string;
    quoteSize: string;
  };
};

export async function listBusinesses(client: ApiClient): Promise<Business[]> {
  const data = await client.request<{ businesses?: unknown }>("/api/businesses");
  if (!data || !Array.isArray(data.businesses)) {
    throw new Error("The server returned an invalid business list.");
  }
  return data.businesses as Business[];
}
