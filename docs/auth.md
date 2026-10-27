# Owner authentication and access (#42)

Uses maintained NextAuth 4.24.15 (Next 15/React 19 support) with Google OAuth and a
small Postgres adapter. Sources: https://next-auth.js.org/configuration/providers/google,
https://support.google.com/cloud/answer/15549945
and https://next-auth.js.org/tutorials/creating-a-database-adapter (checked 2026-10-15).
The adapter stores provider identity only, discards provider access/refresh tokens,
and hashes opaque session tokens. Eight-hour sessions are checked in Postgres on
EVERY protected request; sign-out deletes the server session, including copied tokens.

Owner setup (no accounts, credentials, or production config created by this PR):

1. Run `npm ci` and `npm run db:migrate` (migration 007 preserves unclaimed businesses).
2. In Google Cloud Console (Google Auth Platform), configure an External consent screen
   and create an OAuth "Web application" client. Add authorized redirect URI
   `NEXTAUTH_URL/api/auth/callback/google`. Request only `openid email profile`
   (the provider default, checked 2026-10-18): Google then needs no test-user list or
   unverified-app warning and does not expire sign-ins after 7 days in Testing.
   Adding any sensitive scope (e.g. Business Profile for #46) changes that.
3. Supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a random `NEXTAUTH_SECRET` (32+
   bytes), and canonical `NEXTAUTH_URL`; use HTTPS in production. Never commit values.
   Login returns an actionable 503 if setup is missing. Use Sign in / Sign out in nav.
4. Keep DATABASE_URL private to the app/worker/operator. Worker runs in a separate
   process with direct DB access; no bearer token bypass or public worker endpoint.
5. Verify an existing business belongs to the signed-in owner, locate their
   `auth_users.id` privately, then run `npm run business:claim -- BUSINESS_ID AUTH_USER_ID`.
   Claim accepts only an unclaimed business and an existing owner, never assigns all
   data to a registrant, and refuses reassignment. New businesses belong to the caller.

Every API route except NextAuth is wrapped in the same owner guard. Business lists
are filtered server-side; guessed foreign business/draft/media IDs return 404. A
composite FK rejects new cross-business review references without deleting legacy
data; existing violations require operator reconciliation before validating that FK.
Cookie writes require an Origin matching NEXTAUTH_URL and reject cross-site fetches.
Bearer writes skip that check because a browser never attaches the token itself.
Uploads are stream-bounded to 1.5 MB before JSON/form parsing; CSV has tighter limits.

Mobile bearer sessions (#80): `POST /api/mobile/session` (added in #81) creates a
session with `kind = 'mobile'` and returns the raw token once; only its SHA-256 hash
is stored. A request may authenticate with either the NextAuth cookie or
`Authorization: Bearer <43-character token>`, never both. Mobile sessions last 30
days from the last request, capped at 90 days after creation, and
`POST /api/mobile/session/revoke` deletes the calling session. Malformed, expired,
revoked and oversized (over 43 characters) tokens return 401. The same ownership,
CSRF, upload-size and daily-limit rules apply to both session kinds.
Generation attempts use atomic shared per-owner/day UTC counters (default 25,
`OWNER_GENERATION_DAILY_LIMIT`). Preview has a separate 120/day limit. Attempts
consume budget even on provider failure; the UI receives 429 on exhaustion.

Media is private: authorized DB image_path lookup precedes filesystem access, and
responses use private/no-store. `/generated/*` is blocked, including old static files.
Default storage is `private-media/` outside public. Compose mounts the SAME named
volume at `/app/private-media`, retaining its contents. Host installs must move
existing generated files from public/generated into private-media (or an external
MEDIA_ROOT) before restarting. Migration 007 rewrites legacy DB URLs to /api/media/.
Do not expose the media directory through a reverse proxy. #29 supplies deliberate
provider-fetchable media; guessing draft IDs never grants publication access.

`TEST_DATABASE_URL=postgres://... npm test` runs disposable-schema A/B ownership,
media, limits, expiry/revocation and cross-origin tests. Anonymous tests inventory
all actual route exports. Older domain tests bypass the guard explicitly; boundary
tests do not. Production auth/CSRF/sign-out HTTP smoke uses synthetic sessions only;
real Google login still requires owner-provided OAuth configuration and a manual check.
No live OAuth acceptance is claimed without that configuration.

Push tokens (#88): `POST /api/mobile/push-tokens` (`{token, platform}`) registers or refreshes
the signed-in owner's Expo push token and `DELETE` (`{token}`) removes it on sign-out; a
token can only be removed by its owner. When a business's weekly generation period has
finished with drafts awaiting approval, the worker sends each of that owner's devices one
notification (count, business name and a `praiseloop://queue?businessId=` deep link only),
recorded in `push_deliveries` so restarts never resend. Tokens Expo reports as
`DeviceNotRegistered`, in a ticket or a receipt, are deleted. Sends are retried up to three times.
