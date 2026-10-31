import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Apple publishes its signing keys here; jose caches them and honours Cache-Control.
const APPLE_KEYS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const ISSUER = "https://appleid.apple.com";

export type AppleIdentity = { subject: string; email: string | null; emailVerified: boolean };

export function allowedAppleAudiences() {
  return (process.env.APPLE_CLIENT_ID ?? "").split(",").map(v => v.trim()).filter(Boolean);
}

// Returns null for any token that is not a currently valid Apple identity token
// minted for one of our apps. The name is not in the token (Apple sends it once,
// separately), and a private-relay address is kept as-is. `keys` is injectable
// for tests only.
export async function verifyAppleIdToken(idToken: string, keys: JWTVerifyGetKey = APPLE_KEYS): Promise<AppleIdentity | null> {
  const audience = allowedAppleAudiences();
  if (audience.length === 0 || idToken.length === 0 || idToken.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(idToken, keys, { issuer: ISSUER, audience, algorithms: ["RS256"], clockTolerance: 5, requiredClaims: ["sub", "exp"] });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    const email = typeof payload.email === "string" && payload.email ? payload.email.toLowerCase() : null;
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    return { subject: payload.sub, email, emailVerified };
  } catch { return null; }
}
