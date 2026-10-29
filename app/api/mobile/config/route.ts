import { NextResponse } from "next/server";
import { devAuthEnabled } from "../../../../lib/devAuth";

// Public, owner-free configuration for installed apps. Keep this response small
// and cacheable: the app calls it on launch to decide whether it can continue.
export const dynamic = "force-dynamic";

const VERSION = /^\d+\.\d+\.\d+$/;
const defaultVersion = "1.0.0";
const featureName = /^[a-z][a-z0-9-]{0,39}$/;

function version(name: string, fallback = defaultVersion) {
  const value = process.env[name]?.trim();
  return value && VERSION.test(value) ? value : fallback;
}

function features() {
  const configured = process.env.MOBILE_FEATURES ?? "";
  return [...new Set(configured.split(",").map(f => f.trim()).filter(f => featureName.test(f)))];
}

export async function GET() {
  const minimumVersion = version("MOBILE_MINIMUM_VERSION");
  return NextResponse.json(
    {
      minimumVersion,
      latestVersion: version("MOBILE_LATEST_VERSION", minimumVersion),
      features: features(),
      // Only true for a development process with MOBILE_DEV_AUTH=1; the app uses it
      // to show the demo sign-in button. Production builds always report false.
      devAuth: devAuthEnabled()
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
  );
}
