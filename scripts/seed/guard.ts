import { devAuthEnabled } from "../../lib/devAuth";

// Hosts a development database can have: the host machine, or the Compose service
// name that the web, worker and migrate containers use. Anything else (a managed
// database, a VPS, another machine on the LAN) is refused, even if it is empty.
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "postgres"]);

export function assertSeedable(env: Record<string, string | undefined> = process.env): void {
  if (!devAuthEnabled(env)) {
    throw new Error("Refusing to seed: set MOBILE_DEV_AUTH=1 and run in a development process (not a production build)");
  }
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error("Refusing to seed: DATABASE_URL is not set");
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    throw new Error("Refusing to seed: DATABASE_URL is not a valid URL");
  }
  // An empty host is a local Unix socket (postgres:///db).
  if (host && !LOCAL_DATABASE_HOSTS.has(host)) {
    throw new Error(`Refusing to seed: DATABASE_URL points at ${host}, which is not a local development database`);
  }
}
