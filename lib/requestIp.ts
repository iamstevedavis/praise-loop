// The client address used for rate limiting. Client-supplied forwarding headers are
// only trustworthy behind a proxy that overwrites them (the pilot's Cloudflare
// Tunnel sets TRUST_PROXY_HEADERS=1); otherwise every caller shares one bucket.
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return "untrusted";
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}
