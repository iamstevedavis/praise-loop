import { NextResponse } from "next/server";

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
      features: features()
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
  );
}
