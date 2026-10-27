import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Google publishes its signing keys here; jose caches them and honours Cache-Control.
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleIdentity = { sub: string; email: string; name: string | null };

export function allowedAudiences() {
  return [process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].flatMap(v => (v ?? "").split(",")).map(v => v.trim()).filter(Boolean);
}

// Returns null for any token that is not a currently valid, verified-email Google ID
// token minted for one of our native clients. `keys` is injectable for tests only.
export async function verifyGoogleIdToken(idToken: string, keys: JWTVerifyGetKey = GOOGLE_KEYS): Promise<GoogleIdentity | null> {
  const audience = allowedAudiences();
  if (audience.length === 0 || idToken.length === 0 || idToken.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(idToken, keys, { issuer: ISSUERS, audience, algorithms: ["RS256"], clockTolerance: 5, requiredClaims: ["sub", "exp"] });
    const verified = payload.email_verified === true || payload.email_verified === "true";
    if (!verified || typeof payload.email !== "string" || !payload.email || typeof payload.sub !== "string" || !payload.sub) return null;
    return { sub: payload.sub, email: payload.email.toLowerCase(), name: typeof payload.name === "string" ? payload.name : null };
  } catch { return null; }
}
